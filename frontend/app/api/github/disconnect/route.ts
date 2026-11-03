import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { disconnectGitHubToken } from "@/lib/github/tokenStore";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { workspaceId?: string } | null;
  const workspaceId = normalizeWorkspaceId(body?.workspaceId ?? "") ?? body?.workspaceId ?? "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_required" }, { status: 400 });
  }

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }

  await disconnectGitHubToken(workspaceId);
  return NextResponse.json({ ok: true });
}
