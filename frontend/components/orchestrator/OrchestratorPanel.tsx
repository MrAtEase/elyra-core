"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Code2,
  FileText,
  ListTodo,
  Mail,
  PlayCircle,
} from "lucide-react";
import { Badge, Button, Card, ListRow, Tabs } from "@/components/os/primitives";

export type OrchestratorStepStatus = "ready" | "needs-confirm" | "running" | "done" | "failed";

export type OrchestratorStep = {
  id: string;
  kind: "context" | "email" | "doc" | "calendar" | "task" | "code";
  title: string;
  status: OrchestratorStepStatus;
  detail: string;
};

const iconByKind = {
  context: CircleDashed,
  email: Mail,
  doc: FileText,
  calendar: CalendarDays,
  task: ListTodo,
  code: Code2,
};

const statusTone: Record<OrchestratorStepStatus, "neutral" | "accent" | "warning" | "danger"> = {
  ready: "neutral",
  "needs-confirm": "warning",
  running: "accent",
  done: "accent",
  failed: "danger",
};

const statusLabel: Record<OrchestratorStepStatus, string> = {
  ready: "Ready",
  "needs-confirm": "Needs Confirm",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

function statusIcon(status: OrchestratorStepStatus) {
  if (status === "done") return <CheckCircle2 size={14} />;
  if (status === "failed") return <AlertTriangle size={14} />;
  if (status === "running") return <PlayCircle size={14} />;
  return <CircleDashed size={14} />;
}

export default function OrchestratorPanel({
  tab,
  onTab,
  steps,
  onRun,
  summary,
  error,
  runBusy = false,
  runDisabled = false,
  onRetry,
  onOpenLogs,
  contractTitle,
  contractScope,
  contractDone,
  contractVerification,
}: {
  tab: "Understand" | "Plan" | "Run";
  onTab: (value: "Understand" | "Plan" | "Run") => void;
  steps: OrchestratorStep[];
  onRun: () => void;
  summary?: string | null;
  error?: string | null;
  runBusy?: boolean;
  runDisabled?: boolean;
  onRetry?: (() => void) | undefined;
  onOpenLogs?: (() => void) | undefined;
  contractTitle?: string | null;
  contractScope?: string | null;
  contractDone?: string[] | undefined;
  contractVerification?: string[] | undefined;
}) {
  return (
    <Card className="ec-orchestrator">
      <div className="ec-orchestrator__head">
        <h3>Orchestrator</h3>
        <Badge tone="accent">Understand · Plan · Run</Badge>
      </div>
      <Tabs tabs={["Understand", "Plan", "Run"]} active={tab} onChange={(value) => onTab(value as "Understand" | "Plan" | "Run")} />

      {tab === "Understand" ? (
        <div className="ec-orchestrator__section">
          <p>{summary?.trim() || "Intent analyzed with workspace context, active app state and supervision policy."}</p>
          <ListRow title="Intent confidence" description="Model confidence" trailing={<strong>0.93</strong>} />
          <ListRow title="Mutation guard" description="External writes require confirm" trailing={<Badge tone="warning">Enabled</Badge>} />
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>
      ) : null}

      {tab === "Plan" ? (
        <div className="ec-orchestrator__section">
          {contractTitle ? (
            <div className="rounded-xl border border-white/10 p-3 text-xs">
              <p className="font-semibold text-white/90">{contractTitle}</p>
              {contractScope ? <p className="mt-1 text-white/55">{contractScope}</p> : null}
              {contractDone && contractDone.length > 0 ? (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wider text-white/40">Definition of done</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-white/60">
                    {contractDone.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {steps.map((step) => {
            const Icon = iconByKind[step.kind];
            return (
              <ListRow
                key={step.id}
                title={step.title}
                description={step.detail}
                trailing={
                  <span className="ec-step-status">
                    {statusIcon(step.status)}
                    <Badge tone={statusTone[step.status]}>{statusLabel[step.status]}</Badge>
                    <Icon size={14} />
                  </span>
                }
              />
            );
          })}
        </div>
      ) : null}

      {tab === "Run" ? (
        <div className="ec-orchestrator__section">
          <p>{summary?.trim() || "Execution logs, output artifacts and confirmation checkpoints are recorded here."}</p>
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          {contractVerification && contractVerification.length > 0 ? (
            <div className="rounded-xl border border-white/10 p-3 text-xs">
              <p className="text-[10px] uppercase tracking-wider text-white/40">Verification</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-white/60">
                {contractVerification.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="ec-orchestrator__run-actions">
            <Button onClick={onRun} disabled={runDisabled || runBusy}>
              {runBusy ? "Running..." : "Run Plan"}
            </Button>
            <Button variant="outline" onClick={onRetry} disabled={!onRetry || runBusy}>Retry failed</Button>
            <Button variant="ghost" onClick={onOpenLogs} disabled={!onOpenLogs}>Open logs</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
