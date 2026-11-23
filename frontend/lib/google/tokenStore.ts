import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getGoogleServerEnv } from "@/lib/google/env";
import { decryptGoogleSecret, encryptGoogleSecret } from "@/lib/google/crypto";
import { hasRequiredScopes, parseScopeString, serializeScopes } from "@/lib/google/scopes";
import { deriveWorkspaceKey } from "@/lib/orb-os/integrations/keys";
import { mapGoogleTokenFailure } from "@/lib/orb-os/integrations/failures";

const TOKEN_REFRESH_BUFFER_MS = 45_000;
const GOOGLE_TOKEN_REFRESH_TIMEOUT_MS = 10_000;
const STORED_TOKEN_CACHE_TTL_MS = 15_000;

type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: "google";
  status: "disconnected" | "connected" | "error";
  connected_user_id: string | null;
};

type IntegrationTokenRow = {
  id: string;
  integration_id: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
  updated_at: string | null;
};

export type StoredGoogleTokens = {
  integrationId: string;
  tokenRowId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string[];
  expiresAtMs: number | null;
};

export class GoogleTokenError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "GoogleTokenError";
  }
}

type StoredTokenCacheEntry = {
  expiresAt: number;
  value: StoredGoogleTokens | null;
};

const storedTokenCache = new Map<string, StoredTokenCacheEntry>();
const storedTokenInflight = new Map<string, Promise<StoredGoogleTokens | null>>();

const TokenRefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
});

function toEpochMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStoredTokenCacheKey(workspaceId: string): string {
  return workspaceId.trim();
}

function cloneStoredGoogleTokens(value: StoredGoogleTokens | null): StoredGoogleTokens | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    scopes: [...value.scopes],
  };
}

function writeStoredTokenCache(workspaceId: string, value: StoredGoogleTokens | null): void {
  storedTokenCache.set(getStoredTokenCacheKey(workspaceId), {
    expiresAt: Date.now() + STORED_TOKEN_CACHE_TTL_MS,
    value: cloneStoredGoogleTokens(value),
  });
}

function clearStoredTokenCache(workspaceId: string): void {
  const cacheKey = getStoredTokenCacheKey(workspaceId);
  storedTokenCache.delete(cacheKey);
  storedTokenInflight.delete(cacheKey);
}

function isFresh(expiresAtMs: number | null): boolean {
  if (!expiresAtMs) return false;
  return expiresAtMs > Date.now() + TOKEN_REFRESH_BUFFER_MS;
}

function assertScopesAvailable(
  scopes: readonly string[],
  requiredScopes: readonly string[]
): void {
  const scopeCheck = hasRequiredScopes(scopes, requiredScopes);
  if (!scopeCheck.ok) {
    throw new GoogleTokenError(
      `Missing required Google scope(s): ${scopeCheck.missing.join(", ")}`,
      "missing_scope",
      403
    );
  }
}

async function findIntegration(
  workspaceId: string,
  _userId?: string | null
): Promise<IntegrationRow | null> {
  const supabase = getSupabaseAdminClient();
  const query = supabase
    .from("integrations")
    .select("id,workspace_id,provider,status,connected_user_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google");
  // Integration binding is workspace-scoped. The connected_user_id is audit metadata,
  // not a lookup key, otherwise members of the same workspace can see false "disconnected".
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Unable to load Google integration: ${error.message}`);
  }

  return (data as IntegrationRow | null) ?? null;
}

function deriveWorkspaceSeed(workspaceId: string): {
  id: string;
  slug: string;
  name: string;
  kind: "individual" | "organization" | "platform";
} {
  const trimmed = workspaceId.trim();
  const canonical = trimmed.replace(/^ws-/, "");
  const slug = canonical
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const name = canonical
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Workspace";
  const normalized = canonical.toLowerCase();
  const kind: "individual" | "organization" | "platform" =
    /(personal|private|privat|individual)/.test(normalized)
      ? "individual"
      : /(platform|system)/.test(normalized)
        ? "platform"
        : "organization";
  return { id: trimmed, slug, name, kind };
}

async function ensureWorkspaceExists(workspaceId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const seed = deriveWorkspaceSeed(workspaceId);
  const { error } = await supabase
    .from("workspaces")
    .upsert(
      {
        id: seed.id,
        slug: seed.slug,
        name: seed.name,
        kind: seed.kind,
      },
      { onConflict: "id" }
    );
  if (error) {
    throw new Error(`Unable to ensure workspace record for integrations: ${error.message}`);
  }
}

async function ensureIntegration(
  workspaceId: string,
  userId?: string | null
): Promise<IntegrationRow> {
  const supabase = getSupabaseAdminClient();
  const executeUpsert = () =>
    supabase
      .from("integrations")
      .upsert(
        {
          workspace_id: workspaceId,
          provider: "google",
          status: "connected",
          connected_user_id: userId ?? null,
        },
        { onConflict: "workspace_id,provider" }
      )
      .select("id,workspace_id,provider,status,connected_user_id")
      .single();

  let { data, error } = await executeUpsert();
  if (
    error &&
    /integrations_workspace_id_fkey/i.test(error.message)
  ) {
    await ensureWorkspaceExists(workspaceId);
    ({ data, error } = await executeUpsert());
  }

  if (error || !data) {
    throw new Error(
      error?.message ?? "Unable to persist Google integration record."
    );
  }

  return data as IntegrationRow;
}

async function findLatestTokenRow(
  integrationId: string
): Promise<IntegrationTokenRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("integration_tokens")
    .select("id,integration_id,access_token,refresh_token,scope,expires_at,updated_at")
    .eq("integration_id", integrationId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    throw new Error(`Unable to load integration token row: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  return (row as IntegrationTokenRow | null) ?? null;
}

