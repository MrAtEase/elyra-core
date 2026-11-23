import { db } from "../client.js";
import type { Run, RunStatus } from "../../types/run.js";

export async function createRun(run: Run): Promise<void> {
  const { error } = await db().from("ai_runs").insert({
    id: run.id,
    workspace_id: run.workspaceId,
    user_id: run.userId,
    prompt: run.prompt,
    status: run.status,
    plan_summary: run.planSummary,
  });
  if (error) throw error;
}

export async function getRun(id: string): Promise<Run | null> {
  const { data, error } = await db()
    .from("ai_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return mapRun(data);
}

export async function updateRunStatus(id: string, status: RunStatus): Promise<void> {
  const { error } = await db()
    .from("ai_runs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

function mapRun(row: Record<string, unknown>): Run {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    userId: row["user_id"] as string,
    prompt: row["prompt"] as string,
    status: row["status"] as RunStatus,
    planSummary: (row["plan_summary"] as string) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}
