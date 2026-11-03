import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import type { WhoamiResponse } from "@/types/whoami";

// Accepts both ws-slug format AND Supabase UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
const WORKSPACE_ID_PATTERN = /^(ws-[a-z0-9-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9][a-z0-9_-]{1,62})$/;

export function resolvePathWorkspaceId(raw: string): string | null {
  const normalized = normalizeWorkspaceId(raw);
  if (!normalized) return null;
  return WORKSPACE_ID_PATTERN.test(normalized) ? normalized : null;
}

export async function requireWorkspaceAccessFromPath(
  request: NextRequest,
  rawWorkspaceId: string,
): Promise<
  | { ok: true; workspaceId: string; payload: WhoamiResponse }
  | { ok: false; response: NextResponse }
> {
  const workspaceId = resolvePathWorkspaceId(rawWorkspaceId);
  if (!workspaceId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "invalid_workspace_id",
          reason: `Invalid workspace id: ${rawWorkspaceId}`,
          hint: "Use workspace ids in format ws-<slug>.",
        },
        { status: 400 },
      ),
    };
  }

  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "authentication_required" }, { status: 401 }),
    };
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "workspace_not_accessible" }, { status: 403 }),
    };
  }

  return { ok: true, workspaceId, payload: payload as WhoamiResponse };
}

