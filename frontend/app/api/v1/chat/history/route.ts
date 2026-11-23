import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    // Auth (optional — return empty on failure, never 401)
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();

    if (!token) {
      return NextResponse.json({ messages: [] });
    }

    const supabase = getSupabaseAdminClient();
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return NextResponse.json({ messages: [] });
    }

    const resolvedWorkspace = getWorkspaceId(request, false);
    const workspaceId = resolvedWorkspace.ok ? resolvedWorkspace.workspaceId ?? "" : "";
    const limitRaw = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

    if (!workspaceId) {
      return NextResponse.json({ messages: [] });
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, model, created_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Table might not exist yet — return empty gracefully
      console.warn("[api/v1/chat/history] query failed:", error.message);
      return NextResponse.json({ messages: [] });
    }

    // Return in chronological order (oldest first)
    const messages = (data ?? []).reverse();
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("[api/v1/chat/history] unexpected error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ messages: [] });
  }
}

/**
 * Deletes the messages of a chat thread the user removed in Elly's panel.
 * Messages are not stored per thread on the server, so they are matched by content
 * within the thread's time window – only the caller's own messages in that workspace.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } = await import("@/lib/api/whoamiClient");
    const { resolveCanonicalWorkspaceId } = await import("@/lib/api/workspaceRequest");
    const who = await fetchWhoamiPayload(request).catch(() => null);
    const userId = who?.response.ok ? getWhoamiUserId(who.payload) : null;
    if (!who?.payload || !userId) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      messages?: Array<{ content?: string; createdAt?: number }>;
    };
    const requested = String(body.workspaceId ?? "").trim();
    const workspaces = (who.payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
    const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
    if (!workspaceId || !(hasWorkspaceAccess(who.payload, workspaceId) || hasWorkspaceAccess(who.payload, requested))) {
      return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
    }

    const items = (body.messages ?? []).filter((m) => typeof m.content === "string" && m.content.trim());
    if (items.length === 0) return NextResponse.json({ ok: true, deleted: 0 });
    const contents = new Set(items.map((m) => m.content!.trim()));
    const times = items.map((m) => Number(m.createdAt)).filter((t) => Number.isFinite(t) && t > 0);
    const margin = 15 * 60 * 1000; // client and server clocks/timestamps differ slightly
    const from = times.length ? new Date(Math.min(...times) - margin).toISOString() : null;
    const to = times.length ? new Date(Math.max(...times) + margin).toISOString() : null;

    const supabase = getSupabaseAdminClient();
    let query = supabase
      .from("chat_messages")
      .select("id, content")
      .in("workspace_id", Array.from(new Set([workspaceId, requested].filter(Boolean))))
      .eq("user_id", userId)
      .limit(500);
    if (from && to) query = query.gte("created_at", from).lte("created_at", to);
    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: true, deleted: 0, warning: error.message });

    const ids = (data ?? []).filter((row) => contents.has(String(row.content ?? "").trim())).map((row) => row.id);
    if (ids.length > 0) {
      const { error: deleteError } = await supabase.from("chat_messages").delete().in("id", ids).eq("user_id", userId);
      if (deleteError) return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Fehler" }, { status: 500 });
  }
}
