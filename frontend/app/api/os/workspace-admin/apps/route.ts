import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { patchInstalledApp } from "@/lib/orb-os/contracts/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

const bodySchema = z.object({
  app_id: z.string().min(1),
  action: z.enum(["install", "enable", "disable", "uninstall"]),
});

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

export async function PATCH(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  const role = (payload.membership?.role || "member").toLowerCase();
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }
  if (role !== "owner") {
    return NextResponse.json({ ok: false, error: "OWNER_REQUIRED" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsed.error.issues }, { status: 400 });
  }

  const actorUserId = payload.user?.id || payload.userId || payload.userKey || null;
  await patchInstalledApp({
    workspaceId,
    appId: parsed.data.app_id,
    action: parsed.data.action,
    actorUserId,
  });

  return NextResponse.json({ ok: true });
}
