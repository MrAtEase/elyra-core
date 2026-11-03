import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { summarizeChiefRunRow } from "@/lib/orb-os/orchestrator/chiefRunReadModel";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

export const runtime = "nodejs";

type OrchestrationRunRow = {
  id: string;
  status: string;
  intent: string;
  updated_at: string;
  plan_json: Record<string, unknown> | null;
  error: string | null;
};

export async function GET(request: NextRequest) {
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

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 12;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("orchestration_runs")
    .select("id,status,intent,updated_at,plan_json,error")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<OrchestrationRunRow[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const runs = (data ?? []).map((row) => summarizeChiefRunRow(row));

  return NextResponse.json({ ok: true, runs });
}
