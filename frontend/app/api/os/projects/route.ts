import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";
import { getWorkspaceId, resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

const createSchema = z.object({
  name: z.string().min(1).max(120),
});

const updateSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["rename", "archive"]),
  name: z.string().min(1).max(120).optional(),
});

async function whoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as WhoamiResponse | null;
  return { response, payload };
}

function pickWorkspace(payload: WhoamiResponse, requested: string | null): string | null {
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
  // Resolve canonical frontend IDs (ws-personal, ws-elyra-core) to real UUIDs
  if (requested) {
    const realId = resolveCanonicalWorkspaceId(requested, workspaces);
    if (realId) return realId;
  }
  const activeRaw =
    payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null;
  return activeRaw ?? workspaces[0]?.id ?? null;
}

export async function GET(request: NextRequest) {
  const parsedWorkspace = getWorkspaceId(request, false);
  if (!parsedWorkspace.ok) {
    return NextResponse.json({ ok: false, error: parsedWorkspace.error, reason: parsedWorkspace.reason, hint: parsedWorkspace.hint }, { status: parsedWorkspace.status });
  }

  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = pickWorkspace(payload, parsedWorkspace.workspaceId);
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const client = getSupabaseAdminClient() as any;
  const { data, error } = await client
    .from("workspace_projects")
    .select("id,workspace_id,name,archived,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    // When migrations are not applied yet, don't break the whole OS shell.
    if (
      typeof error.message === "string" &&
      (error.message.includes("workspace_projects") || error.message.includes("does not exist"))
    ) {
      return NextResponse.json({ ok: true, workspace_id: workspaceId, projects: [] });
    }
    return NextResponse.json({ ok: false, error: "PROJECTS_FETCH_FAILED", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, workspace_id: workspaceId, projects: data ?? [] });
}

export async function POST(request: NextRequest) {
  const parsedWorkspace = getWorkspaceId(request, false);
  if (!parsedWorkspace.ok) {
    return NextResponse.json({ ok: false, error: parsedWorkspace.error, reason: parsedWorkspace.reason, hint: parsedWorkspace.hint }, { status: parsedWorkspace.status });
  }

  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = pickWorkspace(payload, parsedWorkspace.workspaceId);
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const parsedBody = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsedBody.error.issues }, { status: 400 });
  }

  const actor = payload.user?.id || payload.userId || payload.userKey || null;
  const client = getSupabaseAdminClient() as any;
  const { data, error } = await client
    .from("workspace_projects")
    .insert({ workspace_id: workspaceId, name: parsedBody.data.name.trim(), created_by: actor, archived: false })
    .select("id,workspace_id,name,archived,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: "PROJECT_CREATE_FAILED", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, project: data });
}

export async function PATCH(request: NextRequest) {
  const parsedWorkspace = getWorkspaceId(request, false);
  if (!parsedWorkspace.ok) {
    return NextResponse.json({ ok: false, error: parsedWorkspace.error, reason: parsedWorkspace.reason, hint: parsedWorkspace.hint }, { status: parsedWorkspace.status });
  }

  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = pickWorkspace(payload, parsedWorkspace.workspaceId);
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const parsedBody = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsedBody.error.issues }, { status: 400 });
  }

  const client = getSupabaseAdminClient() as any;
  const updateValues: Record<string, unknown> = {};
  if (parsedBody.data.action === "rename") {
    updateValues.name = parsedBody.data.name?.trim() || "Project";
  }
  if (parsedBody.data.action === "archive") {
    updateValues.archived = true;
  }

  const { data, error } = await client
    .from("workspace_projects")
    .update(updateValues)
    .eq("workspace_id", workspaceId)
    .eq("id", parsedBody.data.id)
    .select("id,workspace_id,name,archived,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: "PROJECT_UPDATE_FAILED", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, project: data });
}
