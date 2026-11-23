import {
  ensureGoogleAccessToken,
  GoogleTokenError,
  type StoredGoogleTokens,
  loadStoredGoogleTokens,
} from "@/lib/google/tokenStore";
import { hasRequiredScopes } from "@/lib/google/scopes";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";

const LEGACY_IMAP_TOKEN_PREFIX = "imap_v1:";

type LegacyImapPayload = {
  email?: string | null;
  username?: string | null;
  encryptedPassword?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  sslTlsEnabled?: boolean | null;
};

function decodeLegacyImapPayload(value: string | null | undefined): LegacyImapPayload | null {
  if (!value || !value.startsWith(LEGACY_IMAP_TOKEN_PREFIX)) return null;
  const encoded = value.slice(LEGACY_IMAP_TOKEN_PREFIX.length);
  if (!encoded) return null;
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LegacyImapPayload) : null;
  } catch {
    return null;
  }
}

export type IntegrationProvider = "google" | "imap";

export type GoogleCredentialResolution =
  | {
      ok: true;
      provider: "google";
      workspaceId: string;
      accessToken: string;
      scopes: string[];
      expiresAtMs: number | null;
      missingScopes: [];
    }
  | {
      ok: false;
      provider: "google";
      workspaceId: string;
      code: "needs_auth" | "missing_scopes" | "error";
      message: string;
      status: number;
      missingScopes: string[];
    };

export type ImapCredentialResolution =
  | {
      ok: true;
      provider: "imap";
      workspaceId: string;
      email: string | null;
      username: string;
      password: string;
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
      sslTlsEnabled: boolean;
      missingScopes: [];
    }
  | {
      ok: false;
      provider: "imap";
      workspaceId: string;
      code: "needs_auth" | "error";
      message: string;
      status: number;
      missingScopes: [];
    };

export type CredentialResolution = GoogleCredentialResolution | ImapCredentialResolution;

const credentialInflight = new Map<string, Promise<CredentialResolution>>();

function pickBestImapRow<T extends { provider?: unknown; status?: unknown; updated_at?: unknown }>(
  rows: T[] | null | undefined,
): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const statusRank = (status: unknown): number => {
    if (status === "connected") return 3;
    if (status === "error") return 2;
    return 1;
  };
  const providerRank = (provider: unknown): number => {
    if (provider === "imap") return 2;
    if (provider === "icloud_imap") return 1;
    return 0;
  };
  const updatedAtMs = (value: unknown): number => {
    if (typeof value !== "string") return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...rows].sort((a, b) => {
    const statusDelta = statusRank(b.status) - statusRank(a.status);
    if (statusDelta !== 0) return statusDelta;
    const providerDelta = providerRank(b.provider) - providerRank(a.provider);
    if (providerDelta !== 0) return providerDelta;
    return updatedAtMs(b.updated_at) - updatedAtMs(a.updated_at);
  })[0] ?? null;
}

function toNeedsAuth(workspaceId: string, message: string): CredentialResolution {
  return {
    ok: false,
    provider: "google",
    workspaceId,
    code: "needs_auth",
    message,
    status: 409,
    missingScopes: [],
  };
}

function toMissingScopes(
  workspaceId: string,
  requiredScopes: readonly string[],
  stored: StoredGoogleTokens | null,
): CredentialResolution {
  const granted = stored?.scopes ?? [];
  const missing = requiredScopes.filter((scope) => !hasRequiredScopes(granted, [scope]).ok);
  return {
    ok: false,
    provider: "google",
    workspaceId,
    code: "missing_scopes",
    message: `Missing required scope(s): ${missing.join(", ")}`,
    status: 403,
    missingScopes: missing,
  };
}

function credentialInflightKey(input: {
  provider: IntegrationProvider;
  workspaceId: string;
  userId?: string | null;
  requiredScopes?: readonly string[];
}): string {
  const scopes = [...(input.requiredScopes ?? [])].sort().join(",");
  return [
    input.provider,
    input.workspaceId.trim(),
    input.userId?.trim() ?? "",
    scopes,
  ].join("::");
}

