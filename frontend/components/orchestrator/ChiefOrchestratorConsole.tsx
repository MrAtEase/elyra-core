"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Code2, Mail, CalendarDays, ListTodo, Workflow, RefreshCw } from "lucide-react";
import OrchestratorPanel from "@/components/orchestrator/OrchestratorPanel";
import { Button, Card, Badge } from "@/components/os/primitives";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { listExecutorRegistry } from "@/lib/orb-os/orchestrator/executorRegistry";
import { mapChiefCodeSteps, type ChiefCodePhase } from "@/lib/orb-os/orchestrator/chiefCode";
import { detectChiefExecutorType, mapChiefSteps } from "@/lib/orb-os/orchestrator/chiefDelegation";
import type { AnyTaskContract, CodeTaskContract, ExecutorType } from "@/types/taskContract";

type ChiefCodePlanResponse = {
  ok: boolean;
  runId?: string;
  summary?: string;
  error?: string;
  contract?: AnyTaskContract;
  executor?: { label?: string; dispatchPath?: string };
  execution?: { status?: string };
  artifact?: {
    summary?: string;
    executionApplied?: boolean;
    buildReport?: { success?: boolean };
    executionStatus?: string;
  };
};

type RecentRun = {
  id: string;
  status: string;
  intent: string;
  updatedAt: string;
  executorType?: string | null;
  contractTitle?: string | null;
  summary?: string;
};

type SelectedRunDetail = {
  run: {
    id: string;
    status: string;
    intent: string;
    updatedAt: string;
    error?: string | null;
    executorType?: string | null;
    contract?: AnyTaskContract | null;
    result?: Record<string, unknown> | null;
  };
  readModel: {
    status: string;
    requiresApproval: boolean;
    requiresAuth: boolean;
    timeline: Array<{ id: string; at: string; type: string; summary: string }>;
  };
  artifacts: Array<{
    id: string;
    artifact_type: string;
    title: string;
    ui_card_hint?: string | null;
    link_url?: string | null;
    created_at?: string;
  }>;
};

const EXECUTOR_ICONS = {
  code: Code2,
  mail: Mail,
  calendar: CalendarDays,
  tasks: ListTodo,
  workflow: Workflow,
} as const;

function openCodeRun(runId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("elyra_pending_code_run_id", runId);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("elyra:open-code-run", { detail: { runId } }));
}

