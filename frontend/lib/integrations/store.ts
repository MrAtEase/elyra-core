import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type WorkspaceIntegrationProvider =
  | "google"
  | "github"
  | "microsoft"
  | "imap"
  | "icloud_imap"
  | "icloud_caldav";

const MISSING_COLUMN_RE = /Could not find the '([^']+)' column of 'integrations'/i;
const LEGACY_IMAP_TOKEN_PREFIX = "imap_v1:";

function encodeLegacyImapPayload(payload: Record<string, unknown>): string {
  return `${LEGACY_IMAP_TOKEN_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

async function persistLegacyImapToken(input: {
  workspaceId: string;
  provider: WorkspaceIntegrationProvider;
  userId: string | null;
  status: "connected" | "disconnected" | "error";
  email?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  username?: string | null;
  encryptedPassword?: string | null;
  sslTlsEnabled?: boolean | null;
  lastHealthCheckAt?: string | null;
  errorCode?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const { data: integration, error: integrationError } = await supabase
    .from("integrations")
    .upsert(
      {
        workspace_id: input.workspaceId,
        provider: input.provider,
        status: input.status,
        connected_user_id: input.userId,
      },
      { onConflict: "workspace_id,provider" }
    )
    .select("id")
    .single();

  if (integrationError || !integration?.id) {
    throw new Error(
      `Unable to persist legacy integration row for ${input.provider}: ${
        integrationError?.message ?? "missing integration id"
      }`
    );
  }

  const legacyPayload = {
    provider: input.provider,
    email: input.email ?? null,
    username: input.username ?? null,
    encryptedPassword: input.encryptedPassword ?? null,
    imapHost: input.imapHost ?? null,
    imapPort: input.imapPort ?? null,
    smtpHost: input.smtpHost ?? null,
    smtpPort: input.smtpPort ?? null,
    sslTlsEnabled: input.sslTlsEnabled ?? true,
    lastHealthCheckAt: input.lastHealthCheckAt ?? null,
    errorCode: input.errorCode ?? null,
  };

  const { error: cleanupError } = await supabase
    .from("integration_tokens")
    .delete()
    .eq("integration_id", integration.id);

  if (cleanupError) {
    throw new Error(
      `Unable to clear legacy IMAP token payload for ${input.provider}: ${cleanupError.message}`
    );
  }

  const { error: tokenError } = await supabase.from("integration_tokens").insert({
    integration_id: integration.id,
    access_token: null,
    refresh_token: encodeLegacyImapPayload(legacyPayload),
    scope: "imap_compat",
    expires_at: null,
  });

  if (tokenError) {
    throw new Error(
      `Unable to persist legacy IMAP token payload for ${input.provider}: ${tokenError.message}`
    );
  }
}

export async function upsertWorkspaceIntegrationConnection(input: {
  workspaceId: string;
  provider: WorkspaceIntegrationProvider;
  userId: string | null;
  status?: "connected" | "disconnected" | "error";
  email?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  username?: string | null;
  encryptedPassword?: string | null;
  sslTlsEnabled?: boolean | null;
  lastHealthCheckAt?: string | null;
  errorCode?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const isImapProvider = input.provider === "imap" || input.provider === "icloud_imap";
  const payload: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    provider: input.provider,
    status: input.status ?? "connected",
    connected_user_id: input.userId,
  };
  if (typeof input.email !== "undefined") payload.email = input.email;
  if (typeof input.imapHost !== "undefined") payload.imap_host = input.imapHost;
  if (typeof input.imapPort !== "undefined") payload.imap_port = input.imapPort;
  if (typeof input.smtpHost !== "undefined") payload.smtp_host = input.smtpHost;
  if (typeof input.smtpPort !== "undefined") payload.smtp_port = input.smtpPort;
  if (typeof input.username !== "undefined") payload.username = input.username;
  if (typeof input.encryptedPassword !== "undefined") payload.encrypted_password = input.encryptedPassword;
  if (typeof input.sslTlsEnabled !== "undefined") payload.ssl_tls_enabled = input.sslTlsEnabled;
  if (typeof input.lastHealthCheckAt !== "undefined") payload.last_health_check_at = input.lastHealthCheckAt;
  if (typeof input.errorCode !== "undefined") payload.error_code = input.errorCode;

  // Legacy deployments can miss many columns at once. Keep budget generous.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const { error } = await supabase.from("integrations").upsert(payload, {
      onConflict: "workspace_id,provider",
    });

    if (!error) return;

    const match = MISSING_COLUMN_RE.exec(error.message ?? "");
    if (match && match[1] && match[1] in payload) {
      delete payload[match[1]];
      continue;
    }

    if (isImapProvider && /schema cache|column/i.test(error.message ?? "")) {
      await persistLegacyImapToken({
        workspaceId: input.workspaceId,
        provider: input.provider,
        userId: input.userId,
        status: input.status ?? "connected",
        email: input.email ?? null,
        imapHost: input.imapHost ?? null,
        imapPort: input.imapPort ?? null,
        smtpHost: input.smtpHost ?? null,
        smtpPort: input.smtpPort ?? null,
        username: input.username ?? null,
        encryptedPassword: input.encryptedPassword ?? null,
        sslTlsEnabled: input.sslTlsEnabled ?? null,
        lastHealthCheckAt: input.lastHealthCheckAt ?? null,
        errorCode: input.errorCode ?? null,
      });
      return;
    }

    throw new Error(
      `Unable to persist integration status for ${input.provider}: ${error.message}`
    );
  }

  throw new Error(
    `Unable to persist integration status for ${input.provider}: exceeded retry budget while resolving missing columns`
  );
}
