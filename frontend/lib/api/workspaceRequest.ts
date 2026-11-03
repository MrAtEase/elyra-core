import type { NextRequest } from "next/server";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

const WORKSPACE_ID_PATTERN = /^ws-[a-z0-9-]+$/;

export type WorkspaceResolution =
  | {
      ok: true;
      workspaceId: string | null;
      source: "query.workspace_id" | "query.workspaceId" | "header.x-workspace-id" | "none";
    }
  | {
      ok: false;
      error: "missing_workspace_id" | "invalid_workspace_id";
      reason: string;
      hint: string;
      status: 400;
    };

function pickWorkspaceId(raw: {
  workspace_id?: string | null;
  workspaceId?: string | null;
  xWorkspaceId?: string | null;
}): { value: string | null; source: "query.workspace_id" | "query.workspaceId" | "header.x-workspace-id" | "none" } {
  if (raw.workspace_id?.trim()) return { value: raw.workspace_id, source: "query.workspace_id" };
  if (raw.workspaceId?.trim()) return { value: raw.workspaceId, source: "query.workspaceId" };
  if (raw.xWorkspaceId?.trim()) return { value: raw.xWorkspaceId, source: "header.x-workspace-id" };
  return { value: null, source: "none" };
}

export function resolveWorkspaceIdFromRequestParts(raw: {
  workspace_id?: string | null;
  workspaceId?: string | null;
  xWorkspaceId?: string | null;
  required?: boolean;
}): WorkspaceResolution {
  const picked = pickWorkspaceId(raw);
  if (!picked.value) {
    if (raw.required) {
      return {
        ok: false,
        error: "missing_workspace_id",
        reason: "Workspace id is missing.",
        hint: "Provide workspace_id or workspaceId query param, or x-workspace-id header.",
        status: 400,
      };
    }
    return { ok: true, workspaceId: null, source: "none" };
  }

  const normalized = normalizeWorkspaceId(picked.value);
  if (!normalized) {
    return {
      ok: false,
      error: "invalid_workspace_id",
      reason: `Invalid workspace id: ${picked.value}`,
      hint: "Expected format: ws-<slug>. Example: ws-personal",
      status: 400,
    };
  }

  return { ok: true, workspaceId: normalized, source: picked.source };
}

export function getWorkspaceId(request: NextRequest, required = false): WorkspaceResolution {
  return resolveWorkspaceIdFromRequestParts({
    workspace_id: request.nextUrl.searchParams.get("workspace_id"),
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
    xWorkspaceId: request.headers.get("x-workspace-id"),
    required,
  });
}

// ---------------------------------------------------------------------------
// Canonical workspace ID resolution
// Maps frontend-hardcoded IDs (ws-personal, ws-elyra-core, ws-fish-delish)
// to real workspace UUIDs from the whoami response.
// ---------------------------------------------------------------------------
const CANONICAL_TYPE_MAP: Record<string, string> = {
  "ws-personal": "personal",
  "ws-elyra-core": "system_platform",
  "ws-fish-delish": "organization",
};

export function resolveCanonicalWorkspaceId(
  requestedId: string | null,
  workspaces: Array<{ id: string; slug?: string; type?: string }>
): string | null {
  console.log("[resolveCanonicalWorkspaceId] Input", { 
    requestedId, 
    workspaceCount: workspaces.length,
    workspaces: workspaces.map(w => ({ id: w.id, slug: w.slug, type: w.type }))
  });
  
  if (!requestedId) return workspaces[0]?.id ?? null;

  // Direct match by ID (already a real UUID)
  const direct = workspaces.find((ws) => ws.id === requestedId);
  if (direct) {
    console.log("[resolveCanonicalWorkspaceId] Found direct match", direct.id);
    return direct.id;
  }

  // Normalize and try again
  const normalized = normalizeWorkspaceId(requestedId) ?? requestedId;
  console.log("[resolveCanonicalWorkspaceId] Normalized ID", { requestedId, normalized });

  // Match by normalized ID or slug
  const byIdOrSlug = workspaces.find((ws) => {
    const wsNormId = normalizeWorkspaceId(ws.id) ?? ws.id;
    const wsNormSlug = normalizeWorkspaceId(ws.slug ?? "") ?? ws.slug;
    return wsNormId === normalized || wsNormSlug === normalized;
  });
  if (byIdOrSlug) return byIdOrSlug.id;

  // Map canonical frontend IDs to workspace types
  const targetType = CANONICAL_TYPE_MAP[normalized];
  console.log("[resolveCanonicalWorkspaceId] Type mapping", { normalized, targetType });
  if (targetType) {
    const byType = workspaces.find((ws) => ws.type === targetType);
    console.log("[resolveCanonicalWorkspaceId] Found by type", { targetType, found: byType?.id });
    if (byType) return byType.id;
    
    // Special case: if ws-personal is requested but no personal workspace exists,
    // fall back to the first available workspace
    const firstWorkspace = workspaces[0];
    if (normalized === "ws-personal" && firstWorkspace) {
      console.log(
        "[resolveCanonicalWorkspaceId] ws-personal requested but no personal workspace found, falling back to first workspace",
        firstWorkspace.id
      );
      return firstWorkspace.id;
    }
  }

  // Match by slug containing the canonical suffix (e.g. "fish-delish")
  const slugSuffix = normalized.replace(/^ws-/, "");
  if (slugSuffix) {
    const bySlugContains = workspaces.find((ws) => ws.slug?.includes(slugSuffix));
    if (bySlugContains) return bySlugContains.id;
  }

  return null;
}