export async function resolveCredentials(input: {
  provider: "google";
  workspaceId: string;
  userId?: string | null;
  requiredScopes?: readonly string[];
}): Promise<GoogleCredentialResolution>;
export async function resolveCredentials(input: {
  provider: "imap";
  workspaceId: string;
  userId?: string | null;
  requiredScopes?: readonly string[];
}): Promise<ImapCredentialResolution>;
export async function resolveCredentials(input: {
  provider: IntegrationProvider;
  workspaceId: string;
  userId?: string | null;
  requiredScopes?: readonly string[];
}): Promise<CredentialResolution> {
  const requiredScopes = input.requiredScopes ?? [];
  const inflightKey = credentialInflightKey(input);
  const existing = credentialInflight.get(inflightKey);
  if (existing) {
    return existing;
  }

  const resolutionPromise = (async (): Promise<CredentialResolution> => {
    if (input.provider === "imap") {
      const supabase = getSupabaseAdminClient();
      const { data, error } = await supabase
        .from("integrations")
        .select("id,provider,status,updated_at,email,username,encrypted_password,imap_host,imap_port,smtp_host,smtp_port,ssl_tls_enabled")
        .eq("workspace_id", input.workspaceId)
        .in("provider", ["imap", "icloud_imap"])
        .order("updated_at", { ascending: false });

      const loadLegacyTokenCredentials = async (): Promise<ImapCredentialResolution> => {
        const { data: integrationRows, error: integrationError } = await supabase
          .from("integrations")
          .select("id,provider,status,updated_at")
          .eq("workspace_id", input.workspaceId)
          .in("provider", ["imap", "icloud_imap"])
          .order("updated_at", { ascending: false });

        if (integrationError) {
          return {
            ok: false,
            provider: "imap",
            workspaceId: input.workspaceId,
            code: "error",
            message: `Unable to load IMAP credentials: ${integrationError.message}`,
            status: 500,
            missingScopes: [],
          };
        }

        const integration = pickBestImapRow(
          Array.isArray(integrationRows)
            ? (integrationRows as Array<{ id?: string; provider?: string; status?: string; updated_at?: string | null }>)
            : [],
        );
        if (!integration?.id || integration.status === "disconnected") {
          return {
            ok: false,
            provider: "imap",
            workspaceId: input.workspaceId,
            code: "needs_auth",
            message: "IMAP is not connected for this workspace.",
            status: 409,
            missingScopes: [],
          };
        }

        const { data: tokenRows, error: tokenError } = await supabase
          .from("integration_tokens")
          .select("refresh_token,updated_at")
          .eq("integration_id", integration.id)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(1);

        if (tokenError) {
          return {
            ok: false,
            provider: "imap",
            workspaceId: input.workspaceId,
            code: "error",
            message: `Unable to load IMAP token payload: ${tokenError.message}`,
            status: 500,
            missingScopes: [],
          };
        }

        const tokenRow = Array.isArray(tokenRows)
          ? (tokenRows[0] as { refresh_token?: string | null } | undefined)
          : undefined;
        const legacy = decodeLegacyImapPayload(tokenRow?.refresh_token);
        if (!legacy?.encryptedPassword || !legacy.username) {
          return {
            ok: false,
            provider: "imap",
            workspaceId: input.workspaceId,
            code: "needs_auth",
            message: "IMAP is not connected for this workspace.",
            status: 409,
            missingScopes: [],
          };
        }

        try {
          return {
            ok: true,
            provider: "imap",
            workspaceId: input.workspaceId,
            email: typeof legacy.email === "string" ? legacy.email : null,
            username: legacy.username,
            password: decryptIntegrationSecret(legacy.encryptedPassword),
            imapHost:
              typeof legacy.imapHost === "string" && legacy.imapHost
                ? legacy.imapHost
                : "imap.mail.me.com",
            imapPort:
              typeof legacy.imapPort === "number" && Number.isFinite(legacy.imapPort)
                ? legacy.imapPort
                : 993,
            smtpHost:
              typeof legacy.smtpHost === "string" && legacy.smtpHost
                ? legacy.smtpHost
                : "smtp.mail.me.com",
            smtpPort:
              typeof legacy.smtpPort === "number" && Number.isFinite(legacy.smtpPort)
                ? legacy.smtpPort
                : 587,
            sslTlsEnabled:
              typeof legacy.sslTlsEnabled === "boolean" ? legacy.sslTlsEnabled : true,
            missingScopes: [],
          };
        } catch (decryptError) {
          return {
            ok: false,
            provider: "imap",
            workspaceId: input.workspaceId,
            code: "error",
            message:
              decryptError instanceof Error
                ? decryptError.message
                : "Unable to decrypt IMAP credentials.",
            status: 500,
            missingScopes: [],
          };
        }
      };

      if (error) {
        if (/Could not find the '([^']+)' column of 'integrations'/i.test(error.message ?? "")) {
          return loadLegacyTokenCredentials();
        }
        return {
          ok: false,
          provider: "imap",
          workspaceId: input.workspaceId,
          code: "error",
          message: `Unable to load IMAP credentials: ${error.message}`,
          status: 500,
          missingScopes: [],
        };
      }

      const row = pickBestImapRow(
        Array.isArray(data)
          ? (data as Array<Record<string, unknown>>)
          : [],
      );
      const encryptedPassword = typeof row?.encrypted_password === "string" ? row.encrypted_password : null;
      const username = typeof row?.username === "string" ? row.username : null;
      const status = typeof row?.status === "string" ? row.status : "disconnected";

      if ((!encryptedPassword || !username) && row) {
        const fallback = await loadLegacyTokenCredentials();
        if (fallback.ok) return fallback;
      }

      if (!row || !encryptedPassword || !username || status === "disconnected") {
        return {
          ok: false,
          provider: "imap",
          workspaceId: input.workspaceId,
          code: "needs_auth",
          message: "IMAP is not connected for this workspace.",
          status: 409,
          missingScopes: [],
        };
      }

      try {
        return {
          ok: true,
          provider: "imap",
          workspaceId: input.workspaceId,
          email: typeof row.email === "string" ? row.email : null,
          username,
          password: decryptIntegrationSecret(encryptedPassword),
          imapHost: typeof row.imap_host === "string" && row.imap_host ? row.imap_host : "imap.mail.me.com",
          imapPort: typeof row.imap_port === "number" && Number.isFinite(row.imap_port) ? row.imap_port : 993,
          smtpHost: typeof row.smtp_host === "string" && row.smtp_host ? row.smtp_host : "smtp.mail.me.com",
          smtpPort: typeof row.smtp_port === "number" && Number.isFinite(row.smtp_port) ? row.smtp_port : 587,
          sslTlsEnabled: typeof row.ssl_tls_enabled === "boolean" ? row.ssl_tls_enabled : true,
          missingScopes: [],
        };
      } catch (decryptError) {
        return {
          ok: false,
          provider: "imap",
          workspaceId: input.workspaceId,
          code: "needs_auth",
          message:
            decryptError instanceof Error
              ? `IMAP credentials could not be decrypted (${decryptError.message}). Reconnect iCloud credentials for this workspace.`
              : "IMAP credentials could not be decrypted. Reconnect iCloud credentials for this workspace.",
          status: 409,
          missingScopes: [],
        };
      }
    }

    if (input.provider !== "google") {
      return {
        ok: false,
        provider: "google",
        workspaceId: input.workspaceId,
        code: "error",
        message: `Unsupported provider: ${input.provider}`,
        status: 500,
        missingScopes: [],
      };
    }

    const stored = await loadStoredGoogleTokens(input.workspaceId, input.userId);
    if (!stored || (!stored.accessToken && !stored.refreshToken)) {
      return toNeedsAuth(input.workspaceId, "Google is not connected for this workspace.");
    }

    if (requiredScopes.length > 0) {
      const scopeCheck = hasRequiredScopes(stored.scopes, requiredScopes);
      if (!scopeCheck.ok) {
        return toMissingScopes(input.workspaceId, requiredScopes, stored);
      }
    }

    try {
      const token = await ensureGoogleAccessToken({
        workspaceId: input.workspaceId,
        ...(typeof input.userId !== "undefined" ? { userId: input.userId } : {}),
        requiredScopes,
      });

      return {
        ok: true,
        provider: "google",
        workspaceId: input.workspaceId,
        accessToken: token.accessToken,
        scopes: token.scopes,
        expiresAtMs: token.expiresAtMs,
        missingScopes: [],
      };
    } catch (error) {
      if (error instanceof GoogleTokenError) {
        if (error.code === "not_connected") {
          return toNeedsAuth(input.workspaceId, error.message);
        }
        if (error.code === "missing_scope") {
          return toMissingScopes(input.workspaceId, requiredScopes, stored);
        }
        return {
          ok: false,
          provider: "google",
          workspaceId: input.workspaceId,
          code: "error",
          message: error.message,
          status: error.status,
          missingScopes: [],
        };
      }

      return {
        ok: false,
        provider: "google",
        workspaceId: input.workspaceId,
        code: "error",
        message: error instanceof Error ? error.message : "Unable to resolve integration credentials.",
        status: 500,
        missingScopes: [],
      };
    }
  })();

  credentialInflight.set(inflightKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    credentialInflight.delete(inflightKey);
  }
}

export async function resolveImapCredentials(workspaceId: string, userId?: string | null) {
  const payload: {
    provider: "imap";
    workspaceId: string;
    userId?: string | null;
  } = {
    provider: "imap",
    workspaceId,
  };
  if (typeof userId !== "undefined") {
    payload.userId = userId;
  }
  return resolveCredentials({
    ...payload,
  });
}