function openExecutorSurface(executorType: string | null | undefined, workspaceId: string, runId?: string | null) {
  if (typeof window === "undefined") return;
  if (executorType === "code" && runId) {
    openCodeRun(runId);
    window.location.assign(`/os/code?workspaceId=${encodeURIComponent(workspaceId)}&openRunId=${encodeURIComponent(runId)}`);
    return;
  }
  if (executorType === "mail") {
    window.location.assign(`/os/mail?workspaceId=${encodeURIComponent(workspaceId)}`);
    return;
  }
  if (executorType === "calendar") {
    window.location.assign(`/os/calendar?workspaceId=${encodeURIComponent(workspaceId)}`);
    return;
  }
  if (executorType === "tasks" || executorType === "workflow") {
    window.location.assign(`/os/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
  }
}

export default function ChiefOrchestratorConsole() {
  const { data } = useWorkspaceData();
  const workspaceId = data?.activeWorkspace?.id ?? "";
  const [tab, setTab] = useState<"Understand" | "Plan" | "Run">("Understand");
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<ChiefCodePhase>("idle");
  const [contract, setContract] = useState<AnyTaskContract | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executorLabel, setExecutorLabel] = useState<string | null>(null);
  const [executorType, setExecutorType] = useState<ExecutorType | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<SelectedRunDetail | null>(null);

  const steps = useMemo(
    () =>
      contract?.executorType === "code"
        ? mapChiefCodeSteps({ contract: contract as CodeTaskContract, phase, executorLabel, error })
        : mapChiefSteps({ contract, phase, executorLabel, error }),
    [contract, phase, executorLabel, error],
  );
  const executors = useMemo(() => listExecutorRegistry(), []);

  const loadRecentRuns = useCallback(async () => {
    if (!workspaceId) return;
    const response = await fetch(`/api/os/orchestrator/runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=8`, {
      cache: "no-store",
      credentials: "include",
    });
    const payload = (await response.json().catch(() => null)) as { runs?: RecentRun[] } | null;
    const nextRuns = Array.isArray(payload?.runs) ? payload.runs : [];
    setRecentRuns(nextRuns);
    setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null);
  }, [workspaceId]);

  useEffect(() => {
    void loadRecentRuns();
  }, [loadRecentRuns]);

  const loadRunDetail = useCallback(async (targetRunId: string) => {
    if (!workspaceId || !targetRunId) return;
    const response = await fetch(`/api/os/orchestrator/runs/${encodeURIComponent(targetRunId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
      credentials: "include",
    });
    const payload = (await response.json().catch(() => null)) as SelectedRunDetail | null;
    if (!response.ok || !payload) {
      setSelectedRunDetail(null);
      return;
    }
    setSelectedRunDetail(payload);
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedRunId) return;
    void loadRunDetail(selectedRunId);
  }, [loadRunDetail, selectedRunId]);

  const callChiefCodeOrchestrator = useCallback(
    async (nextPhase: "plan" | "execute", nextExecutorType: ExecutorType) => {
      const endpoint = nextExecutorType === "code" ? "/api/os/orchestrator/code" : "/api/os/orchestrator/delegate";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          workspaceId,
          intent,
          task: intent,
          ...(nextExecutorType === "code"
            ? {
                repoUrl: "",
                branch: "main",
                folderPath: "",
                selectedFiles: [],
                stage: "playground",
                terminalAccess: true,
                useReasoning: false,
                executionMode: "adaptive",
                autoCommit: false,
                skill: "custom",
              }
            : {
                executorType: nextExecutorType,
              }),
          phase: nextPhase,
          ...(runId ? { runId } : {}),
        }),
      });
      return (await response.json().catch(() => null)) as ChiefCodePlanResponse | null;
    },
    [intent, runId, workspaceId],
  );

  const handlePlan = useCallback(async () => {
    if (!workspaceId || !intent.trim()) return;
    const nextExecutorType = detectChiefExecutorType(intent);
    if (nextExecutorType === "unknown") {
      setError("Elly could not map this intent to a supported executor.");
      setSummary("Use a coding, mail, calendar, task, or workflow request here.");
      setPhase("failed");
      setTab("Run");
      return;
    }

    setError(null);
    setSummary("Chief orchestrator is analyzing the request and creating a coding contract.");
    setPhase("planning");
    setTab("Understand");
    setContract(null);
    setRunId(null);
    setExecutorLabel(null);
    setExecutorType(null);
    setEvidence([]);

    const payload = await callChiefCodeOrchestrator("plan", nextExecutorType);
    if (!payload?.ok || !payload.contract) {
      const message = payload?.error || "Chief orchestrator plan failed.";
      setPhase("failed");
      setError(message);
      setSummary(message);
      setTab("Run");
      return;
    }

    setRunId(payload.runId ?? null);
    setContract(payload.contract);
    setExecutorLabel(payload.executor?.label ?? "Coding Agent");
    setExecutorType(payload.contract.executorType);
    setSummary(payload.summary ?? "Chief orchestrator contract created.");
    setPhase("plan_ready");
    setTab("Plan");
    setSelectedRunId(payload.runId ?? null);
    await loadRecentRuns();
  }, [callChiefCodeOrchestrator, intent, loadRecentRuns, workspaceId]);

  const handleExecute = useCallback(async () => {
    if (!workspaceId || !intent.trim()) return;
    const nextExecutorType = executorType ?? detectChiefExecutorType(intent);
    if (nextExecutorType === "unknown") {
      setError("Elly could not map this intent to a supported executor.");
      setPhase("failed");
      setTab("Run");
      return;
    }
    setError(null);
    setSummary(`Chief orchestrator dispatched the contract to the ${nextExecutorType} executor.`);
    setPhase("executing");
    setTab("Run");
    const payload = await callChiefCodeOrchestrator("execute", nextExecutorType);
    if (!payload?.ok) {
      const message = payload?.error || "Chief orchestrator execution failed.";
      setPhase("failed");
      setError(message);
      setSummary(message);
      setTab("Run");
      await loadRecentRuns();
      return;
    }
    if (payload.runId) {
      setRunId(payload.runId);
      setSelectedRunId(payload.runId);
      if (nextExecutorType === "code") {
        openCodeRun(payload.runId);
      }
    }
    setEvidence((payload.artifact?.summary ? [payload.artifact.summary] : []).concat(
      payload.artifact?.executionStatus ? [`Execution status: ${payload.artifact.executionStatus}`] : [],
    ));
    setSummary(payload.artifact?.summary || `${payload.executor?.label ?? "Executor"} completed the dispatched contract.`);
    if (payload.execution?.status === "waiting_for_auth" || payload.execution?.status === "waiting_for_approval") {
      setPhase("executing");
    } else {
      setPhase("done");
    }
    setTab("Run");
    await loadRecentRuns();
  }, [callChiefCodeOrchestrator, executorType, intent, loadRecentRuns, workspaceId]);

  const openLogs = useCallback(() => {
    if (!runId) return;
    if (executorType) {
      openExecutorSurface(executorType, workspaceId, runId);
      return;
    }
    setTab("Run");
  }, [executorType, runId, workspaceId]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">Chief Orchestrator</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--text-primary)]">Elly Command Center</h1>
          <p className="mt-2 max-w-3xl text-sm text-[color:var(--text-secondary)]">
            This is the dedicated main-orchestrator surface. Elly turns your intent into a scoped task contract and dispatches it to the right executor.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadRecentRuns()}>
          <RefreshCw size={14} /> Refresh runs
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Bot size={16} />
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">Intent to contract</p>
          </div>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Describe what Elly should delegate: code, mail, calendar, tasks, or workflow..."
            className="mt-4 min-h-[140px] w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void handlePlan()} disabled={!intent.trim() || phase === "planning" || phase === "executing"}>
              Generate contract
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleExecute()}
              disabled={phase !== "plan_ready" && phase !== "failed"}
            >
              Dispatch to executor
            </Button>
            <Button variant="ghost" onClick={openLogs} disabled={!runId}>
              Open logs
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">Executor registry</p>
          <div className="mt-4 space-y-3">
            {executors.map((executor) => {
              const Icon = EXECUTOR_ICONS[executor.executorType];
              return (
                <div key={executor.executorType} className="rounded-2xl border border-white/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon size={15} />
                      <p className="text-sm font-medium text-[color:var(--text-primary)]">{executor.label}</p>
                    </div>
                    <Badge tone={executor.executorType === "code" || executor.executorType === "mail" || executor.executorType === "calendar" || executor.executorType === "tasks" ? "accent" : "neutral"}>
                      {executor.executorType === "workflow" ? "next" : "active"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-[color:var(--text-secondary)]">{executor.dispatchPath}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <OrchestratorPanel
          tab={tab}
          onTab={setTab}
          steps={steps}
          onRun={() => void handleExecute()}
          summary={summary}
          error={error}
          runBusy={phase === "planning" || phase === "executing"}
          runDisabled={phase !== "plan_ready" && phase !== "failed"}
          onRetry={phase === "failed" ? () => void handlePlan() : undefined}
          onOpenLogs={runId ? openLogs : undefined}
          contractTitle={contract?.title ?? null}
          contractScope={
            contract
              ? [
                  contract.scope.selectedFiles?.length
                    ? `${contract.scope.selectedFiles.length} selected file(s)`
                    : contract.scope.folderPath?.trim()
                      ? `folder: ${contract.scope.folderPath}`
                      : contract.executorType === "code"
                        ? "repo scope"
                        : "workspace scope",
                  contract.executorType === "code" ? `stage: ${contract.constraints.stage ?? "playground"}` : null,
                  executorLabel ?? "Executor",
                ].filter(Boolean).join(" · ")
              : null
          }
          contractDone={contract?.definitionOfDone}
          contractVerification={contract?.verification?.concat(evidence)}
        />

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">Recent orchestrator and code runs</p>
            <Badge tone="neutral">{recentRuns.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {recentRuns.length === 0 ? (
              <p className="text-sm text-[color:var(--text-secondary)]">No runs yet.</p>
            ) : (
              recentRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => {
                    setSelectedRunId(run.id);
                  }}
                  className="flex w-full items-start justify-between gap-4 rounded-2xl border border-white/10 p-3 text-left transition hover:bg-white/[0.03]"
                >
                  <div>
                    <p className="text-sm font-medium text-[color:var(--text-primary)]">{run.contractTitle || run.intent}</p>
                    <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                      {run.executorType ?? "orchestrator"} · {run.id}
                    </p>
                    {run.summary ? <p className="mt-2 text-xs text-[color:var(--text-muted)]">{run.summary}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={run.status === "failed" ? "danger" : run.status === "completed" || run.status === "done" ? "accent" : "warning"}>
                      {run.status}
                    </Badge>
                    <ArrowRight size={14} />
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">Run evidence</p>
          <div className="flex items-center gap-2">
            {selectedRunDetail?.readModel.requiresAuth ? <Badge tone="warning">Auth required</Badge> : null}
            {selectedRunDetail?.readModel.requiresApproval ? <Badge tone="warning">Approval required</Badge> : null}
            {selectedRunDetail ? (
              <Badge tone={selectedRunDetail.run.status === "failed" ? "danger" : selectedRunDetail.run.status === "done" ? "accent" : "neutral"}>
                {selectedRunDetail.run.status}
              </Badge>
            ) : null}
          </div>
        </div>
        {!selectedRunDetail ? (
          <p className="mt-4 text-sm text-[color:var(--text-secondary)]">Select a recent run to inspect timeline, evidence, and artifacts.</p>
        ) : (
          <div className="mt-4 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-sm font-medium text-[color:var(--text-primary)]">{selectedRunDetail.run.contract?.title ?? selectedRunDetail.run.intent}</p>
                <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                  {selectedRunDetail.run.executorType ?? "orchestrator"} · {selectedRunDetail.run.id}
                </p>
                {selectedRunDetail.run.error ? (
                  <p className="mt-3 text-xs text-rose-400">{selectedRunDetail.run.error}</p>
                ) : null}
                {selectedRunDetail.run.result && typeof selectedRunDetail.run.result.summary === "string" ? (
                  <p className="mt-3 text-sm text-[color:var(--text-secondary)]">{selectedRunDetail.run.result.summary}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedRunDetail.run.executorType ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        openExecutorSurface(
                          selectedRunDetail.run.executorType,
                          workspaceId,
                          selectedRunDetail.run.id,
                        )
                      }
                    >
                      Open {selectedRunDetail.run.executorType} surface
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => void loadRunDetail(selectedRunDetail.run.id)}>
                    Refresh detail
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">Timeline</p>
                <div className="mt-3 space-y-3">
                  {selectedRunDetail.readModel.timeline.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-secondary)]">No run events recorded yet.</p>
                  ) : (
                    selectedRunDetail.readModel.timeline.map((event) => (
                      <div key={event.id} className="rounded-xl border border-white/8 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-medium text-[color:var(--text-primary)]">{event.summary}</p>
                          <Badge tone="neutral">{event.type}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{event.at}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">Artifacts</p>
              <div className="mt-3 space-y-3">
                {selectedRunDetail.artifacts.length === 0 ? (
                  <p className="text-sm text-[color:var(--text-secondary)]">No tool artifacts captured for this run.</p>
                ) : (
                  selectedRunDetail.artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-xl border border-white/8 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[color:var(--text-primary)]">{artifact.title}</p>
                        <Badge tone="neutral">{artifact.artifact_type}</Badge>
                      </div>
                      {artifact.ui_card_hint ? <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{artifact.ui_card_hint}</p> : null}
                      {artifact.link_url ? (
                        <a className="mt-2 inline-flex text-xs text-sky-300 hover:text-sky-200" href={artifact.link_url} target="_blank" rel="noreferrer">
                          Open artifact
                        </a>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
