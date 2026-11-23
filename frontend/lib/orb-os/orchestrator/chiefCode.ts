import type { CodeTaskContract } from "@/types/taskContract";
import type { OrchestratorStep } from "@/components/orchestrator/OrchestratorPanel";

export type ChiefCodePhase = "idle" | "planning" | "plan_ready" | "executing" | "done" | "failed";

export function isCodeIntent(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  const command = normalized.split(/\s+/)[0] ?? "";
  if (command === "/build" || command === "/code") return true;
  return [
    "fix",
    "bug",
    "build",
    "refactor",
    "implement",
    "feature",
    "ui",
    "frontend",
    "backend",
    "typescript",
    "test",
    "lint",
    "webpack",
    "coder",
    "code",
    "ändere",
    "baue",
    "fehler",
    "fixe",
    "implementiere",
    "refaktoriere",
  ].some((word) => normalized.includes(word));
}

export function mapChiefCodeSteps(input: {
  contract: CodeTaskContract | null;
  phase: ChiefCodePhase;
  executorLabel?: string | null;
  error?: string | null;
}): OrchestratorStep[] {
  const selectedFiles = input.contract?.scope.selectedFiles ?? [];
  const scopeDetail =
    selectedFiles.length > 0
      ? `${selectedFiles.length} selected file(s)`
      : input.contract?.scope.folderPath?.trim()
        ? `folder scope: ${input.contract.scope.folderPath}`
        : "repo scope inferred by coder";
  const stage = input.contract?.constraints.stage ?? "playground";

  return [
    {
      id: "chief-understand",
      kind: "context",
      title: "Load workspace context",
      status:
        input.phase === "planning" ? "running" : input.phase === "failed" ? "failed" : "done",
      detail: input.contract?.summary?.trim() || "Workspace brain and intent analyzed for delegation.",
    },
    {
      id: "chief-contract",
      kind: "code",
      title: "Create coding contract",
      status:
        input.phase === "planning"
          ? "running"
          : input.phase === "idle"
            ? "ready"
            : input.phase === "failed"
              ? "failed"
              : "done",
      detail: input.contract
        ? `${scopeDetail} · stage: ${stage}`
        : "Turn the request into a scoped coding contract.",
    },
    {
      id: "chief-dispatch",
      kind: "code",
      title: "Dispatch to coding agent",
      status:
        input.phase === "executing"
          ? "running"
          : input.phase === "done"
            ? "done"
            : input.phase === "failed"
              ? "failed"
              : "ready",
      detail:
        input.phase === "failed" && input.error
          ? input.error
          : `${input.executorLabel || "Coding Agent"} executes the contract and reports evidence back.`,
    },
  ];
}
