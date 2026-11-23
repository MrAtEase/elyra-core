import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import {
  deleteProject, getRun, listProjects, providerStatus, recommend, runCheck, saveProject, suggestPrompts, VisibilityError,
} from "@/lib/visibility/engine";
import { runBrandCheck } from "@/lib/visibility/brand";
import { fireEvent } from "@/lib/automations/store";

export const runtime = "nodejs";
export const maxDuration = 300;

async function authorize(request: NextRequest, requested: string): Promise<string | NextResponse> {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const workspaces = (who.payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
  if (!workspaceId || !(hasWorkspaceAccess(who.payload, workspaceId) || hasWorkspaceAccess(who.payload, requested))) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  return workspaceId;
}

const fail = (error: unknown) =>
  NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: error instanceof VisibilityError ? 400 : 502 });

/** GET /api/os/visibility?workspaceId=… [&runId=…] */
export async function GET(request: NextRequest) {
  const ws = await authorize(request, (request.nextUrl.searchParams.get("workspaceId") ?? "").trim());
  if (ws instanceof NextResponse) return ws;
  try {
    const runId = request.nextUrl.searchParams.get("runId");
    if (runId) return NextResponse.json({ ok: true, run: await getRun(ws, runId) });
    const { projects, runs, brand_runs } = await listProjects(ws);
    return NextResponse.json({ ok: true, providers: providerStatus(), projects, runs, brand_runs });
  } catch (error) {
    if (error instanceof VisibilityError) return NextResponse.json({ ok: true, providers: providerStatus(), projects: [], runs: [], setup_error: error.message });
    return fail(error);
  }
}

/** POST /api/os/visibility – { workspaceId, action: save|delete|suggest|run|recommend, … } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ws = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (ws instanceof NextResponse) return ws;
  const id = typeof body.id === "string" ? body.id : null;
  try {
    switch (body.action) {
      case "save":
        return NextResponse.json({ ok: true, project: await saveProject(ws, id, (body.project ?? {}) as Record<string, unknown>) });
      case "delete":
        if (!id) throw new VisibilityError("id fehlt");
        await deleteProject(ws, id);
        return NextResponse.json({ ok: true });
      case "suggest": {
        const p = (body.project ?? {}) as Record<string, unknown>;
        const prompts = await suggestPrompts({
          name: String(p.name ?? ""), industry: (p.industry as string) || null, location: (p.location as string) || null, domain: (p.domain as string) || null,
        });
        return NextResponse.json({ ok: true, prompts });
      }
      case "run":
        if (!id) throw new VisibilityError("id fehlt");
      {
        const run = await runCheck(ws, id);
        void fireEvent(ws, "visibility.completed", { run_id: run.id, summary: run.summary });
        return NextResponse.json({ ok: true, run });
      }
      case "brand":
        if (!id) throw new VisibilityError("id fehlt");
      {
        const run = await runBrandCheck(ws, id);
        void fireEvent(ws, "brand.completed", { run_id: run.id, summary: run.summary });
        return NextResponse.json({ ok: true, run });
      }
      case "recommend":
        if (typeof body.runId !== "string") throw new VisibilityError("runId fehlt");
        return NextResponse.json({ ok: true, recommendations: await recommend(ws, body.runId) });
      default:
        return NextResponse.json({ ok: false, error: "Unbekannte Aktion." }, { status: 400 });
    }
  } catch (error) {
    return fail(error);
  }
}