async function setIntegrationStatus(input: {
  workspaceId: string;
  status: "connected" | "disconnected" | "error";
  connectedUserId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("integrations")
    .update({
      status: input.status,
      ...(typeof input.connectedUserId !== "undefined"
        ? { connected_user_id: input.connectedUserId }
        : {}),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "google");
  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[google] unable to update integration status", error.message);
  }
}

async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<z.infer<typeof TokenRefreshSchema>> {
  const env = getGoogleServerEnv();
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_TOKEN_REFRESH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort =
      error instanceof DOMException
        ? error.name === "AbortError"
        : typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name?: unknown }).name === "AbortError";
    if (isAbort) {
      throw new GoogleTokenError(
        `Google token refresh timed out after ${GOOGLE_TOKEN_REFRESH_TIMEOUT_MS}ms`,
        "google_refresh_timeout",
        504
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const mapped = mapGoogleTokenFailure({
      error: typeof payload?.error === "string" ? payload.error : null,
      description:
        typeof payload?.error_description === "string"
          ? payload.error_description
          : null,
    });
    if (mapped.needs_auth) {
      throw new GoogleTokenError(
        "Google session expired. Reconnect Google to continue.",
        "not_connected",
        409
      );
    }
    throw new GoogleTokenError(mapped.safe_message, mapped.code, 502);
  }

  const parsed = TokenRefreshSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GoogleTokenError(
      "Google token refresh returned invalid payload.",
      "google_refresh_invalid_payload",
      502
    );
  }

  return parsed.data;
}

export async function loadStoredGoogleTokens(
  workspaceId: string,
  userId?: string | null
): Promise<StoredGoogleTokens | null> {
  const cacheKey = getStoredTokenCacheKey(workspaceId);
  const cached = storedTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneStoredGoogleTokens(cached.value);
  }

  const inflight = storedTokenInflight.get(cacheKey);
  if (inflight) {
    return cloneStoredGoogleTokens(await inflight);
  }

  const loadPromise = (async (): Promise<StoredGoogleTokens | null> => {
  const env = getGoogleServerEnv();
  const workspaceKey = deriveWorkspaceKey(
    env.TOKEN_ENCRYPTION_KEY_BYTES,
    workspaceId
  );
  const integration = await findIntegration(workspaceId, userId);
  if (!integration) {
    writeStoredTokenCache(workspaceId, null);
    return null;
  }

  const tokenRow = await findLatestTokenRow(integration.id);

  const result = {
    integrationId: integration.id,
    tokenRowId: tokenRow?.id ?? null,
    accessToken: decryptGoogleSecret(
      tokenRow?.access_token ?? null,
      workspaceKey
    ),
    refreshToken: decryptGoogleSecret(
      tokenRow?.refresh_token ?? null,
      workspaceKey
    ),
    scopes: parseScopeString(tokenRow?.scope),
    expiresAtMs: toEpochMs(tokenRow?.expires_at ?? null),
  };
  writeStoredTokenCache(workspaceId, result);
  return result;
  })();

  storedTokenInflight.set(cacheKey, loadPromise);
  try {
    return cloneStoredGoogleTokens(await loadPromise);
  } finally {
    storedTokenInflight.delete(cacheKey);
  }
}

