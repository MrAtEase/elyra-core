import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import {
  ACTIONS, AutomationError, createToken, deleteHook, EVENTS, listHooks, listTokens, revokeToken, saveHook, testHook,
} from "@/lib/automations/store";

export const runtime = "nodejs";

async function authorize(request: NextRequest, requested: string) {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const workspaces = (who.payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
  if (!workspaceId || !(hasWorkspaceAccess(who.payload, workspaceId) || hasWorkspaceAccess(who.payload, requested))) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  return { workspaceId, userId: getWhoamiUserId(who.payload) };
}

export async function GET(request: NextRequest) {
  const a = await authorize(request, (request.nextUrl.searchParams.get("workspaceId") ?? "").trim());
  if (a instanceof NextResponse) return a;
  const meta = { events: EVENTS, actions: ACTIONS, endpoint: `${request.nextUrl.origin}/api/hooks/elyra` };
  try {
    const [hooks, tokens] = await Promise.all([listHooks(a.workspaceId), listTokens(a.workspaceId)]);
    return NextResponse.json({ ok: true, ...meta, hooks, tokens });
  } catch (err) {
    return NextResponse.json({ ok: true, ...meta, hooks: [], tokens: [], setup_error: (err as Error).message });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const a = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (a instanceof NextResponse) return a;
  const id = typeof body.id === "string" ? body.id : null;
  try {
    switch (body.action) {
      case "hook.save":
        return NextResponse.json({ ok: true, hook: await saveHook(a.workspaceId, id, (body.hook ?? {}) as Record<string, never>) });
      case "hook.delete":
        if (!id) throw new AutomationError("id fehlt");
        await deleteHook(a.workspaceId, id);
        return NextResponse.json({ ok: true });
      case "hook.test":
        if (!id) throw new AutomationError("id fehlt");
        return NextResponse.json({ ok: true, result: await testHook(a.workspaceId, id) });
      case "token.create": {
        const t = await createToken(a.workspaceId, a.userId, String(body.name ?? "n8n"));
        return NextResponse.json({ ok: true, ...t });
      }
      case "token.revoke":
        if (!id) throw new AutomationError("id fehlt");
        await revokeToken(a.workspaceId, id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ ok: false, error: "Unbekannte Aktion." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: err instanceof AutomationError ? 400 : 502 });
  }
}
