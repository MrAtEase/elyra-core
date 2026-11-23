import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import {
  aiProviders, getSettings, healthChecks, listAudit, listGeminiModels, listMarketplace, listToolPolicies,
  saveSettings, testAi, updateRiskPolicy, updateToolPolicy, usage,
} from "@/lib/admin/controlCenter";

export const runtime = "nodejs";
export const maxDuration = 60;

type Auth = { workspaceId: string; userId: string | null; role: string };

async function authorize(request: NextRequest, requested: string): Promise<Auth | NextResponse> {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const payload = who.payload;
  const workspaces = (payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
  if (!workspaceId || !(hasWorkspaceAccess(payload, workspaceId) || hasWorkspaceAccess(payload, requested))) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  const role = String(payload.membership?.role ?? "owner").toLowerCase();
  return { workspaceId, userId: getWhoamiUserId(payload), role };
}

const canManage = (role: string) => role === "owner" || role === "admin" || role === "manager";

/** GET /api/os/admin/control?workspaceId=…&section=marketplace|policies|health|billing|ai */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, (request.nextUrl.searchParams.get("workspaceId") ?? "").trim());
  if (auth instanceof NextResponse) return auth;
  const section = request.nextUrl.searchParams.get("section") ?? "";
  try {
    switch (section) {
      case "marketplace":
        return NextResponse.json({ ok: true, role: auth.role, apps: await listMarketplace(auth.workspaceId, auth.userId) });
      case "policies": {
        const [tools, audit] = await Promise.all([listToolPolicies(auth.workspaceId), listAudit(auth.workspaceId)]);
        return NextResponse.json({ ok: true, role: auth.role, tools, audit });
      }
      case "health":
        return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), checks: await healthChecks(auth.workspaceId, auth.userId) });
      case "billing": {
        const [u, s] = await Promise.all([usage(auth.workspaceId), getSettings(auth.workspaceId)]);
        return NextResponse.json({ ok: true, role: auth.role, usage: u, settings: s.settings, storage: s.storage, storage_error: s.error ?? null });
      }
      case "ai": {
        const [s, models] = await Promise.all([getSettings(auth.workspaceId), listGeminiModels()]);
        return NextResponse.json({ ok: true, role: auth.role, providers: aiProviders(), models, settings: s.settings, storage: s.storage, storage_error: s.error ?? null, env_model: process.env.GEMINI_MODEL ?? null });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unbekannter Bereich." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Fehler" }, { status: 502 });
  }
}

/** POST /api/os/admin/control – { workspaceId, action, ... } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (auth instanceof NextResponse) return auth;
  const action = String(body.action ?? "");
  try {
    if (action === "test_ai") {
      const kind = body.kind === "search" ? "search" : "text";
      return NextResponse.json({ ok: true, result: await testAi(kind, typeof body.model === "string" ? body.model : null) });
    }
    if (!canManage(auth.role)) return NextResponse.json({ ok: false, error: "Nur Owner/Admin dürfen das ändern." }, { status: 403 });
    if (action === "save_settings") {
      const settings = await saveSettings(auth.workspaceId, (body.patch ?? {}) as never, auth.userId);
      return NextResponse.json({ ok: true, settings });
    }
    if (action === "tool_policy" && typeof body.tool_name === "string") {
      await updateToolPolicy(auth.workspaceId, body.tool_name, {
        ...(typeof body.requires_approval === "boolean" ? { requires_approval: body.requires_approval } : {}),
        ...(body.status === "enabled" || body.status === "disabled" ? { status: body.status } : {}),
      }, auth.userId);
      return NextResponse.json({ ok: true });
    }
    if (action === "risk_policy" && (body.risk_level === "writes" || body.risk_level === "destructive") && typeof body.requires_approval === "boolean") {
      await updateRiskPolicy(auth.workspaceId, body.risk_level, body.requires_approval, auth.userId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Fehler" }, { status: 502 });
  }
}
