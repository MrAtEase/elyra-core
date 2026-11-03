import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getTokens, saveTokens } from "../db/repos/token-vault.js";
import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";

type GoogleRefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

const INTEGRATION_TOKEN_PREFIX = "enc:v1";
const INTEGRATION_TOKEN_ALGORITHM = "aes-256-gcm";
const INTEGRATION_TOKEN_IV_LENGTH = 12;
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY;

if (!TOKEN_KEY) {
  logger.error("TOKEN_ENCRYPTION_KEY is not set — Google tools will NOT work");
} else {
  logger.info("TOKEN_ENCRYPTION_KEY present (%d chars)", TOKEN_KEY.length);
}

type IntegrationTokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | string[] | null;
};

function normalizeScopeArray(value: string | string[] | null | undefined): string[] | null {
  if (Array.isArray(value)) {
    const next = value
      .map((entry) => entry.trim())
      .filter(Boolean);
    return next.length > 0 ? Array.from(new Set(next)) : null;
  }
  if (typeof value === "string") {
    const next = value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return next.length > 0 ? Array.from(new Set(next)) : null;
  }
  return null;
}

function tokenEncryptionKey(): Buffer | null {
  const hex = config().TOKEN_ENCRYPTION_KEY.trim();
  if (!/^[\da-fA-F]{64}$/.test(hex)) {
    return null;
  }
  const key = Buffer.from(hex, "hex");
  return key.byteLength === 32 ? key : null;
}

function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string, keyVersion = "v1"): Buffer {
  const digest = createHmac("sha256", masterKey)
    .update(`workspace:${workspaceId}:version:${keyVersion}`)
    .digest();
  return Buffer.from(digest.subarray(0, 32));
}

function decodeTokenField(value: string | null, workspaceId: string): string | null {
  if (!value) return null;
  if (!value.startsWith(`${INTEGRATION_TOKEN_PREFIX}:`)) {
    return value;
  }

  const masterKey = tokenEncryptionKey();
  if (!masterKey) {
    logger.warn("TOKEN_ENCRYPTION_KEY invalid; cannot decrypt integration_tokens");
    return null;
  }
  const key = deriveWorkspaceKey(masterKey, workspaceId);

  try {
    const parts = value.split(":");
    if (parts.length !== 5) return null;
    const iv = Buffer.from(parts[2] ?? "", "base64url");
    const authTag = Buffer.from(parts[3] ?? "", "base64url");
    const encrypted = Buffer.from(parts[4] ?? "", "base64url");
    const decipher = createDecipheriv(INTEGRATION_TOKEN_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (err) {
    logger.warn({ err }, "Failed to decrypt integration token field");
    return null;
  }
}

function encodeTokenField(value: string, workspaceId: string): string {
  const masterKey = tokenEncryptionKey();
  if (!masterKey) {
    logger.warn("TOKEN_ENCRYPTION_KEY invalid; storing integration token as plaintext");
    return value;
  }
  const key = deriveWorkspaceKey(masterKey, workspaceId);

  const iv = randomBytes(INTEGRATION_TOKEN_IV_LENGTH);
  const cipher = createCipheriv(INTEGRATION_TOKEN_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${INTEGRATION_TOKEN_PREFIX}:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

async function getTokenFromIntegrations(workspaceId: string): Promise<string | null> {
  try {
    const { data: integration, error: integrationError } = await db()
      .from("integrations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google")
      .eq("status", "connected")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (integrationError) {
      logger.warn({ err: integrationError, workspaceId }, "Failed loading integration row");
      return null;
    }
    if (!integration?.id) return null;

    const { data: tokenRow, error: tokenError } = await db()
      .from("integration_tokens")
      .select("id,access_token,refresh_token,expires_at,scope")
      .eq("integration_id", integration.id)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<IntegrationTokenRow>();

    if (tokenError) {
      logger.warn({ err: tokenError, workspaceId }, "Failed loading integration token row");
      return null;
    }
    if (!tokenRow?.id) return null;

    const accessToken = decodeTokenField(tokenRow.access_token, workspaceId);
    const refreshToken = decodeTokenField(tokenRow.refresh_token, workspaceId);
    const refreshThreshold = Date.now() + 2 * 60_000;
    const tokenExpiry = Date.parse(tokenRow.expires_at ?? "");

    if (accessToken && Number.isFinite(tokenExpiry) && tokenExpiry > refreshThreshold) {
      return accessToken;
    }

    if (!refreshToken) {
      return accessToken;
    }

    const refreshed = await refreshGoogleToken(refreshToken);
    if (!refreshed) {
      return null;
    }

    const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
    const { error: updateError } = await db()
      .from("integration_tokens")
      .update({
        access_token: encodeTokenField(refreshed.access_token, workspaceId),
        refresh_token: encodeTokenField(nextRefreshToken, workspaceId),
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        scope: normalizeScopeArray(refreshed.scope ?? tokenRow.scope ?? null),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id);

    if (updateError) {
      logger.warn({ err: updateError, workspaceId }, "Failed updating integration token row");
    }

    return refreshed.access_token;
  } catch (err) {
    logger.warn({ err, workspaceId }, "Failed to get token from integrations table");
    return null;
  }
}

export async function getGoogleAccessToken(workspaceId: string): Promise<string | null> {
  const stored = await getTokens(workspaceId);
  if (stored) {
    const refreshThreshold = Date.now() + 2 * 60_000;
    const tokenExpiry = Date.parse(stored.expiresAt);

    if (Number.isFinite(tokenExpiry) && tokenExpiry > refreshThreshold) {
      return stored.accessToken;
    }

    const refreshed = await refreshGoogleToken(stored.refreshToken);
    if (refreshed) {
      await saveTokens({
        workspaceId,
        provider: "google",
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? stored.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        scopes: refreshed.scope ?? stored.scopes,
        accountEmail: stored.accountEmail ?? null,
      });

      return refreshed.access_token;
    }
  }

  return getTokenFromIntegrations(workspaceId);
}

async function refreshGoogleToken(
  refreshToken: string,
): Promise<GoogleRefreshResponse | null> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = config();
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as GoogleRefreshResponse;
  } catch (err) {
    logger.error({ err }, "Failed to refresh Google token");
    return null;
  }
}

type OAuthState = {
  workspaceId: string;
};

export function encodeOAuthState(workspaceId: string): string {
  const payload: OAuthState = { workspaceId };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeOAuthState(state: string): OAuthState | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as { workspaceId?: unknown };
    if (typeof payload.workspaceId !== "string" || !payload.workspaceId.trim()) {
      return null;
    }
    return { workspaceId: payload.workspaceId.trim() };
  } catch {
    return null;
  }
}

export function buildGoogleOAuthUrl(workspaceId: string): string {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = config();
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/userinfo.email",
  ];
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: encodeOAuthState(workspaceId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
