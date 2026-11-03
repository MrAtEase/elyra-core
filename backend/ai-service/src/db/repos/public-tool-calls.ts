import { db } from "../client.js";

type PublicToolCallStatus = "pending" | "running" | "completed" | "failed";

type CreateParams = {
  id: string;
  runId: string;
  runStepId?: string | null;
  workspaceId: string;
  toolName: string;
  requestJson?: Record<string, unknown>;
};

type UpdateParams = {
  status?: PublicToolCallStatus;
  responseJson?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string;
};

export async function createPublicToolCall(params: CreateParams): Promise<void> {
  const { error } = await db().from("tool_calls").insert({
    id: params.id,
    run_id: params.runId,
    run_step_id: params.runStepId ?? null,
    workspace_id: params.workspaceId,
    tool_name: params.toolName,
    request_json: params.requestJson ?? {},
    status: "pending",
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function updatePublicToolCall(id: string, updates: UpdateParams): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.status) payload.status = updates.status;
  if (updates.responseJson !== undefined) payload.response_json = updates.responseJson;
  if (updates.error !== undefined) payload.error = updates.error;
  if (updates.startedAt) payload.started_at = updates.startedAt;
  if (updates.finishedAt) payload.finished_at = updates.finishedAt;
  if (Object.keys(payload).length === 0) return;
  const { error } = await db().from("tool_calls").update(payload).eq("id", id);
  if (error) throw error;
}
