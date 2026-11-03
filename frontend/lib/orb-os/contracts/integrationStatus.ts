import type { IntegrationStatus } from "@/lib/orb-os/contracts/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadStoredGoogleTokens } from "@/lib/google/tokenStore";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";
import { expandScopesForMatching } from "@/lib/google/scopes";

function reauthUrl(workspaceId: string): string {
  return `/api/google/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent("/os")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function fetchGoogleLastRefreshAt(workspaceId: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  const integration = await supabase
    .from("integrations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .maybeSingle();
  const integrationId = integration.data?.id as string | undefined;
  if (!integrationId) return null;

  const token = await supabase
    .from("integration_tokens")
    .select("updated_at")
    .eq("integration_id", integrationId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const row = Array.isArray(token.data) ? token.data[0] : null;
  const updated = row?.updated_at;
  return typeof updated === "string" ? updated : null;
}

type IntegrationProviderRow = {
  id: string;
  provider: "google" | "github" | "microsoft" | "imap" | "icloud_imap" | "icloud_caldav" | "figma" | "banana2" | "google_stitch" | "twentyfirst";
  status: "connected" | "disconnected" | "error";
  updated_at: string | null;
  connected_user_id: string | null;
};

async function fetchWorkspaceIntegrations(workspaceId: string): Promise<IntegrationProviderRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("integrations")
    .select("id,provider,status,updated_at,connected_user_id")
    .eq("workspace_id", workspaceId)
    .in("provider", ["google", "github", "microsoft", "imap", "icloud_imap", "icloud_caldav", "figma", "banana2", "google_stitch", "twentyfirst"]);

  if (error) {
    throw new Error(`Unable to load workspace integrations: ${error.message}`);
  }

  return Array.isArray(data) ? (data as IntegrationProviderRow[]) : [];
}

function pickBestMailIntegrationRow(rows: IntegrationProviderRow[]): IntegrationProviderRow | null {
  const candidates = rows.filter(
    (row) => row.provider === "imap" || row.provider === "icloud_imap"
  );
  if (candidates.length === 0) return null;
  const statusRank = (status: IntegrationProviderRow["status"]): number => {
    if (status === "connected") return 3;
    if (status === "error") return 2;
    return 1;
  };
  const providerRank = (provider: IntegrationProviderRow["provider"]): number => {
    if (provider === "imap") return 2;
    if (provider === "icloud_imap") return 1;
    return 0;
  };
  const updatedAtMs = (value: string | null): number => {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...candidates].sort((a, b) => {
    const statusDelta = statusRank(b.status) - statusRank(a.status);
    if (statusDelta !== 0) return statusDelta;
    const providerDelta = providerRank(b.provider) - providerRank(a.provider);
    if (providerDelta !== 0) return providerDelta;
    return updatedAtMs(b.updated_at) - updatedAtMs(a.updated_at);
  })[0] ?? null;
}

function buildGoogleStatus(input: {
  workspaceId: string;
  connected: boolean;
  scopes: string[];
  expiresAtMs: number | null;
  lastRefreshAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}): IntegrationStatus {
  const hasToken = input.connected;
  const expiresSoon =
    typeof input.expiresAtMs === "number" &&
    Number.isFinite(input.expiresAtMs) &&
    input.expiresAtMs <= Date.now() + 30_000;
  const state = !hasToken ? "needs_auth" : expiresSoon ? "degraded" : "connected";

  return {
    workspace_id: input.workspaceId,
    integration_id: "google_oauth",
    state,
    connected: hasToken,
    scopes: expandScopesForMatching(input.scopes),
    last_refresh_at: input.lastRefreshAt ?? nowIso(),
    health_score: state === "connected" ? 0.95 : state === "degraded" ? 0.55 : 0.2,
    error_code: state === "connected" ? null : input.errorCode ?? "token_missing",
    error_message_safe: state === "connected" ? null : input.errorMessage ?? "Google account needs reconnect",
    reauth_url: reauthUrl(input.workspaceId),
    provider_metadata: {
      provider: "google",
      expires_at_ms: input.expiresAtMs,
    },
  };
}

function buildIcloudStatus(input: {
  workspaceId: string;
  integrationId: "imap" | "icloud_caldav";
  row: IntegrationProviderRow | null;
  reauthPath: string;
}): IntegrationStatus {
  if (!input.row) {
    return {
      workspace_id: input.workspaceId,
      integration_id: input.integrationId,
      state: "disconnected",
      connected: false,
      scopes: [],
      last_refresh_at: nowIso(),
      health_score: 0.2,
      error_code: "not_connected",
      error_message_safe: "Credentials are not configured for this workspace.",
      reauth_url: input.reauthPath,
      provider_metadata: { provider: input.integrationId },
    };
  }

  const state =
    input.row.status === "connected"
      ? "connected"
      : input.row.status === "error"
        ? "degraded"
        : "needs_auth";

  return {
    workspace_id: input.workspaceId,
    integration_id: input.integrationId,
    state,
    connected: input.row.status === "connected",
    scopes: [],
    last_refresh_at: input.row.updated_at ?? nowIso(),
    health_score: state === "connected" ? 0.9 : state === "degraded" ? 0.5 : 0.25,
    error_code: state === "connected" ? null : "credentials_missing",
    error_message_safe:
      state === "connected" ? null : "Reconnect iCloud credentials for this workspace.",
    reauth_url: input.reauthPath,
    provider_metadata: {
      provider: input.integrationId,
      connected_user_id: input.row.connected_user_id,
    },
  };
}

function buildGitHubStatus(input: {
  workspaceId: string;
  row: IntegrationProviderRow | null;
  accessTokenPresent: boolean;
  scopes: string[];
  updatedAt: string | null;
}): IntegrationStatus {
  const hasConnection = input.accessTokenPresent || input.row?.status === "connected";
  const state =
    !hasConnection
      ? "disconnected"
      : input.row?.status === "error"
        ? "degraded"
        : "connected";

  return {
    workspace_id: input.workspaceId,
    integration_id: "github",
    state,
    connected: state === "connected",
    scopes: input.scopes,
    last_refresh_at: input.updatedAt ?? input.row?.updated_at ?? nowIso(),
    health_score: state === "connected" ? 0.92 : state === "degraded" ? 0.45 : 0.2,
    error_code: state === "connected" ? null : "not_connected",
    error_message_safe:
      state === "connected" ? null : "Connect a GitHub token for this workspace.",
    reauth_url: `/os/github/connect?workspaceId=${encodeURIComponent(input.workspaceId)}`,
    provider_metadata: { provider: "github" },
  };
}

function buildOptionalConnectorStatus(input: {
  workspaceId: string;
  integrationId: "figma" | "banana2" | "google_stitch" | "twentyfirst";
  configured: boolean;
  row: IntegrationProviderRow | null;
  reauthUrl: string;
  scopeHint: string[];
}): IntegrationStatus {
  const connectedByRow = input.row?.status === "connected";
  const connected = connectedByRow || input.configured;
  const state = connected ? "connected" : "disconnected";
  return {
    workspace_id: input.workspaceId,
    integration_id: input.integrationId,
    state,
    connected,
    scopes: connected ? input.scopeHint : [],
    last_refresh_at: input.row?.updated_at ?? nowIso(),
    health_score: connected ? 0.9 : 0.25,
    error_code: connected ? null : "not_configured",
    error_message_safe: connected ? null : `${input.integrationId} connector is not configured yet.`,
    reauth_url: input.reauthUrl,
    provider_metadata: {
      provider: input.integrationId,
      configured: input.configured,
      connected_user_id: input.row?.connected_user_id ?? null,
    },
  };
}

export async function buildRuntimeIntegrationStatus(
  workspaceId: string,
  userId?: string | null,
): Promise<IntegrationStatus[]> {
  const [storedResult, githubStoredResult, refreshResult, integrationResult] = await Promise.allSettled([
    loadStoredGoogleTokens(workspaceId, userId),
    loadStoredGitHubToken(workspaceId),
    fetchGoogleLastRefreshAt(workspaceId),
    fetchWorkspaceIntegrations(workspaceId),
  ]);

  const integrationRows =
    integrationResult.status === "fulfilled" ? integrationResult.value : [];
  const icloudMailRow = pickBestMailIntegrationRow(integrationRows);
  const icloudCalendarRow =
    integrationRows.find((row) => row.provider === "icloud_caldav") ?? null;
  const githubRow =
    integrationRows.find((row) => row.provider === "github") ?? null;
  const figmaRow =
    integrationRows.find((row) => row.provider === "figma") ?? null;
  const banana2Row =
    integrationRows.find((row) => row.provider === "banana2") ?? null;
  const stitchRow =
    integrationRows.find((row) => row.provider === "google_stitch") ?? null;
  const twentyfirstRow =
    integrationRows.find((row) => row.provider === "twentyfirst") ?? null;

  const stored =
    storedResult.status === "fulfilled" ? storedResult.value : null;
  const githubStored =
    githubStoredResult.status === "fulfilled" ? githubStoredResult.value : null;
  const googleError =
    storedResult.status === "rejected"
      ? storedResult.reason
      : refreshResult.status === "rejected"
        ? refreshResult.reason
        : null;
  const lastRefreshAt =
    refreshResult.status === "fulfilled" ? refreshResult.value : null;
  const googleErrorMessage =
    googleError instanceof Error
      ? googleError.message
      : googleError
        ? String(googleError)
        : null;

  const google = buildGoogleStatus({
    workspaceId,
    connected: Boolean(stored?.accessToken || stored?.refreshToken),
    scopes: stored?.scopes ?? [],
    expiresAtMs: stored?.expiresAtMs ?? null,
    lastRefreshAt: lastRefreshAt ?? nowIso(),
    errorCode: googleErrorMessage ? "integration_status_unavailable" : null,
    errorMessage: googleErrorMessage,
  });
  const figmaConfigured = Boolean(process.env.FIGMA_ACCESS_TOKEN?.trim() || process.env.NEXT_PUBLIC_FIGMA_CONNECT_URL?.trim());
  const banana2Configured = Boolean(
    process.env.BANANA2_API_KEY?.trim() ||
    process.env.BANANA_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_BANANA2_CONNECT_URL?.trim()
  );
  const stitchConfigured = Boolean(
    process.env.STITCH_API_KEY?.trim() ||
    process.env.GOOGLE_STITCH_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_STITCH_CONNECT_URL?.trim()
  );
  const twentyfirstConfigured = Boolean(
    process.env.TWENTYFIRST_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TWENTYFIRST_CONNECT_URL?.trim()
  );

  return [
    google,
    buildIcloudStatus({
      workspaceId,
      integrationId: "imap",
      row: icloudMailRow,
      reauthPath: `/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`,
    }),
    // Legacy alias while clients migrate from icloud_imap -> imap.
    {
      ...buildIcloudStatus({
        workspaceId,
        integrationId: "imap",
        row: icloudMailRow,
        reauthPath: `/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`,
      }),
      integration_id: "icloud_imap",
    },
    buildIcloudStatus({
      workspaceId,
      integrationId: "icloud_caldav",
      row: icloudCalendarRow,
      reauthPath: `/os/calendar/connect?workspaceId=${encodeURIComponent(workspaceId)}`,
    }),
    buildGitHubStatus({
      workspaceId,
      row: githubRow,
      accessTokenPresent: Boolean(githubStored?.accessToken),
      scopes: githubStored?.scopes ?? [],
      updatedAt: githubStored?.updatedAt ?? null,
    }),
    buildOptionalConnectorStatus({
      workspaceId,
      integrationId: "figma",
      configured: figmaConfigured,
      row: figmaRow,
      reauthUrl: `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/figma/connect`,
      scopeHint: ["design.read", "figma.context"],
    }),
    buildOptionalConnectorStatus({
      workspaceId,
      integrationId: "banana2",
      configured: banana2Configured,
      row: banana2Row,
      reauthUrl: `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/banana2/connect`,
      scopeHint: ["image.generate", "design.asset"],
    }),
    buildOptionalConnectorStatus({
      workspaceId,
      integrationId: "google_stitch",
      configured: stitchConfigured,
      row: stitchRow,
      reauthUrl: `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/google_stitch/connect`,
      scopeHint: ["ui.generate", "design.compose"],
    }),
    buildOptionalConnectorStatus({
      workspaceId,
      integrationId: "twentyfirst",
      configured: twentyfirstConfigured,
      row: twentyfirstRow,
      reauthUrl: `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/twentyfirst/connect`,
      scopeHint: ["ui.library.read", "asset.import"],
    }),
    {
      workspace_id: workspaceId,
      integration_id: "weather_api",
      state: "connected",
      connected: true,
      scopes: ["forecast.read"],
      last_refresh_at: nowIso(),
      health_score: 0.98,
      error_code: null,
      error_message_safe: null,
      reauth_url: null,
      provider_metadata: { provider: "weather" },
    },
    {
      workspace_id: workspaceId,
      integration_id: "translate_api",
      state: "connected",
      connected: true,
      scopes: ["translate.text"],
      last_refresh_at: nowIso(),
      health_score: 0.97,
      error_code: null,
      error_message_safe: null,
      reauth_url: null,
      provider_metadata: { provider: "translate" },
    },
  ];
}