export async function saveGoogleTokens(input: {
  workspaceId: string;
  userId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  scopes: readonly string[];
  expiresAtMs: number;
}): Promise<StoredGoogleTokens> {
  const env = getGoogleServerEnv();
  const workspaceKey = deriveWorkspaceKey(
    env.TOKEN_ENCRYPTION_KEY_BYTES,
    input.workspaceId
  );
  const integration = await ensureIntegration(input.workspaceId, input.userId);
  const existingTokenRow = await findLatestTokenRow(integration.id);
  const decryptedExistingRefresh = decryptGoogleSecret(
    existingTokenRow?.refresh_token ?? null,
    workspaceKey
  );

  const resolvedRefreshToken =
    input.refreshToken?.trim() || decryptedExistingRefresh || null;
  const encryptedAccessToken = encryptGoogleSecret(
    input.accessToken,
    workspaceKey
  );
  const encryptedRefreshToken = resolvedRefreshToken
    ? encryptGoogleSecret(resolvedRefreshToken, workspaceKey)
    : null;

  const payload = {
    integration_id: integration.id,
    access_token: encryptedAccessToken,
    refresh_token: encryptedRefreshToken,
    scope: serializeScopes(input.scopes),
    expires_at: new Date(input.expiresAtMs).toISOString(),
  };

  const supabase = getSupabaseAdminClient();
  if (existingTokenRow?.id) {
    const { error } = await supabase
      .from("integration_tokens")
      .update(payload)
      .eq("id", existingTokenRow.id);
    if (error) {
      throw new Error(`Unable to update Google token row: ${error.message}`);
    }
  } else {
    const { error } = await supabase.from("integration_tokens").insert(payload);
    if (error) {
      throw new Error(`Unable to insert Google token row: ${error.message}`);
    }
  }

  await setIntegrationStatus({
    workspaceId: input.workspaceId,
    status: "connected",
    connectedUserId: input.userId ?? null,
  });

  const result = {
    integrationId: integration.id,
    tokenRowId: existingTokenRow?.id ?? null,
    accessToken: input.accessToken,
    refreshToken: resolvedRefreshToken,
    scopes: Array.from(new Set(input.scopes)),
    expiresAtMs: input.expiresAtMs,
  };
  writeStoredTokenCache(input.workspaceId, result);
  return result;
}

export async function ensureGoogleAccessToken(input: {
  workspaceId: string;
  userId?: string | null;
  requiredScopes: readonly string[];
}): Promise<{
  accessToken: string;
  scopes: string[];
  expiresAtMs: number | null;
}> {
  const stored = await loadStoredGoogleTokens(input.workspaceId, input.userId);
  if (!stored) {
    await setIntegrationStatus({ workspaceId: input.workspaceId, status: "disconnected", connectedUserId: null });
    throw new GoogleTokenError(
      "Google is not connected for this workspace.",
      "not_connected",
      409
    );
  }

  if (stored.accessToken && isFresh(stored.expiresAtMs)) {
    assertScopesAvailable(stored.scopes, input.requiredScopes);
    return {
      accessToken: stored.accessToken,
      scopes: stored.scopes,
      expiresAtMs: stored.expiresAtMs,
    };
  }

  if (!stored.refreshToken) {
    await setIntegrationStatus({ workspaceId: input.workspaceId, status: "disconnected", connectedUserId: null });
    throw new GoogleTokenError(
      "Google token expired. Reconnect Google.",
      "not_connected",
      409
    );
  }

  let refreshed: z.infer<typeof TokenRefreshSchema>;
  try {
    refreshed = await refreshGoogleAccessToken(stored.refreshToken);
  } catch (error) {
    if (error instanceof GoogleTokenError && error.code === "not_connected") {
      await setIntegrationStatus({ workspaceId: input.workspaceId, status: "disconnected", connectedUserId: null });
    } else {
      await setIntegrationStatus({ workspaceId: input.workspaceId, status: "error" });
    }
    throw error;
  }
  const scopes = refreshed.scope
    ? parseScopeString(refreshed.scope)
    : stored.scopes;
  const expiresAtMs = Date.now() + refreshed.expires_in * 1000;
  const saved = await saveGoogleTokens({
    workspaceId: input.workspaceId,
    ...(typeof input.userId !== "undefined" ? { userId: input.userId } : {}),
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
    scopes,
    expiresAtMs,
  });

  assertScopesAvailable(saved.scopes, input.requiredScopes);
  return {
    accessToken: saved.accessToken ?? refreshed.access_token,
    scopes: saved.scopes,
    expiresAtMs: saved.expiresAtMs,
  };
}

export async function disconnectGoogleTokens(input: {
  workspaceId: string;
  userId?: string | null;
}): Promise<void> {
  clearStoredTokenCache(input.workspaceId);
  const integration = await findIntegration(input.workspaceId, input.userId);
  if (!integration) return;

  const supabase = getSupabaseAdminClient();
  const { error: tokenError } = await supabase
    .from("integration_tokens")
    .delete()
    .eq("integration_id", integration.id);
  if (tokenError) {
    throw new Error(`Unable to remove Google token rows: ${tokenError.message}`);
  }

  const { error: integrationError } = await supabase
    .from("integrations")
    .update({ status: "disconnected", connected_user_id: null })
    .eq("id", integration.id);
  if (integrationError) {
    throw new Error(
      `Unable to update Google integration status: ${integrationError.message}`
    );
  }
  clearStoredTokenCache(input.workspaceId);
}
