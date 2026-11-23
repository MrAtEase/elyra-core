import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertDataPlaneWrite } from "@/lib/orb-os/cqrs/ownership";

export type RunEventType =
  | "RUN_CREATED"
  | "PLAN_WRITTEN"
  | "TOOL_REQUESTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_GRANTED"
  | "AUTH_REQUIRED"
  | "TOOL_STARTED"
  | "TOOL_COMPLETED"
  | "ARTIFACT_CREATED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED"
  | "RUN_CANCELLED";

export async function appendRunEvent(input: {
  workspaceId: string;
  runId: string;
  eventType: RunEventType;
  toolCallId?: string | null;
  correlationId?: string | null;
  createdBy?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  assertDataPlaneWrite("run_events");
  const { error } = await supabase.from("run_events").insert({
    workspace_id: input.workspaceId,
    run_id: input.runId,
    tool_call_id: input.toolCallId ?? null,
    event_type: input.eventType,
    correlation_id: input.correlationId ?? null,
    created_by: input.createdBy ?? null,
    payload_json: input.payload ?? {},
  });

  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[run-events] append failed", error.message);
  }
}

export async function listRunEvents(input: {
  workspaceId: string;
  runId: string;
  limit?: number;
}) {
  const supabase = getSupabaseAdminClient();
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const { data, error } = await supabase
    .from("run_events")
    .select("id,workspace_id,run_id,tool_call_id,event_type,payload_json,correlation_id,created_by,created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("run_id", input.runId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list run events: ${error.message}`);
  }

  return data ?? [];
}
