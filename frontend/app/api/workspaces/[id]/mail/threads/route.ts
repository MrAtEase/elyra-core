import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";
import { buildRuntimeIntegrationStatus } from "@/lib/orb-os/contracts/integrationStatus";
import { getWorkspaceMailPolicy } from "@/lib/workspace/mailProviderPolicy";

function resolveMailProvider(
  workspaceId: string,
  status: Awaited<ReturnType<typeof buildRuntimeIntegrationStatus>>,
): "imap" | "google" | null {
  const policy = getWorkspaceMailPolicy(workspaceId);
  const imap =
    status.find((entry) => entry.integration_id === "imap") ??
    status.find((entry) => entry.integration_id === "icloud_imap");
  if (
    policy.allowed.includes("imap") &&
    imap?.connected &&
    imap.state === "connected"
  ) {
    return "imap";
  }

  const google = status.find((entry) => entry.integration_id === "google_oauth");
  if (
    policy.allowed.includes("google") &&
    google?.connected &&
    google.state === "connected"
  ) {
    return "google";
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const userId =
    auth.payload.user?.id || auth.payload.userId || auth.payload.userKey || null;
  const integrationStatus = await buildRuntimeIntegrationStatus(auth.workspaceId, userId);
  const provider = resolveMailProvider(auth.workspaceId, integrationStatus);
  if (!provider) {
    const policy = getWorkspaceMailPolicy(auth.workspaceId);
    const expected = policy.preferred === "imap" ? "iCloud/IMAP" : "Google";
    return NextResponse.json(
      {
        ok: false,
        error: "not_connected",
        message: `Mail is not connected for this workspace. Expected provider: ${expected}.`,
      },
      { status: 409 },
    );
  }

  const origin = request.nextUrl.origin;
  const upstreamUrl =
    provider === "imap"
      ? new URL(`/api/mail/imap/messages?workspace_id=${encodeURIComponent(auth.workspaceId)}`, origin)
      : new URL(`/api/gmail/messages?workspace_id=${encodeURIComponent(auth.workspaceId)}`, origin);
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === "workspace_id" || key === "workspaceId") continue;
    upstreamUrl.searchParams.set(key, value);
  }

  const upstream = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "x-workspace-id": auth.workspaceId,
    },
    cache: "no-store",
  });
  const payload = await upstream.json().catch(() => null);
  return NextResponse.json(
    {
      ...(payload && typeof payload === "object" ? payload : { ok: upstream.ok }),
      workspaceId: auth.workspaceId,
      provider,
    },
    { status: upstream.status },
  );
}
