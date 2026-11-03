import type { OrchestratorPlan } from "../types/plan.js";
import type { Run } from "../types/run.js";
import { createRun, updateRunStatus } from "../db/repos/runs.js";
import { createStep, updateStepStatus } from "../db/repos/steps.js";
import { incrementUsage } from "../db/repos/usage.js";
import {
  createPublicToolCall,
  updatePublicToolCall,
} from "../db/repos/public-tool-calls.js";
import {
  addArtifactVersion,
  addRunStep as addFoundationRunStep,
  appendIntentMessage,
  logBehaviorEvent,
  setRunStatus as setFoundationRunStatus,
  upsertArtifact,
  updateIntentStatus,
} from "../db/repos/brain-foundation.js";
import { emitSSE, removeEmitter } from "./sse-emitter.js";
import { waitForApproval } from "./approval-gate.js";
import { executeStep } from "./step-executor.js";
import { estimateCost } from "../models/token-counter.js";
import { runId, stepId, toolCallId } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import { ingestRunGraph } from "../kernel/graph-ingest.js";

type StartRunOptions = {
  intentId?: string | null;
  foundationRunId?: string | null;
};

type ArtifactSummary = {
  id: string;
  type: string;
  title: string;
  runId: string | null;
  intentId: string | null;
  payloadRef: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function artifactCardsFromSummaries(artifacts: ArtifactSummary[]): Array<{ id: string; title: string; detail: string }> {
  return artifacts.slice(-3).map((artifact) => ({
    id: `artifact:${artifact.id}`,
    title: `Open ${artifact.type}`,
    detail: artifact.title,
  }));
}

async function persistArtifactsFromStepOutput(input: {
  workspaceId: string;
  userId: string;
  planLabel: string;
  toolName: string;
  foundationRunId: string | null;
  intentId: string | null;
  output: Record<string, unknown>;
}): Promise<ArtifactSummary[]> {
  const persisted: ArtifactSummary[] = [];
  const runId = input.foundationRunId;

  const deck = asRecord(input.output["deck"]);
  if (deck && input.toolName === "slides.create") {
    const title = asString(deck["title"]) ?? `${input.planLabel} result`;
    const artifact = await upsertArtifact({
      workspaceId: input.workspaceId,
      kind: "slides",
      title,
      runId,
      intentId: input.intentId,
      path: null,
      metaJson: {
        sourceTool: input.toolName,
      },
    });

    await addArtifactVersion({
      artifactId: artifact.id,
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      contentJson: {
        deck,
      },
    });

    persisted.push({
      id: artifact.id,
      type: "slides",
      title: artifact.title,
      runId,
      intentId: input.intentId,
      payloadRef: artifact.path,
    });
  }

  const artifactPayload = asRecord(input.output["artifact"]);
  if (artifactPayload) {
    const type = asString(artifactPayload["type"] ?? artifactPayload["kind"]) ?? "document";
    const title = asString(artifactPayload["title"]) ?? `${input.planLabel} artifact`;
    const payloadRef = asString(artifactPayload["payloadRef"] ?? artifactPayload["path"]);
    const payloadJson =
      asRecord(artifactPayload["payloadJson"] ?? artifactPayload["payload"]) ?? artifactPayload;

    const artifact = await upsertArtifact({
      workspaceId: input.workspaceId,
      kind: type,
      title,
      runId,
      intentId: input.intentId,
      path: payloadRef,
      metaJson: {
        sourceTool: input.toolName,
      },
    });

    await addArtifactVersion({
      artifactId: artifact.id,
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      contentJson: payloadJson,
    });

    persisted.push({
      id: artifact.id,
      type,
      title: artifact.title,
      runId,
      intentId: input.intentId,
      payloadRef: artifact.path,
    });
  }

  return persisted;
}

async function safeFoundationWrite(operation: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    logger.warn({ err, operation }, "foundation step tracking failed — non-critical");
  }
}

async function safeToolCallWrite(operation: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    logger.warn({ err, operation }, "tool call tracking failed — non-critical");
  }
}

