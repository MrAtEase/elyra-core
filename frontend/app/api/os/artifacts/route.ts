import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createArtifactSchema, listArtifactsQuerySchema } from "@/lib/orb-os/artifacts/schema";
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

export async function GET(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = listArtifactsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_QUERY", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionWorkspaceId = activeWorkspaceId(payload);
  if (!sessionWorkspaceId || parsed.data.workspace_id !== sessionWorkspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_SCOPE_MISMATCH" }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("os_tool_artifacts")
    .select("id,workspace_id,run_id,tool_call_id,artifact_type,title,ui_card_hint,link_url,payload_json,metadata_json,created_at,updated_at")
    .eq("workspace_id", parsed.data.workspace_id)
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.run_id) query = query.eq("run_id", parsed.data.run_id);
  if (parsed.data.tool_call_id) query = query.eq("tool_call_id", parsed.data.tool_call_id);
  if (parsed.data.artifact_type) query = query.eq("artifact_type", parsed.data.artifact_type);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: "ARTIFACTS_READ_FAILED", details: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    workspace_id: parsed.data.workspace_id,
    artifacts: (data ?? []).map((row) => ({
      ...row,
      payload_json: row.payload_json ?? {},
      metadata_json: row.metadata_json ?? {},
    })),
  });
}

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const parsed = createArtifactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() }, { status: 400 });
  }

  const sessionWorkspaceId = activeWorkspaceId(payload);
  if (!sessionWorkspaceId || parsed.data.workspace_id !== sessionWorkspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_SCOPE_MISMATCH" }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient();
  const record = {
    workspace_id: parsed.data.workspace_id,
    run_id: parsed.data.run_id,
    tool_call_id: parsed.data.tool_call_id,
    artifact_type: parsed.data.artifact_type,
    title: parsed.data.title,
    ui_card_hint: parsed.data.ui_card_hint,
    link_url: parsed.data.link_url ?? null,
    payload_json: parsed.data.payload_json,
    metadata_json: parsed.data.metadata_json,
    created_by: payload.user?.id ?? payload.userId ?? payload.userKey ?? null,
  };

  const { data, error } = await supabase
    .from("os_tool_artifacts")
    .insert(record)
    .select("id,workspace_id,run_id,tool_call_id,artifact_type,title,ui_card_hint,link_url,payload_json,metadata_json,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: "ARTIFACTS_WRITE_FAILED", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, artifact: data });
}
