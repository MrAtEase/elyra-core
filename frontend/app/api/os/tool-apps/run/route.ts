import { NextRequest, NextResponse } from "next/server";
import { authorizeTasks } from "@/lib/tasks/authorize";
import { runToolApp, ToolRunError, type ToolAppId } from "@/lib/toolApps/runToolApp";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Best-effort usage log (shows up under Workspace Admin › Billing). */
async function logRun(workspaceId: string, userId: string | null, intent: string, ok: boolean, error?: string) {
  if (!userId) return;
  try {
    const now = new Date().toISOString();
    await getSupabaseAdminClient().from("orchestration_runs").insert({
      workspace_id: workspaceId, user_id: userId, status: ok ? "done" : "failed", intent,
      plan_json: { source: "toolbox" }, error: error ?? null, started_at: now, finished_at: now, updated_at: now,
    });
  } catch { /* usage logging must never break the tool */ }
}

export const runtime = "nodejs";
export const maxDuration = 90;

const TOOLS: ToolAppId[] = ["elli", "research", "translate", "weather", "daily_planner", "company_builder"];

/** POST /api/os/tool-apps/run – { workspaceId, tool, action, fields } → { ok, markdown, sources? } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const auth = await authorizeTasks(request, workspaceId);
  if (auth instanceof NextResponse) return auth;

  const tool = body.tool as ToolAppId;
  if (!TOOLS.includes(tool)) return NextResponse.json({ ok: false, error: "Unbekanntes Werkzeug." }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";
  const rawFields = body.fields && typeof body.fields === "object" ? (body.fields as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) if (typeof value === "string") fields[key] = value;

  try {
    const result = await runToolApp({ workspaceId: auth.workspaceId, tool, action, fields });
    void logRun(auth.workspaceId, auth.userId, `${tool}.${action}`, true);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    void logRun(auth.workspaceId, auth.userId, `${tool}.${action}`, false, error instanceof Error ? error.message : String(error));
    if (error instanceof ToolRunError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[api/os/tool-apps/run] failed", { tool, action, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, error: "Das Werkzeug ist gerade nicht erreichbar. Bitte gleich nochmal versuchen." }, { status: 502 });
  }
}
