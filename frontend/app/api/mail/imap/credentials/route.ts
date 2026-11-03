import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { upsertWorkspaceIntegrationConnection } from "@/lib/integrations/store";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

type MailCredentialsRequest = {
  workspaceId: string;
  credentials: {
    email?: string;
    imapHost?: string;
    imapPort?: number | null;
    username: string;
    appPassword?: string;
    smtpHost?: string;
    smtpPort?: number | null;
    smtpUsername?: string;
    smtpAppPassword?: string;
    smtpSecure?: boolean;
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
  const { workspaceId, credentials } = body as MailCredentialsRequest;
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) ?? workspaceId;
  const normalizedUsername = (credentials?.username ?? "").trim();
  const normalizedImapPassword =
    (credentials?.appPassword ?? "").trim() ||
    (credentials?.smtpAppPassword ?? "").trim();
  if (!normalizedWorkspaceId || !normalizedUsername || !normalizedImapPassword) {
    return NextResponse.json(
      {
        error: "workspaceId_and_credentials_required",
        message: "workspaceId, username and iCloud app password are required.",
      },
      { status: 400 }
    );
  }
  if (!hasWorkspaceAccess(payload, normalizedWorkspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }
  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }
  try {
    const email = (credentials.email ?? credentials.username).trim().toLowerCase();
    const username = normalizedUsername;
    const normalizedSmtpUsername = (credentials.smtpUsername ?? "").trim() || username;
    const encryptedPassword = encryptIntegrationSecret(normalizedImapPassword);

    // Validate IMAP login before persisting "connected".
    await requestEmailIo("/icloud/folders", {
      method: "POST",
      body: {
        userId,
        workspaceId: normalizedWorkspaceId,
        provider: "icloud_imap",
        credentials: {
          email: username,
          appPassword: normalizedImapPassword,
          imapHost: credentials.imapHost,
          imapPort: credentials.imapPort,
        },
      },
      context: { provider: "icloud_imap", reason: "mail/imap/test-before-save" },
      request,
    });
    // Persist canonical compatibility row first (older DB constraints commonly allow icloud_imap).
    await upsertWorkspaceIntegrationConnection({
      workspaceId: normalizedWorkspaceId,
      provider: "icloud_imap",
      userId,
      status: "connected",
      email,
      imapHost: credentials.imapHost ?? "imap.mail.me.com",
      imapPort: credentials.imapPort ?? 993,
      smtpHost: credentials.smtpHost ?? "smtp.mail.me.com",
      smtpPort: credentials.smtpPort ?? 587,
      username,
      encryptedPassword,
      sslTlsEnabled: credentials.smtpSecure ?? true,
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: null,
    });
    // Best-effort canonical alias for newer runtimes expecting provider=imap.
    await upsertWorkspaceIntegrationConnection({
      workspaceId: normalizedWorkspaceId,
      provider: "imap",
      userId,
      status: "connected",
      email,
      imapHost: credentials.imapHost ?? "imap.mail.me.com",
      imapPort: credentials.imapPort ?? 993,
      smtpHost: credentials.smtpHost ?? "smtp.mail.me.com",
      smtpPort: credentials.smtpPort ?? 587,
      username,
      encryptedPassword,
      sslTlsEnabled: credentials.smtpSecure ?? true,
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: null,
    }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[mail/imap/credentials] optional imap alias persist failed", err);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    // Persist failing health state for workspace-scoped app status derivation.
    await upsertWorkspaceIntegrationConnection({
      workspaceId: normalizedWorkspaceId,
      provider: "icloud_imap",
      userId,
      status: "error",
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: "auth_failed",
    }).catch(() => undefined);
    await upsertWorkspaceIntegrationConnection({
      workspaceId: normalizedWorkspaceId,
      provider: "imap",
      userId,
      status: "error",
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: "auth_failed",
    }).catch(() => undefined);
    return handleEmailIoApiError({
      route: "mail/imap/credentials",
      workspaceId: normalizedWorkspaceId,
      error,
    });
  }
}
