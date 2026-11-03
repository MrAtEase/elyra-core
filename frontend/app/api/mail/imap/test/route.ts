import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

type ImapTestRequest = {
  workspaceId: string;
  credentials: {
    imapHost?: string;
    imapPort?: number | null;
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
  const { workspaceId, credentials } = body as ImapTestRequest;
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) ?? workspaceId;
  if (!normalizedWorkspaceId || !credentials?.username || !credentials?.appPassword) {
    return NextResponse.json({ error: "workspaceId_and_credentials_required" }, { status: 400 });
  }
  if (!hasWorkspaceAccess(payload, normalizedWorkspaceId)) {
    const debug =
      process.env.NODE_ENV !== "production"
        ? {
            requestedWorkspaceId: normalizedWorkspaceId,
            activeWorkspaceId: payload.activeWorkspace?.id ?? payload.session?.activeWorkspaceId ?? payload.workspaceId ?? null,
            workspacesCount: Array.isArray(payload.workspaces) ? payload.workspaces.length : 0,
          }
        : undefined;
    return NextResponse.json({ error: "workspace_not_accessible", ...(debug ? { debug } : {}) }, { status: 403 });
  }
  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }
  try {
    await requestEmailIo("/icloud/folders", {
      method: "POST",
      body: {
        userId,
        workspaceId: normalizedWorkspaceId,
        provider: "icloud_imap",
        credentials: {
          email: credentials.username,
          appPassword: credentials.appPassword,
          imapHost: credentials.imapHost,
          imapPort: credentials.imapPort,
        },
      },
      context: { provider: "icloud_imap", reason: "mail/imap/test" },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return handleEmailIoApiError({
      route: "mail/imap/test",
      workspaceId: normalizedWorkspaceId,
      error,
    });
  }
}
