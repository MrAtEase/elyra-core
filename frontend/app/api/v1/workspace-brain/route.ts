import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/api/requireAuth";

export const runtime = "nodejs";

type WorkspaceRow = {
  id: string;
  slug: string | null;
  name: string | null;
  kind: string | null;
};

function normalizeWorkspaceKind(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "individual" || value === "personal" || value === "private") return "individual";
  if (value === "platform" || value === "system") return "platform";
  return "organization";
}

export async function GET(request: NextRequest) {
  try {
    // Login + membership; aliases like "ws-personal" resolve to the user's real workspace.
    const access = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
    if (access instanceof NextResponse) return access;
    const workspaceId = access.workspaceId;
    const supabase = getSupabaseAdminClient();

    // Fetch workspace meta
    const { data: workspaceRow } = await supabase
      .from("workspaces")
      .select("id, slug, name, kind")
      .eq("id", workspaceId)
      .maybeSingle<WorkspaceRow>();

    const workspace = workspaceRow
      ? {
          id: workspaceRow.id,
          slug: workspaceRow.slug ?? null,
          name: workspaceRow.name ?? "Workspace",
          kind: normalizeWorkspaceKind(workspaceRow.kind),
        }
      : {
          id: workspaceId,
          slug: null,
          name: "Workspace",
          kind: normalizeWorkspaceKind(workspaceId === "elyra-core" ? "platform" : "organization"),
        };

    // Fetch workspace identity / brain profile
    const { data: identityRow } = await supabase
      .from("workspace_identity")
      .select("profile_json")
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ profile_json: Record<string, unknown> | null }>();

    const profile = identityRow?.profile_json
      ? identityRow.profile_json
      : { kind: workspace.kind };

    return NextResponse.json({ workspace, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[api/v1/workspace-brain GET] CRITICAL FAILURE: ${message}`, { stack });
    
    // Fallback to minimal valid response to prevent frontend crash
    return NextResponse.json({ 
      workspace: null, 
      profile: { kind: "individual" },
      error: message,
      degraded: true 
    }, { status: 200 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Login + membership required for writes.
    const access = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
    if (access instanceof NextResponse) return access;
    const workspaceId = access.workspaceId;

    let body: { profile?: Record<string, unknown> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.profile || typeof body.profile !== "object") {
      return NextResponse.json({ error: "profile required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const now = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("workspace_identity")
      .upsert(
        {
          workspace_id: workspaceId,
          profile_json: body.profile,
          updated_at: now,
        },
        { onConflict: "workspace_id" }
      );

    if (upsertError) {
      console.error("[api/v1/workspace-brain PUT] upsert failed:", upsertError.message);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ workspaceId, profile: body.profile });
  } catch (error) {
    console.error("[api/v1/workspace-brain PUT] error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
