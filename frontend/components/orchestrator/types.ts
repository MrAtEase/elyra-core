export type IntentState = "idle" | "listening" | "thinking" | "plan_ready" | "executing";

export type ActionType =
  | "create_text"
  | "create_image"
  | "translate"
  | "create_doc"
  | "create_spreadsheet"
  | "create_slides"
  | "email"
  | "calendar"
  | "task"
  | "build";

export type ActionSafety = "safe" | "confirm" | "confirm_cost";

export type ActionStatus = "idle" | "proposed" | "confirmed" | "running" | "done" | "failed";

export type IntentAttachment = {
  id: string;
  label: string;
};

export type ActionOutput = {
  id: string;
  label: string;
  kind: "draft" | "artifact" | "link" | "log";
  value: string;
};

export type OrchestratorAction = {
  id: string;
  type: ActionType;
  title: string;
  whatWillHappen: string;
  safety: ActionSafety;
  status: ActionStatus;
  inputs: Record<string, string>;
  outputs: ActionOutput[];
  notes?: string;
  toolHint?: string;
};

export type PlanStepStatus = "pending" | "ready" | "running" | "done" | "blocked";

export type PlanStep = {
  id: string;
  title: string;
  description: string;
  tool: string;
  status: PlanStepStatus;
  actions: OrchestratorAction[];
};

export type OrchestratorPlan = {
  intent: string;
  reason: string;
  assumptions: string[];
  steps: PlanStep[];
};

export type WorkspaceViewMode = "private" | "business";
