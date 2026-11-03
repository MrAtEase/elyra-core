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
