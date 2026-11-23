import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { listSystemHealth } from "@/lib/orb-os/observability/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

async function whoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as WhoamiResponse | null;
  return { response, payload };
}

export async function GET(request: NextRequest) {
  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }
  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }
  const data = await listSystemHealth(workspaceId);
  return NextResponse.json({ ok: true, workspace_id: workspaceId, ...data });
}
