import type { OrchestratorPlan } from "@/components/orchestrator/types";

/**
 * Represents the status of an orchestration run.
 * This corresponds to the `public.orchestration_run_status` ENUM in the database.
 */
export type OrchestrationRunStatus =
  | "thinking"
  | "plan_ready"
  | "executing"
  | "done"
  | "failed"
  | "canceled";

/**
 * Represents a persisted AI agent run in the database.
 * This corresponds to the `public.orchestration_runs` table.
 */
export type OrchestrationRun = {
  id: string; // uuid
  workspace_id: string; // uuid
  user_id: string; // uuid
  status: OrchestrationRunStatus;
  intent: string | null;
  plan_json: OrchestratorPlan | null;
  current_step_id: string | null;
  error: string | null;
  started_at: string; // timestamptz
  finished_at: string | null; // timestamptz
  created_at: string; // timestamptz
  updated_at: string; // timestamptz
};
