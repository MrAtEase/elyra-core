/**
 * Coding agent – Task contract normalisation and run-event logging.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { CodeTaskContract } from "@/types/taskContract";
import { appendRunEvent, type RunEventType } from "@/lib/orb-os/events/store";

export function normalizeCodeTaskContract(input: unknown): CodeTaskContract | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (record.executorType !== "code") return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const goal = typeof record.goal === "string" ? record.goal.trim() : "";
  const source = record.source === "chief_orchestrator" ? "chief_orchestrator" : "manual";
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim()
    ? record.createdAt.trim()
    : new Date().toISOString();
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  const rawScope = record.scope && typeof record.scope === "object" ? (record.scope as Record<string, unknown>) : {};
  const rawConstraints =
    record.constraints && typeof record.constraints === "object" ? (record.constraints as Record<string, unknown>) : {};
  const definitionOfDone = Array.isArray(record.definitionOfDone)
    ? record.definitionOfDone.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const verification = Array.isArray(record.verification)
    ? record.verification.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!id || !title || !goal) return null;

  return {
    id,
    executorType: "code",
    title,
    goal,
    ...(summary ? { summary } : {}),
    scope: {
      ...(typeof rawScope.workspaceId === "string" && rawScope.workspaceId.trim()
        ? { workspaceId: rawScope.workspaceId.trim() }
        : {}),
      ...(typeof rawScope.repoUrl === "string" && rawScope.repoUrl.trim()
        ? { repoUrl: rawScope.repoUrl.trim() }
        : {}),
      ...(typeof rawScope.branch === "string" && rawScope.branch.trim()
        ? { branch: rawScope.branch.trim() }
        : {}),
      ...(typeof rawScope.folderPath === "string" && rawScope.folderPath.trim()
        ? { folderPath: rawScope.folderPath.trim() }
        : {}),
      ...(Array.isArray(rawScope.selectedFiles)
        ? {
            selectedFiles: rawScope.selectedFiles
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((item) => item.trim()),
          }
        : {}),
    },
    constraints: {
      ...(rawConstraints.stage === "dev" || rawConstraints.stage === "prod" || rawConstraints.stage === "playground"
        ? { stage: rawConstraints.stage }
        : {}),
      ...(rawConstraints.terminalAccess === true ? { terminalAccess: true } : {}),
      ...(rawConstraints.useReasoning === true ? { useReasoning: true } : {}),
      ...(rawConstraints.autoCommit === true ? { autoCommit: true } : {}),
      ...(rawConstraints.executionMode === "strict" || rawConstraints.executionMode === "adaptive"
        ? { executionMode: rawConstraints.executionMode }
        : {}),
      ...(typeof rawConstraints.provider === "string" && rawConstraints.provider.trim()
        ? { provider: rawConstraints.provider.trim() }
        : {}),
      ...(rawConstraints.agentRole === "frontend" ||
      rawConstraints.agentRole === "backend" ||
      rawConstraints.agentRole === "ui" ||
      rawConstraints.agentRole === "infra" ||
      rawConstraints.agentRole === "qa" ||
      rawConstraints.agentRole === "general"
        ? { agentRole: rawConstraints.agentRole }
        : {}),
      ...(rawConstraints.branchPerAgent === true ? { branchPerAgent: true } : {}),
      ...(typeof rawConstraints.agentBranchName === "string" && rawConstraints.agentBranchName.trim()
        ? { agentBranchName: rawConstraints.agentBranchName.trim() }
        : {}),
      ...(typeof rawConstraints.budgetUsd === "number" && Number.isFinite(rawConstraints.budgetUsd)
        ? { budgetUsd: rawConstraints.budgetUsd }
        : {}),
      ...(typeof rawConstraints.deadlineMinutes === "number" && Number.isFinite(rawConstraints.deadlineMinutes)
        ? { deadlineMinutes: rawConstraints.deadlineMinutes }
        : {}),
    },
    definitionOfDone,
    verification,
    source,
    createdAt,
  };
}

export async function appendCodeRunEventSafe(input: {
  workspaceId?: string | undefined;
  runId?: string | undefined;
  eventType: RunEventType;
  summary: string;
  detail?: string | undefined;
  toolCallId?: string | null;
}): Promise<void> {
  if (!input.workspaceId || !input.runId) return;
  try {
    await appendRunEvent({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: input.eventType,
      toolCallId: input.toolCallId ?? null,
      payload: {
        summary: input.summary,
        ...(input.detail ? { detail: input.detail } : {}),
      },
    });
  } catch {
    // Run events are observability, not correctness.
  }
}
