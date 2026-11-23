import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { listRunEvents } from "@/lib/orb-os/events/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function activeWorkspaceId(payload: WhoamiResponse): string | null {
  return payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null;
}

function buildRunReadModel(events: Array<Record<string, unknown>>) {
  const timeline: Array<{ at: string; type: string; summary: string; tool_call_id: string | null }> = [];
  let status: "queued" | "running" | "waiting_for_approval" | "waiting_for_auth" | "succeeded" | "failed" | "cancelled" = "queued";

  for (const event of events) {
    const type = String(event.event_type ?? "UNKNOWN");
    const at = String(event.created_at ?? new Date().toISOString());
    const toolCallId = typeof event.tool_call_id === "string" ? event.tool_call_id : null;
    const payload = event.payload_json && typeof event.payload_json === "object"
      ? (event.payload_json as Record<string, unknown>)
      : null;
    const payloadSummary = typeof payload?.summary === "string" ? payload.summary : null;

    if (type === "TOOL_STARTED") status = "running";
    if (type === "APPROVAL_REQUIRED") status = "waiting_for_approval";
    if (type === "AUTH_REQUIRED") status = "waiting_for_auth";
    if (type === "RUN_SUCCEEDED") status = "succeeded";
    if (type === "RUN_FAILED") status = "failed";
    if (type === "RUN_CANCELLED") status = "cancelled";

    timeline.push({
      at,
      type,
      tool_call_id: toolCallId,
      summary: payloadSummary ?? type.replaceAll("_", " ").toLowerCase(),
    });
  }

  return {
    status,
    last_event_at: timeline[timeline.length - 1]?.at ?? null,
    timeline,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error_code: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = activeWorkspaceId(payload);
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error_code: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const params = await context.params;
  const runId = params.runId;
  if (!runId) {
    return NextResponse.json({ ok: false, error_code: "INVALID_RUN_ID" }, { status: 400 });
  }

  const events = await listRunEvents({ workspaceId, runId, limit: 500 });
  return NextResponse.json({ ok: true, workspace_id: workspaceId, run_id: runId, events, read_model: buildRunReadModel(events) });
}
