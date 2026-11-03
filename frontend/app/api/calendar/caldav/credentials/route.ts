import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { upsertWorkspaceIntegrationConnection } from "@/lib/integrations/store";

type CaldavCredentialsRequest = {
  workspaceId: string;
  credentials: {
    serverUrl: string;
    username: string;
    appPassword: string;
  };
};

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { workspaceId, credentials } = body as CaldavCredentialsRequest;
  if (!workspaceId || !credentials?.serverUrl || !credentials?.username || !credentials?.appPassword) {
    return NextResponse.json({ error: "workspaceId_and_credentials_required" }, { status: 400 });
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }
  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }
  try {
    const normalizedServerUrl = credentials.serverUrl.trim();
    const normalizedUsername = credentials.username.trim().toLowerCase();
    const encryptedPassword = encryptIntegrationSecret(credentials.appPassword);

    await requestEmailIo("/caldav/test", {
      method: "POST",
      body: {
        userId,
        workspaceId,
        provider: "icloud_caldav",
        credentials: {
          serverUrl: normalizedServerUrl,
          username: normalizedUsername,
          appPassword: credentials.appPassword,
        },
      },
      context: { provider: "icloud_caldav", reason: "calendar/caldav/test-before-save" },
      request,
    });
    await upsertWorkspaceIntegrationConnection({
      workspaceId,
      provider: "icloud_caldav",
      userId,
      status: "connected",
      imapHost: normalizedServerUrl,
      username: normalizedUsername,
      encryptedPassword,
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: null,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    await upsertWorkspaceIntegrationConnection({
      workspaceId,
      provider: "icloud_caldav",
      userId,
      status: "error",
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: "auth_failed",
    }).catch(() => undefined);
    return handleEmailIoApiError({
      route: "calendar/caldav/credentials",
      workspaceId,
      error,
    });
  }
}
