import { NextRequest, NextResponse } from "next/server";
import { AutomationError, fireEvent, verifyToken } from "@/lib/automations/store";
import { DigestError, runDigest } from "@/lib/insights/digest";
import { listProjects, runCheck, VisibilityError } from "@/lib/visibility/engine";
import { runBrandCheck } from "@/lib/visibility/brand";
import { createTask } from "@/lib/tasks/taskStore";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Eingehende Automationen (n8n, Make, Zapier, curl).
 * POST /api/hooks/elyra  ·  Authorization: Bearer elyra_…  ·  { "action": "ping" | "digest.run" | "visibility.run" | "brand.run" | "task.create", … }
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim() || request.headers.get("x-elyra-token")?.trim() || "";
  const who = token ? await verifyToken(token).catch(() => null) : null;
  if (!who) return NextResponse.json({ ok: false, error: "Ungültiger oder fehlender API-Token (Authorization: Bearer elyra_…)." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "ping");
  const ws = who.workspaceId;

  const findProject = async () => {
    const name = String(body.project ?? "").trim().toLowerCase();
    const { projects } = await listProjects(ws);
    const p = name ? projects.find((x) => x.name.toLowerCase() === name || x.id === body.project) ?? projects.find((x) => x.name.toLowerCase().includes(name)) : projects[0];
    if (!p) throw new VisibilityError(name ? `Projekt „${body.project}“ nicht gefunden.` : "Kein Projekt in KI-Sichtbarkeit angelegt.");
    return p;
  };

  try {
    switch (action) {
      case "ping":
        return NextResponse.json({ ok: true, pong: true, workspace_id: ws, time: new Date().toISOString() });
      case "digest.run": {
        const d = await runDigest({
          workspaceId: ws, userId: who.userId,
          days: typeof body.days === "number" ? body.days : undefined,
          query: typeof body.query === "string" ? body.query : undefined,
          focus: typeof body.focus === "string" ? body.focus : undefined,
          source: body.source === "gmail" || body.source === "rss" || body.source === "both" ? body.source : undefined,
          feeds: Array.isArray(body.feeds) ? body.feeds.map(String) : undefined,
        });
        void fireEvent(ws, "digest.created", { id: d.id, days: d.days, message_count: d.message_count, content: d.content, sources: d.sources });
        return NextResponse.json({ ok: true, digest: { id: d.id, created_at: d.created_at, message_count: d.message_count, content: d.content, sources: d.sources }, warnings: d.warnings });
      }
      case "visibility.run": {
        const p = await findProject();
        const run = await runCheck(ws, p.id);
        const payload = { project: p.name, run_id: run.id, summary: run.summary };
        void fireEvent(ws, "visibility.completed", payload);
        return NextResponse.json({ ok: true, ...payload });
      }
      case "brand.run": {
        const p = await findProject();
        const run = await runBrandCheck(ws, p.id);
        const payload = { project: p.name, run_id: run.id, summary: run.summary };
        void fireEvent(ws, "brand.completed", payload);
        return NextResponse.json({ ok: true, ...payload });
      }
      case "task.create": {
        const title = String(body.title ?? "").trim();
        if (!title) return NextResponse.json({ ok: false, error: "title fehlt." }, { status: 400 });
        const task = await createTask(ws, who.userId, { title: title.slice(0, 300), dueAt: typeof body.due_at === "string" ? body.due_at : null });
        void fireEvent(ws, "task.created", { task });
        return NextResponse.json({ ok: true, task });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unbekannte Aktion „${action}“.`, actions: ["ping", "digest.run", "visibility.run", "brand.run", "task.create"] }, { status: 400 });
    }
  } catch (err) {
    const known = err instanceof DigestError || err instanceof VisibilityError || err instanceof AutomationError;
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: known ? 400 : 502 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "Elyra Automations-Endpoint. POST mit Authorization: Bearer elyra_… und {\"action\":\"ping\"}." });
}
