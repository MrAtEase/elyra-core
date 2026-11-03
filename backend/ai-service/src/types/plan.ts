export type PlanStep = {
  index: number;
  toolName: string;
  label: string;
  input: Record<string, unknown>;
  requiresApproval: boolean;
};

export type OrchestratorPlan = {
  summary: string;
  steps: PlanStep[];
};
