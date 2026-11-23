import type { RunStatus, StepStatus, ActionCard } from "./run.js";
import type { OrbVisualState } from "./kernel.js";

export type SSEEvent =
  | { event: "run.started"; data: { runId: string; summary: string } }
  | { event: "step.started"; data: { stepId: string; index: number; label: string } }
  | { event: "step.progress"; data: { stepId: string; chunk: string } }
  | { event: "step.completed"; data: { stepId: string; status: StepStatus; output: Record<string, unknown> | null } }
  | { event: "step.approval_required"; data: { stepId: string; label: string; description: string } }
  | { event: "artifact.created"; data: { id: string; type: string; title: string; runId: string | null; intentId: string | null; payloadRef: string | null } }
  | { event: "run.completed"; data: { runId: string; status: RunStatus; assistantText: string; actionCards?: ActionCard[] } }
  | { event: "run.failed"; data: { runId: string; error: string } }
  | { event: "orb.state"; data: { state: OrbVisualState } }
  | { event: "heartbeat"; data: { ts: number } };
