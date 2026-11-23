import { db } from "../client.js";
import type { RunStep, StepStatus } from "../../types/run.js";

export async function createStep(step: RunStep): Promise<void> {
  const { error } = await db().from("ai_run_steps").insert({
    id: step.id,
    run_id: step.runId,
    index: step.index,
    tool_name: step.toolName,
    label: step.label,
    status: step.status,
    input: step.input,
    requires_approval: step.requiresApproval,
  });
  if (error) throw error;
}

export async function updateStepStatus(
  id: string,
  status: StepStatus,
  output?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (output !== undefined) update["output"] = output;
  if (status === "completed" || status === "failed") {
    update["completed_at"] = new Date().toISOString();
  }
  const { error } = await db().from("ai_run_steps").update(update).eq("id", id);
  if (error) throw error;
}

export async function getStepsByRun(runId: string): Promise<RunStep[]> {
  const { data, error } = await db()
    .from("ai_run_steps")
    .select("*")
    .eq("run_id", runId)
    .order("index");
  if (error) throw error;
  return (data ?? []).map(mapStep);
}

function mapStep(row: Record<string, unknown>): RunStep {
  return {
    id: row["id"] as string,
    runId: row["run_id"] as string,
    index: row["index"] as number,
    toolName: row["tool_name"] as string,
    label: row["label"] as string,
    status: row["status"] as StepStatus,
    input: (row["input"] as Record<string, unknown>) ?? {},
    output: (row["output"] as Record<string, unknown>) ?? null,
    requiresApproval: row["requires_approval"] as boolean,
    createdAt: row["created_at"] as string,
    completedAt: (row["completed_at"] as string) ?? null,
  };
}
