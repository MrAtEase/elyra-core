"use client";

import { useEffect, useMemo, useState } from "react";

type RunRecord = {
  id: string;
  app: string;
  agent: string;
  task: string;
  repoUrl: string;
  branch: string;
  workspaceId: string;
  stage: "playground" | "dev" | "prod";
  status: "planning" | "running" | "failed" | "completed";
  startedAt: number;
  updatedAt: number;
  summary?: string;
  previewUrl?: string;
  filesChanged?: number;
  estimatedCostUsd?: number;
  replayId?: string;
  gateFailures?: number;
};

type RunDetail = {
  run: RunRecord;
  steps: Array<{ id: string; step_type: string; status: string; summary: string; created_at: number }>;
};

const LOCAL_RUN_LEDGER_KEY = "elyra_agent_runs";

function loadRunRecords(): RunRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_RUN_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function AppRunsWindow() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [scope, setScope] = useState<"all" | "code" | "orchestrator">("all");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = () => {
      setLoading(true);
      const nextRuns = loadRunRecords();
      setRuns(nextRuns);
      if (!activeRunId && nextRuns[0]?.id) {
        setActiveRunId(nextRuns[0].id);
      }
      setLoading(false);
    };

    load();
    const timer = window.setInterval(load, 1500);
    const onUpdated = () => load();
    window.addEventListener("elyra:run-ledger-updated", onUpdated);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("elyra:run-ledger-updated", onUpdated);
    };
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId) {
      setDetail(null);
      return;
    }

    const run = runs.find((item) => item.id === activeRunId) ?? null;
    if (!run) {
      setDetail(null);
      return;
    }

    const statusSummary =
      run.status === "planning"
        ? "Generating plan"
        : run.status === "running"
          ? "Applying changes, running tests and build"
          : run.status === "failed"
            ? "Run completed with verification issues"
            : "Run completed successfully";

    setDetail({
      run,
      steps: [
        { id: `${run.id}-stage`, step_type: "stage", status: run.stage, summary: `Promotion stage: ${run.stage.toUpperCase()}`, created_at: run.startedAt },
        { id: `${run.id}-status`, step_type: "status", status: run.status, summary: statusSummary, created_at: run.updatedAt },
        { id: `${run.id}-files`, step_type: "files", status: String(run.filesChanged ?? 0), summary: `${run.filesChanged ?? 0} files changed`, created_at: run.updatedAt },
      ],
    });
  }, [activeRunId, runs]);

  const visibleRuns = useMemo(
    () => runs.filter((run) => (scope === "all" ? true : run.app === scope)),
    [runs, scope],
  );
  const activeRun = useMemo(() => visibleRuns.find((item) => item.id === activeRunId) ?? null, [visibleRuns, activeRunId]);
  const commandCenter = useMemo(() => {
    const failed = visibleRuns.filter((run) => run.status === "failed").length;
    const running = visibleRuns.filter((run) => run.status === "running" || run.status === "planning").length;
    const completed = visibleRuns.filter((run) => run.status === "completed").length;
    const gateFailures = visibleRuns.reduce((total, run) => total + (run.gateFailures ?? 0), 0);
    const totalCost = visibleRuns.reduce((total, run) => total + (run.estimatedCostUsd ?? 0), 0);
    return { failed, running, completed, gateFailures, totalCost };
  }, [visibleRuns]);

  return (
    <section className="ec-grid-2" style={{ padding: 14 }}>
      <article className="ec-panel ec-panel-scroll">
        <p className="ec-overline">Agent Runs</p>
        <div className="ec-list" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {(["all", "code", "orchestrator"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className="ec-card"
              style={{
                flex: 1,
                textAlign: "center",
                borderColor: scope === value ? "var(--ec-accent)" : undefined,
              }}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        {loading ? <p>Loading runs...</p> : null}
        <div className="ec-list">
          {visibleRuns.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setActiveRunId(run.id)}
              className="ec-card"
              style={{ textAlign: "left", borderColor: run.id === activeRunId ? "var(--ec-accent)" : undefined }}
            >
              <strong>{run.app.toUpperCase()} · {run.stage.toUpperCase()} · {run.status}</strong>
              <p>{run.task}</p>
              <small>{run.agent} · {new Date(run.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          {visibleRuns.length === 0 && !loading ? <p>No local agent runs yet.</p> : null}
        </div>
      </article>
      <article className="ec-panel ec-panel-scroll">
        <p className="ec-overline">Command Center</p>
        <div className="ec-list" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
          <div className="ec-card"><strong>Running</strong><p>{commandCenter.running}</p></div>
          <div className="ec-card"><strong>Failed</strong><p>{commandCenter.failed}</p></div>
          <div className="ec-card"><strong>Completed</strong><p>{commandCenter.completed}</p></div>
          <div className="ec-card"><strong>Gate fails</strong><p>{commandCenter.gateFailures}</p></div>
        </div>
        <p style={{ marginTop: 0, marginBottom: 12 }}><small>Estimated cost: ${commandCenter.totalCost.toFixed(4)}</small></p>
        <p className="ec-overline">Run Detail</p>
        {!activeRun ? <p>Select a run.</p> : null}
        {activeRun ? (
          <div className="ec-stack">
            <strong>{activeRun.stage.toUpperCase()} · {activeRun.status}</strong>
            <p>{activeRun.task}</p>
            <small>{activeRun.id}</small>
            <small>{activeRun.repoUrl || "-"}</small>
            <small>{activeRun.summary ?? "-"}</small>
            <small>Estimated cost: ${(activeRun.estimatedCostUsd ?? 0).toFixed(4)}</small>
            <small>Replay ID: {activeRun.replayId ?? "-"}</small>
            {activeRun.previewUrl ? (
              <a href={activeRun.previewUrl} target="_blank" rel="noreferrer">Open preview</a>
            ) : null}
          </div>
        ) : null}
        <hr className="ec-separator" />
        <p className="ec-overline">Steps</p>
        <div className="ec-list">
          {(detail?.steps ?? []).map((step) => (
            <div key={step.id} className="ec-card">
              <strong>{step.step_type}</strong>
              <p>{step.status}</p>
              <small>{step.summary}</small>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
