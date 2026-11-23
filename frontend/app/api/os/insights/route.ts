import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import { DEFAULT_FEEDS, DEFAULT_FOCUS, DEFAULT_QUERY, deleteDigest, DigestError, listDigests, runDigest, testFeeds } from "@/lib/insights/digest";
import { fireEvent } from "@/lib/automations/store";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  try {
    return NextResponse.json({ ok: true, digests: await listDigests(a.workspaceId), defaults: { query: DEFAULT_QUERY, focus: DEFAULT_FOCUS, feeds: DEFAULT_FEEDS } });
  } catch (err) {
    return NextResponse.json({ ok: true, digests: [], defaults: { query: DEFAULT_QUERY, focus: DEFAULT_FOCUS, feeds: DEFAULT_FEEDS }, setup_error: (err as Error).message });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const a = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (a instanceof NextResponse) return a;
  try {
    if (body.action === "testFeeds") {
      const feeds = Array.isArray(body.feeds) ? body.feeds.map(String) : [];
      return NextResponse.json({ ok: true, results: await testFeeds(feeds, typeof body.days === "number" ? body.days : 7) });
    }
    if (body.action === "delete" && typeof body.id === "string") {
      await deleteDigest(a.workspaceId, body.id);
      return NextResponse.json({ ok: true });
    }
    const d = await runDigest({
      workspaceId: a.workspaceId, userId: a.userId,
      days: typeof body.days === "number" ? body.days : undefined,
      query: typeof body.query === "string" ? body.query : undefined,
      focus: typeof body.focus === "string" ? body.focus : undefined,
          source: body.source === "gmail" || body.source === "rss" || body.source === "both" ? body.source : undefined,
          feeds: Array.isArray(body.feeds) ? body.feeds.map(String) : undefined,
    });
    void fireEvent(a.workspaceId, "digest.created", { id: d.id, days: d.days, message_count: d.message_count, content: d.content, sources: d.sources });
    return NextResponse.json({ ok: true, digest: d });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: err instanceof DigestError ? 400 : 502 });
  }
}