export async function startRun(
  userId: string,
  workspaceId: string,
  prompt: string,
  plan: OrchestratorPlan,
  parserTokens: { promptTokens: number; completionTokens: number; model: string },
  options: StartRunOptions = {},
): Promise<string> {
  const id = runId();

  const run: Run = {
    id,
    workspaceId,
    userId,
    prompt,
    status: "pending",
    planSummary: plan.summary,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await createRun(run);

  // Track intent parsing cost
  const parserCost = estimateCost(parserTokens.model, parserTokens.promptTokens, parserTokens.completionTokens);
  const parserCallId = toolCallId();
  await safeToolCallWrite("parser:createPublicToolCall", async () => {
    await createPublicToolCall({
      id: parserCallId,
      runId: id,
      runStepId: null,
      workspaceId,
      toolName: `model.parse_plan:${parserTokens.model}`,
      requestJson: {
        promptTokens: parserTokens.promptTokens,
        completionTokens: parserTokens.completionTokens,
      },
    });
    await updatePublicToolCall(parserCallId, {
      status: "completed",
      responseJson: {
        model: parserTokens.model,
        promptTokens: parserTokens.promptTokens,
        completionTokens: parserTokens.completionTokens,
        costUsd: parserCost,
      },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  });
  await incrementUsage(workspaceId, parserTokens.promptTokens, parserTokens.completionTokens, parserCost);

  // Execute plan asynchronously
  executeRunAsync(id, workspaceId, userId, plan, options).catch((err) => {
    logger.error({ runId: id, err }, "Run execution failed");
  });

  return id;
}

async function executeRunAsync(
  id: string,
  workspaceId: string,
  userId: string,
  plan: OrchestratorPlan,
  options: StartRunOptions,
): Promise<void> {
  const startedAtMs = Date.now();
  await updateRunStatus(id, "running");
  if (options.foundationRunId) {
    await safeFoundationWrite("setFoundationRunStatus:running", async () => {
      await setFoundationRunStatus(options.foundationRunId!, "running", { summary: plan.summary });
    });
  }
  if (options.intentId) {
    await safeFoundationWrite("updateIntentStatus:running", async () => {
      await updateIntentStatus(options.intentId!, "running");
    });
  }

  emitSSE(id, { event: "run.started", data: { runId: id, summary: plan.summary } });
  emitSSE(id, { event: "orb.state", data: { state: "thinking" } });

  let finalText = plan.summary;
  let failed = false;
  const producedArtifacts: ArtifactSummary[] = [];

  for (const planStep of plan.steps) {
    const sid = stepId();
    const callId = toolCallId();

    await createStep({
      id: sid,
      runId: id,
      index: planStep.index,
      toolName: planStep.toolName,
      label: planStep.label,
      status: "pending",
      input: planStep.input,
      output: null,
      requiresApproval: planStep.requiresApproval,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    if (options.foundationRunId) {
      await safeFoundationWrite("addFoundationRunStep:pending", async () => {
        await addFoundationRunStep(options.foundationRunId!, {
          workspaceId,
          stepKey: sid,
          title: planStep.label,
          detail: "Pending",
          status: "pending",
          requiresApproval: planStep.requiresApproval,
        });
      });
    }

    await safeToolCallWrite("step:createPublicToolCall", async () => {
      await createPublicToolCall({
        id: callId,
        runId: id,
        runStepId: sid,
        workspaceId,
        toolName: planStep.toolName,
        requestJson: planStep.input,
      });
    });

    // Approval gate
    if (planStep.requiresApproval) {
      emitSSE(id, {
        event: "step.approval_required",
        data: { stepId: sid, label: planStep.label, description: `Approve: ${planStep.label}?` },
      });
      await updateRunStatus(id, "awaiting_approval");
      if (options.foundationRunId) {
        await safeFoundationWrite("setFoundationRunStatus:awaiting_approval", async () => {
          await setFoundationRunStatus(options.foundationRunId!, "awaiting_approval");
        });
        await safeFoundationWrite("addFoundationRunStep:approval_required", async () => {
          await addFoundationRunStep(options.foundationRunId!, {
            workspaceId,
            stepKey: sid,
            title: planStep.label,
            detail: `Approval required: ${planStep.label}`,
            status: "approval_required",
            requiresApproval: true,
          });
        });
      }

      try {
        await waitForApproval(sid);
      } catch {
        await updateStepStatus(sid, "skipped");
        if (options.foundationRunId) {
          await safeFoundationWrite("addFoundationRunStep:skipped", async () => {
            await addFoundationRunStep(options.foundationRunId!, {
              workspaceId,
              stepKey: sid,
              title: planStep.label,
              detail: "Rejected by user",
              status: "skipped",
              requiresApproval: true,
            });
          });
        }
        await safeToolCallWrite("step:updatePublicToolCall:approval_denied", async () => {
          await updatePublicToolCall(callId, {
            status: "failed",
            error: "Approval denied",
            finishedAt: new Date().toISOString(),
          });
        });
        emitSSE(id, { event: "step.completed", data: { stepId: sid, status: "skipped", output: null } });
        continue;
      }

      await updateRunStatus(id, "running");
      if (options.foundationRunId) {
        await safeFoundationWrite("setFoundationRunStatus:running_after_approval", async () => {
          await setFoundationRunStatus(options.foundationRunId!, "running");
        });
      }
    }

    // Execute step
    emitSSE(id, { event: "step.started", data: { stepId: sid, index: planStep.index, label: planStep.label } });
    await updateStepStatus(sid, "running");
    if (options.foundationRunId) {
      await safeFoundationWrite("addFoundationRunStep:running", async () => {
        await addFoundationRunStep(options.foundationRunId!, {
          workspaceId,
          stepKey: sid,
          title: planStep.label,
          detail: "Running",
          status: "running",
          requiresApproval: planStep.requiresApproval,
        });
      });
    }

    await safeToolCallWrite("step:updatePublicToolCall:running", async () => {
      await updatePublicToolCall(callId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
    });

    const result = await executeStep(planStep, workspaceId);

    if (result.error) {
      await safeToolCallWrite("step:updatePublicToolCall:failed", async () => {
        await updatePublicToolCall(callId, {
          status: "failed",
          error: result.error,
          responseJson: { error: result.error },
          finishedAt: new Date().toISOString(),
        });
      });
      await updateStepStatus(sid, "failed", { error: result.error });
      if (options.foundationRunId) {
        await safeFoundationWrite("addFoundationRunStep:failed", async () => {
          await addFoundationRunStep(options.foundationRunId!, {
            workspaceId,
            stepKey: sid,
            title: planStep.label,
            detail: result.error,
            status: "failed",
            requiresApproval: planStep.requiresApproval,
            outputJson: { error: result.error },
          });
        });
      }
      emitSSE(id, { event: "step.completed", data: { stepId: sid, status: "failed", output: { error: result.error } } });
      failed = true;
      finalText = `Das Tool konnte nicht ausgeführt werden: ${result.error}`;
      break;
    }

    await safeToolCallWrite("step:updatePublicToolCall:completed", async () => {
      await updatePublicToolCall(callId, {
        status: "completed",
        responseJson: result.output ?? {},
        finishedAt: new Date().toISOString(),
      });
    });
    await updateStepStatus(sid, "completed", result.output);

    let newArtifacts: ArtifactSummary[] = [];
    try {
      newArtifacts = await persistArtifactsFromStepOutput({
        workspaceId,
        userId,
        planLabel: planStep.label,
        toolName: planStep.toolName,
        foundationRunId: options.foundationRunId ?? null,
        intentId: options.intentId ?? null,
        output: result.output,
      });
    } catch (err) {
      logger.warn({ err, runId: id, stepId: sid }, "artifact persistence failed — non-critical");
      newArtifacts = [];
    }
    if (newArtifacts.length > 0) {
      producedArtifacts.push(...newArtifacts);
      newArtifacts.forEach((artifact) => {
        emitSSE(id, {
          event: "artifact.created",
          data: artifact,
        });
      });
    }

    const stepOutput =
      newArtifacts.length > 0
        ? {
            ...result.output,
            artifacts: newArtifacts,
          }
        : result.output;

    if (options.foundationRunId) {
      await safeFoundationWrite("addFoundationRunStep:completed", async () => {
        await addFoundationRunStep(options.foundationRunId!, {
          workspaceId,
          stepKey: sid,
          title: planStep.label,
          detail: "Completed",
          status: "completed",
          requiresApproval: planStep.requiresApproval,
          outputJson: stepOutput,
        });
      });
    }
    emitSSE(id, { event: "step.completed", data: { stepId: sid, status: "completed", output: stepOutput } });

    // Use the last step's text output as final response
    if (typeof result.output["text"] === "string") {
      finalText = result.output["text"];
    }
  }

  const finalStatus = failed ? "failed" : "completed";
  await updateRunStatus(id, finalStatus);
  const durationMs = Math.max(0, Date.now() - startedAtMs);

  if (options.foundationRunId) {
    await safeFoundationWrite("setFoundationRunStatus:final", async () => {
      await setFoundationRunStatus(options.foundationRunId!, finalStatus, {
        summary: finalText,
        error: failed ? finalText : null,
        durationMs,
        completedAt: new Date().toISOString(),
      });
    });
  }
  if (options.intentId) {
    const actionCards = artifactCardsFromSummaries(producedArtifacts);
    await safeFoundationWrite("updateIntentStatus:final", async () => {
      await updateIntentStatus(options.intentId!, finalStatus === "completed" ? "completed" : "failed");
    });
    await safeFoundationWrite("appendIntentMessage:assistant_final", async () => {
      await appendIntentMessage(options.intentId!, "assistant", finalText, {
        status: finalStatus,
        source: "ai-service",
        ...(actionCards.length > 0 ? { actionCards } : {}),
      });
    });
  }

  if (failed) {
    emitSSE(id, { event: "run.failed", data: { runId: id, error: finalText } });
  } else {
    const actionCards = artifactCardsFromSummaries(producedArtifacts);
    emitSSE(id, {
      event: "run.completed",
      data: {
        runId: id,
        status: finalStatus,
        assistantText: finalText,
        ...(actionCards.length > 0 ? { actionCards } : {}),
      },
    });
  }

  if (finalStatus === "completed" || options.intentId) {
    try {
      await ingestRunGraph({
        workspaceId,
        userId,
        intentId: options.intentId ?? null,
        runId: id,
      });
    } catch (error) {
      logger.warn({ runId: id, err: error }, "Graph ingestion failed — non-critical");
    }
  }

  try {
    await logBehaviorEvent({
      workspaceId,
      userId,
      eventType: "run_completed",
      intentId: options.intentId ?? null,
      runId: options.foundationRunId ?? id,
      metadata: {
        durationMs,
        status: finalStatus,
      },
    });
  } catch (error) {
    logger.warn({ runId: id, err: error }, "Failed to persist run_completed behavior event");
  }

  emitSSE(id, { event: "orb.state", data: { state: "idle" } });

  // Clean up emitter after a delay to allow SSE clients to receive final events
  setTimeout(() => removeEmitter(id), 30_000);
}
