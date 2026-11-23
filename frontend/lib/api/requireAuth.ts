import { NextResponse, type NextRequest } from "next/server";
import type { WhoamiResponse } from "@/types/whoami";
import { fetchWhoamiPayload, getWhoamiUserId } from "@/lib/api/whoamiClient";
import { isFounderIdentity } from "@/lib/workspace/workspaceModel";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";

export type AuthenticatedRequest = { payload: WhoamiResponse; userId: string; email: string | null };

/**
 * Central login check for API routes.
 * Returns the authenticated user, or a ready-made error response (401) to return as-is.
 */
export async function requireUser(request: NextRequest): Promise<AuthenticatedRequest | NextResponse> {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  const payload = who?.response.ok ? who.payload : null;
  const userId = payload ? getWhoamiUserId(payload) : null;
  if (!payload || !userId) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }
  return { payload, userId, email: payload.user?.email ?? null };
}

/**
 * Platform owner only (the operator of this Elyra instance).
 * Used for anything that touches the codebase, the server or other workspaces.
 */
export async function requirePlatformOwner(request: NextRequest): Promise<AuthenticatedRequest | NextResponse> {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!isFounderIdentity(auth.email)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  return auth;
}

export type WorkspaceRequest = AuthenticatedRequest & { workspaceId: string };

/**
 * Login + workspace membership in one step.
 * Resolves aliases like "ws-personal" to the user's real workspace id and rejects
 * any workspace the user is not a member of (403). Use the returned workspaceId for all reads/writes.
 */
export async function requireWorkspace(
  request: NextRequest,
  requestedWorkspaceId: string | null | undefined,
): Promise<WorkspaceRequest | NextResponse> {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  const workspaces = (auth.payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const requested = (requestedWorkspaceId ?? "").trim();
  const workspaceId = requested
    ? resolveCanonicalWorkspaceId(requested, workspaces)
    : (auth.payload.activeWorkspace?.id ?? workspaces[0]?.id ?? null);
  if (!workspaceId || !workspaces.some((ws) => ws.id === workspaceId)) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_FORBIDDEN" }, { status: 403 });
  }
  return { ...auth, workspaceId };
}
