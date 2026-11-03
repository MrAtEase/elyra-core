import { NextRequest, NextResponse } from "next/server";
import { listRunEvents } from "@/lib/orb-os/events/store";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { buildChiefRunReadModel } from "@/lib/orb-os/orchestrator/chiefRunReadModel";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

export const runtime = "nodejs";

type RunDetailRow = {
  id: string;
  workspace_id: string;
  status: string;
  intent: string;
  updated_at: string;
  error: string | null;
  plan_json: Record<string, unknown> | null;
};

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const workspaceId = normalizeWorkspaceId(request.nextUrl.searchParams.get("workspaceId") ?? "") ?? request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
  }

  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "Unable to validate session." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "Workspace access denied." }, { status: 403 });
  }

  const { runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ ok: false, error: "runId is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("orchestration_runs")
    .select("id,workspace_id,status,intent,updated_at,error,plan_json")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle<RunDetailRow>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
  }

  const events = await listRunEvents({ workspaceId, runId, limit: 200 });
  const { data: artifacts, error: artifactError } = await supabase
    .from("os_tool_artifacts")
    .select("id,run_id,tool_call_id,artifact_type,title,ui_card_hint,link_url,payload_json,metadata_json,created_at")
    .eq("workspace_id", workspaceId)
    .eq("run_id", runId)
    .order("created_at", { ascending: false });

  if (artifactError) {
    return NextResponse.json({ ok: false, error: artifactError.message }, { status: 500 });
  }

  const readModel = buildChiefRunReadModel(events);
  const plan = data.plan_json && typeof data.plan_json === "object" ? data.plan_json : {};
  return NextResponse.json({
    ok: true,
    run: {
      id: data.id,
      workspaceId: data.workspace_id,
      status: data.status,
      intent: data.intent,
      updatedAt: data.updated_at,
      error: data.error,
      executorType: typeof plan.executor === "string" ? plan.executor : null,
      contract: plan.contract ?? null,
      result: plan.result ?? null,
    },
    readModel,
    artifacts: (artifacts ?? []).map((artifact) => ({
      ...artifact,
      payload_json: artifact.payload_json ?? {},
      metadata_json: artifact.metadata_json ?? {},
    })),
  });
}
