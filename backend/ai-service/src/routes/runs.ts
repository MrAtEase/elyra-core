import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRun } from "../db/repos/runs.js";
import { getOrCreateEmitter, formatSSE, HEARTBEAT_MS } from "../engine/sse-emitter.js";
import { approveStep, rejectStep } from "../engine/approval-gate.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { SSEEvent } from "../types/sse.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { getRunByAiRunId, logBehaviorEvent } from "../db/repos/brain-foundation.js";

const behaviorBody = z.object({
  eventType: z.enum(["approve_step", "deny_step", "edit_output", "run_completed"]),
  runId: z.string().optional(),
  intentId: z.string().optional(),
  fieldName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

async function assertRunAccess(request: AuthenticatedRequest, runWorkspaceId: string): Promise<void> {
  const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(request.userId, runWorkspaceId);
  if (!authorizedWorkspaceId || authorizedWorkspaceId !== runWorkspaceId) {
    throw new ValidationError("workspace_not_accessible");
  }
}

export async function runRoutes(app: FastifyInstance) {
  // SSE stream for a run
  app.get("/v1/runs/:id/stream", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const { id } = request.params as { id: string };
    const run = await getRun(id);
    if (!run) throw new NotFoundError("Run");

    await assertRunAccess(authRequest, run.workspaceId);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const emitter = getOrCreateEmitter(id);

    const onSSE = (event: SSEEvent) => {
      reply.raw.write(formatSSE(event));
    };

    emitter.on("sse", onSSE);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(formatSSE({ event: "heartbeat", data: { ts: Date.now() } }));
    }, HEARTBEAT_MS);

    // If run is already completed, send final state immediately
    if (run.status === "completed") {
      reply.raw.write(
        formatSSE({ event: "run.completed", data: { runId: id, status: "completed", assistantText: run.planSummary ?? "Done" } }),
      );
    } else if (run.status === "failed") {
      reply.raw.write(
        formatSSE({ event: "run.failed", data: { runId: id, error: "Run failed" } }),
      );
    }

    // Clean up on client disconnect
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      emitter.off("sse", onSSE);
    });
  });

  // Approve a pending step
  app.post("/v1/runs/:id/approve", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const { id } = request.params as { id: string };
    const run = await getRun(id);
    if (!run) throw new NotFoundError("Run");

    await assertRunAccess(authRequest, run.workspaceId);

    const body = request.body as { stepId?: string; action?: string };
    if (!body.stepId) throw new ValidationError("stepId is required");

    const action = body.action ?? "approve";
    const success = action === "approve" ? approveStep(body.stepId) : rejectStep(body.stepId);

    if (!success) throw new NotFoundError("Pending approval");

    try {
      const foundationRun = await getRunByAiRunId(id);
      await logBehaviorEvent({
        workspaceId: run.workspaceId,
        userId: authRequest.userId,
        eventType: action === "approve" ? "approve_step" : "deny_step",
        intentId: foundationRun?.intentId ?? null,
        runId: foundationRun?.id ?? id,
        fieldName: body.stepId,
        metadata: {
          stepId: body.stepId,
          aiRunId: id,
          source: "approval_route",
        },
      });
    } catch {
      // Non-blocking: approval result should succeed even when behavior tracking fails.
    }

    reply.send({ ok: true });
  });

  app.post("/v1/behavior-events", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const parsed = behaviorBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const query = (request.query ?? {}) as { workspaceId?: string };
    const requestedWorkspaceId = (query.workspaceId && query.workspaceId.trim()) || authRequest.workspaceId;
    const workspaceId = await resolveAuthorizedWorkspaceId(authRequest.userId, requestedWorkspaceId);

    if (!workspaceId) {
      throw new ValidationError("workspace_not_accessible");
    }

    const event = await logBehaviorEvent({
      workspaceId,
      userId: authRequest.userId,
      eventType: parsed.data.eventType,
      runId: parsed.data.runId ?? null,
      intentId: parsed.data.intentId ?? null,
      fieldName: parsed.data.fieldName ?? null,
      metadata: parsed.data.metadata ?? {},
    });

    reply.status(201).send({ event });
  });
}
