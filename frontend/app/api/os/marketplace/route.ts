import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import {
  askForMiniApp, deleteMiniApp, generateMiniApp, getInstalled, getMiniApp, listMiniApps, MarketplaceError,
  saveMiniApp, saveMiniAppData, setInstalled,
} from "@/lib/marketplace/store";

export const runtime = "nodejs";
export const maxDuration = 180;

type Who = { workspaceId: string; userId: string | null; canManage: boolean; personal: boolean };

async function authorize(request: NextRequest, requested: string): Promise<Who | NextResponse> {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const payload = who.payload;
  const workspaces = (payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
  if (!workspaceId || !(hasWorkspaceAccess(payload, workspaceId) || hasWorkspaceAccess(payload, requested))) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  // Who may install/remove: own personal workspace, or owner/admin of a shared one.
  const ws = workspaces.find((w) => w.id === workspaceId);
  const personal = /personal|individual|private/i.test(String(ws?.type ?? "")) || /personal/i.test(workspaceId);
  const membership = payload.membership;
  const role = membership && (membership.workspaceId === workspaceId || membership.workspaceId === requested) ? membership.role.toLowerCase() : "";
  const canManage = personal || role === "owner" || role === "admin" || role === "system_owner";
  return { workspaceId, userId: getWhoamiUserId(payload), canManage, personal };
}

const ownerOnly = () =>
  NextResponse.json({ ok: false, error: "Nur Owner oder Admin dieses Workspace können Apps installieren oder entfernen." }, { status: 403 });

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const a = await authorize(request, (params.get("workspaceId") ?? "").trim());
  if (a instanceof NextResponse) return a;
  try {
    const miniAppId = params.get("miniApp");
    if (miniAppId) return NextResponse.json({ ok: true, miniApp: await getMiniApp(a.workspaceId, miniAppId) });
    const [{ installed, setupError }, miniApps] = await Promise.all([getInstalled(a.workspaceId), listMiniApps(a.workspaceId)]);
    return NextResponse.json({ ok: true, workspaceId: a.workspaceId, canManage: a.canManage, personal: a.personal, installed, miniApps, ...(setupError ? { setupError } : {}) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: err instanceof MarketplaceError ? 400 : 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const a = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (a instanceof NextResponse) return a;
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  try {
    switch (body.action) {
      case "install":
      case "uninstall":
        if (!a.canManage) return ownerOnly();
        await setInstalled(a.workspaceId, str("itemId"), body.action === "install", a.userId);
        return NextResponse.json({ ok: true });
      case "miniapp.generate": {
        if (!a.canManage) return ownerOnly();
        const result = await generateMiniApp({ description: str("description"), previousHtml: str("previousHtml") || null, feedback: str("feedback") || null });
        return NextResponse.json({ ok: true, draft: result });
      }
      case "miniapp.save": {
        if (!a.canManage) return ownerOnly();
        const saved = await saveMiniApp(a.workspaceId, a.userId, {
          id: str("id") || null, name: str("name"), description: str("description"), icon: str("icon"), prompt: str("prompt"), html: str("html"),
        });
        return NextResponse.json({ ok: true, miniApp: saved });
      }
      case "miniapp.delete":
        if (!a.canManage) return ownerOnly();
        await deleteMiniApp(a.workspaceId, str("id"));
        return NextResponse.json({ ok: true });
      case "miniapp.data":
        await saveMiniAppData(a.workspaceId, str("id"), (body.data ?? {}) as Record<string, unknown>);
        return NextResponse.json({ ok: true });
      case "miniapp.ask":
        return NextResponse.json({ ok: true, text: await askForMiniApp(a.workspaceId, str("prompt")) });
      default:
        return NextResponse.json({ ok: false, error: "Unbekannte Aktion." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: err instanceof MarketplaceError ? 400 : 500 });
  }
}
