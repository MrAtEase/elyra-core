import { ensureSupabaseToken } from "@/lib/supabase/browser";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_TASKS_SCOPE,
  hasRequiredScopes,
} from "@/lib/google/scopes";

export type GmailListMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  preview: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  labels: string[];
};

export type GmailMessageDetail = GmailListMessage & {
  bodyText: string;
  bodyHtml?: string;
  headers: Array<{ name: string; value: string }>;
};

export type CalendarEventRecord = {
  id: string;
  title: string;
  start: string;
  end: string;
  date: string;
  color?: string | undefined;
  category?: string | undefined;
  location?: string | null;
  attendees?: string[];
  isVideoCall?: boolean;
  calendarId?: string;
};

export type CalendarListRecord = {
  id: string;
  summary: string;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string | null;
  primary: boolean;
  selected: boolean;
  timeZone: string | null;
};

export type GoogleStatusResponse = {
  ok: boolean;
  user: {
    id: string;
    email: string | null;
    avatarUrl: string | null;
    initials: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  google: {
    connected: boolean;
    scopes: string[];
    accountEmail: string | null;
    hasGmailRead: boolean;
    hasCalendarRead: boolean;
    hasCalendarWrite: boolean;
    needsReauth?: boolean;
    missingScopes?: string[];
    connectionState?: "disconnected" | "connected" | "needs_auth" | "needs_scope" | "error";
    missingRequiredScopes?: string[];
    config: {
      ready: boolean;
      issues: string[];
    };
    error: string | null;
  };
};

export type WorkspaceIntegrationState = {
  workspaceId: string;
  mailProvider: "google" | "imap" | "icloud_imap" | null;
  calendarProvider: "google" | "icloud_caldav" | null;
  google: GoogleStatusResponse["google"];
  integrations: Array<{
    integration_id: string;
    state: "connected" | "needs_auth" | "degraded" | "disconnected";
    connected: boolean;
    scopes: string[];
    reauth_url: string | null;
    error_message_safe: string | null;
  }>;
};

export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}

function deriveInitials(email: string | null): string {
  if (!email) return "EC";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase() || "EC"
    );
  }
  return local.slice(0, 2).toUpperCase() || "EC";
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    try {
      const token = await ensureSupabaseToken();
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // Keep request unauthenticated; caller gets a structured 401/403 response.
    }
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new AiServiceError(
      (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message) ||
        `Request failed (${response.status})`,
      response.status,
      (typeof payload?.code === "string" && payload.code) || null
    );
  }

  return payload as T;
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const resourceCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

function buildCacheKey(input: RequestInfo | URL, init?: RequestInit): string | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return `${method}:${url}`;
}

function invalidateCacheMatch(pattern: RegExp) {
  for (const key of resourceCache.keys()) {
    if (pattern.test(key)) {
      resourceCache.delete(key);
    }
  }
}

async function requestJsonCached<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ttlMs: number
): Promise<T> {
  const key = buildCacheKey(input, init);
  if (!key || ttlMs <= 0) {
    return requestJson<T>(input, init);
  }

  const now = Date.now();
  const cached = resourceCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const inflight = inflightRequests.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = requestJson<T>(input, init)
    .then((value) => {
      resourceCache.set(key, {
        expiresAt: Date.now() + ttlMs,
        value,
      });
      inflightRequests.delete(key);
      return value;
    })
    .catch((error) => {
      inflightRequests.delete(key);
      throw error;
    });

  inflightRequests.set(key, promise);
  return promise;
}

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8788";

const GOOGLE_DEMO_REQUIRED_SCOPES = [
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
] as const;

function applyGoogleScopeRequirements(status: GoogleStatusResponse): GoogleStatusResponse {
  const scopes = Array.isArray(status.google.scopes) ? status.google.scopes : [];
  const required = Array.from(new Set([...GOOGLE_DEMO_REQUIRED_SCOPES]));
  const scopeCheck = hasRequiredScopes(scopes, required);
  const missingScopes = scopeCheck.ok ? [] : scopeCheck.missing;
  const alreadyConnected = Boolean(status.google.connected);
  const needsReauth = alreadyConnected && missingScopes.length > 0;
  const mergedMissing = Array.from(
    new Set([...(status.google.missingRequiredScopes ?? []), ...missingScopes])
  );
  return {
    ...status,
    google: {
      ...status.google,
      needsReauth,
      ...(mergedMissing.length > 0 ? { missingScopes: mergedMissing } : { missingScopes: [] }),
      ...(mergedMissing.length > 0
        ? { missingRequiredScopes: mergedMissing }
        : {}),
      ...(needsReauth
        ? { connectionState: "needs_scope" as const }
        : {}),
    },
  };
}

export async function fetchGoogleStatus(
  workspaceId?: string
): Promise<GoogleStatusResponse> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) ?? undefined;
  const localUrl = new URL("/api/google/status", window.location.origin);
  if (normalizedWorkspaceId) {
    localUrl.searchParams.set("workspaceId", normalizedWorkspaceId);
  }
  let token: string | null = null;
  try {
    token = await ensureSupabaseToken();
  } catch {
    token = null;
  }
  const localHeaders = token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : null;

  try {
    const payload = await requestJsonCached<GoogleStatusResponse>(
      localUrl,
      localHeaders
        ? {
            method: "GET",
            headers: localHeaders,
          }
        : {
            method: "GET",
          },
      300_000,
    );
    return applyGoogleScopeRequirements(payload);
  } catch (localError) {
    if (!normalizedWorkspaceId) {
      throw localError;
    }
    try {
      if (!token) {
        token = await ensureSupabaseToken();
      }
      const remoteUrl = new URL(`${AI_SERVICE_URL}/v1/google/status`);
      remoteUrl.searchParams.set("workspaceId", normalizedWorkspaceId);
      const payload = await requestJsonCached<GoogleStatusResponse>(remoteUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }, 300_000);
      return applyGoogleScopeRequirements(payload);
    } catch (remoteError) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[liveGoogleClient] google status failed for local + ai-service", {
          workspaceId: normalizedWorkspaceId,
          localReason: localError instanceof Error ? localError.message : String(localError),
          remoteReason: remoteError instanceof Error ? remoteError.message : String(remoteError),
        });
      }
      throw remoteError;
    }
  }
}

type BootstrapContractResponse = {
  ok: boolean;
  contract?: {
    integration_status?: Array<{
      integration_id?: string;
      state?: "connected" | "needs_auth" | "degraded" | "disconnected";
      connected?: boolean;
      scopes?: string[];
      reauth_url?: string | null;
      error_message_safe?: string | null;
    }>;
  };
};

async function fetchBootstrapIntegrations(workspaceId: string): Promise<WorkspaceIntegrationState["integrations"]> {
  const url = new URL("/api/os/bootstrap", window.location.origin);
  url.searchParams.set("workspaceId", workspaceId);
  const payload = await requestJsonCached<BootstrapContractResponse>(url, { method: "GET" }, 300_000);
  const rows = payload.contract?.integration_status;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((entry) => entry && typeof entry === "object" && typeof entry.integration_id === "string")
    .map((entry) => ({
      integration_id: entry.integration_id as string,
      state:
        entry.state === "connected" ||
        entry.state === "needs_auth" ||
        entry.state === "degraded" ||
        entry.state === "disconnected"
          ? entry.state
          : "disconnected",
      connected: Boolean(entry.connected),
      scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((scope): scope is string => typeof scope === "string") : [],
      reauth_url: typeof entry.reauth_url === "string" ? entry.reauth_url : null,
      error_message_safe:
        typeof entry.error_message_safe === "string" ? entry.error_message_safe : null,
    }));
}

type WorkspaceIntegrationsResponse = {
  ok: boolean;
  integrations?: Array<{
    integrationKey?: string;
    state?: "connected" | "needs_auth" | "degraded" | "disconnected";
    connected?: boolean;
    scopes?: string[];
    reauthUrl?: string | null;
    errorMessage?: string | null;
  }>;
};

async function fetchWorkspaceIntegrations(workspaceId: string): Promise<WorkspaceIntegrationState["integrations"]> {
  const url = new URL(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations`, window.location.origin);
  const payload = await requestJsonCached<WorkspaceIntegrationsResponse>(url, { method: "GET" }, 300_000);
  const rows = payload.integrations;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((entry) => entry && typeof entry === "object" && typeof entry.integrationKey === "string")
    .map((entry) => ({
      integration_id: entry.integrationKey as string,
      state:
        entry.state === "connected" ||
        entry.state === "needs_auth" ||
        entry.state === "degraded" ||
        entry.state === "disconnected"
          ? entry.state
          : "disconnected",
      connected: Boolean(entry.connected),
      scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((scope): scope is string => typeof scope === "string") : [],
      reauth_url: typeof entry.reauthUrl === "string" ? entry.reauthUrl : null,
      error_message_safe: typeof entry.errorMessage === "string" ? entry.errorMessage : null,
    }));
}

function mergeIntegrationRows(
  workspaceRows: WorkspaceIntegrationState["integrations"],
  bootstrapRows: WorkspaceIntegrationState["integrations"]
): WorkspaceIntegrationState["integrations"] {
  const merged = new Map<string, WorkspaceIntegrationState["integrations"][number]>();
  for (const entry of bootstrapRows) {
    merged.set(entry.integration_id, entry);
  }
  for (const entry of workspaceRows) {
    merged.set(entry.integration_id, entry);
  }
  return Array.from(merged.values());
}

export async function fetchWorkspaceIntegrationState(
  workspaceId: string
): Promise<WorkspaceIntegrationState> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) ?? workspaceId;
  const [googleStatusOrNull, bootstrapIntegrations, workspaceIntegrations] = await Promise.all([
    fetchGoogleStatus(normalizedWorkspaceId).catch(() => null),
    fetchBootstrapIntegrations(normalizedWorkspaceId).catch(() => []),
    fetchWorkspaceIntegrations(normalizedWorkspaceId).catch(() => []),
  ]);
  const integrations = mergeIntegrationRows(workspaceIntegrations, bootstrapIntegrations);

  const googleStatus: GoogleStatusResponse =
    googleStatusOrNull ??
    ({
      ok: true,
      user: {
        id: "",
        email: null,
        avatarUrl: null,
        initials: deriveInitials(null),
      },
      workspace: {
        id: normalizedWorkspaceId,
        name: normalizedWorkspaceId,
        slug: normalizedWorkspaceId,
      },
      google: {
        connected: false,
        scopes: [],
        accountEmail: null,
        hasGmailRead: false,
        hasCalendarRead: false,
        hasCalendarWrite: false,
        connectionState: "error",
        missingRequiredScopes: [],
        config: {
          ready: false,
          issues: ["Google status temporarily unavailable."],
        },
        error: "google_status_unavailable",
      },
    } satisfies GoogleStatusResponse);

  const icloudMailConnected = integrations.some(
    (entry) =>
      (entry.integration_id === "imap" || entry.integration_id === "icloud_imap") &&
      entry.connected &&
      entry.state === "connected"
  );
  const icloudCalendarConnected = integrations.some(
    (entry) => entry.integration_id === "icloud_caldav" && entry.connected && entry.state === "connected"
  );

  const mailProvider: WorkspaceIntegrationState["mailProvider"] =
    googleStatus.google.config.ready && googleStatus.google.connected && googleStatus.google.hasGmailRead
      ? "google"
      : icloudMailConnected
        ? "imap"
        : null;
  const calendarProvider: WorkspaceIntegrationState["calendarProvider"] =
    googleStatus.google.config.ready && googleStatus.google.connected && googleStatus.google.hasCalendarRead
      ? "google"
      : icloudCalendarConnected
        ? "icloud_caldav"
        : null;

  return {
    workspaceId: normalizedWorkspaceId,
    mailProvider,
    calendarProvider,
    google: googleStatus.google,
    integrations,
  };
}

export async function resolveOsWorkspaceId(
  fallbackWorkspaceAlias?: string
): Promise<string> {
  const status = await fetchGoogleStatus(fallbackWorkspaceAlias);
  return status.workspace.id;
}

export function buildGoogleConnectUrl(workspaceId?: string, next = "/os"): string {
  const url = new URL("/api/google/connect", window.location.origin);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId);
  }
  url.searchParams.set("next", next);
  return url.toString();
}

export async function startGoogleConnect(
  workspaceId?: string,
  next = "/os"
): Promise<void> {
  const url = new URL("/api/google/connect", window.location.origin);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId);
  }
  url.searchParams.set("next", next);
  const token = await ensureSupabaseToken();
  const payload = await requestJson<{ ok: boolean; url?: string }>(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!payload.url) {
    throw new AiServiceError("Google OAuth URL missing.", 502, "GOOGLE_URL_MISSING");
  }
  invalidateCacheMatch(/GET:.*\/api\/google\/status/);
  window.location.assign(payload.url);
}

export async function disconnectGoogle(
  workspaceId?: string
): Promise<void> {
  const url = new URL("/api/google/disconnect", window.location.origin);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId);
  }
  await requestJson<{ ok: boolean }>(url, {
    method: "POST",
  });
  invalidateCacheMatch(/GET:.*\/api\/google\/status|GET:.*\/api\/os\/bootstrap|GET:.*\/api\/workspaces\/.+\/integrations/);
}

export async function fetchGmailMessages(input: {
  workspaceId?: string;
  q?: string;
  limit?: number;
}): Promise<GmailListMessage[]> {
  const url = new URL("/api/gmail/messages", window.location.origin);
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId) ?? input.workspaceId?.trim();
  if (normalizedWorkspaceId?.trim()) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId.trim());
  }
  if (input.q?.trim()) {
    url.searchParams.set("q", input.q.trim());
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    url.searchParams.set("limit", `${Math.max(1, Math.min(40, Math.round(input.limit)))}`);
  }

  const payload = await requestJsonCached<{ messages?: GmailListMessage[] }>(url, undefined, 120_000);
  return Array.isArray(payload.messages) ? payload.messages : [];
}

export async function fetchIcloudMessages(input: {
  workspaceId?: string;
  mailbox?: string;
  limit?: number;
}): Promise<GmailListMessage[]> {
  const url = new URL("/api/mail/imap/messages", window.location.origin);
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId) ?? input.workspaceId?.trim();
  if (normalizedWorkspaceId?.trim()) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId.trim());
  }
  if (input.mailbox?.trim()) {
    url.searchParams.set("mailbox", input.mailbox.trim());
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    url.searchParams.set("limit", `${Math.max(1, Math.min(50, Math.round(input.limit)))}`);
  }

  const payload = await requestJsonCached<{ messages?: GmailListMessage[] }>(url, undefined, 120_000);
  return Array.isArray(payload.messages) ? payload.messages : [];
}

export async function fetchGmailMessageDetail(input: {
  workspaceId?: string;
  messageId: string;
}): Promise<GmailMessageDetail | null> {
  const url = new URL(
    `/api/gmail/messages/${encodeURIComponent(input.messageId)}`,
    window.location.origin
  );
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId) ?? input.workspaceId?.trim();
  if (normalizedWorkspaceId?.trim()) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId.trim());
  }
  const payload = await requestJsonCached<{ message?: GmailMessageDetail }>(url, undefined, 120_000);
  return payload.message ?? null;
}

export async function fetchIcloudMessageDetail(input: {
  workspaceId?: string;
  messageId: string;
}): Promise<GmailMessageDetail | null> {
  const url = new URL(
    `/api/mail/imap/message/${encodeURIComponent(input.messageId)}`,
    window.location.origin
  );
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId) ?? input.workspaceId?.trim();
  if (normalizedWorkspaceId?.trim()) {
    url.searchParams.set("workspaceId", normalizedWorkspaceId.trim());
  }
  const payload = await requestJsonCached<{ message?: GmailMessageDetail }>(url, undefined, 120_000);
  return payload.message ?? null;
}

export async function fetchCalendarCalendars(input: {
  workspaceId?: string;
}): Promise<CalendarListRecord[]> {
  const url = new URL("/api/calendar/calendars", window.location.origin);
  if (input.workspaceId?.trim()) {
    url.searchParams.set("workspaceId", input.workspaceId.trim());
  }
  const payload = await requestJsonCached<{ calendars?: CalendarListRecord[] }>(url, undefined, 300_000);
  return Array.isArray(payload.calendars) ? payload.calendars : [];
}

export async function fetchIcloudCalendarCalendars(input: {
  workspaceId?: string;
}): Promise<CalendarListRecord[]> {
  const url = new URL("/api/calendar/caldav/calendars", window.location.origin);
  if (input.workspaceId?.trim()) {
    url.searchParams.set("workspaceId", input.workspaceId.trim());
  }
  const payload = await requestJsonCached<{ calendars?: CalendarListRecord[] }>(url, undefined, 300_000);
  return Array.isArray(payload.calendars) ? payload.calendars : [];
}

export async function fetchCalendarEvents(input: {
  workspaceId?: string;
  from: string;
  to: string;
  calendarId?: string;
}): Promise<CalendarEventRecord[]> {
  const url = new URL("/api/calendar/events", window.location.origin);
  if (input.workspaceId?.trim()) {
    url.searchParams.set("workspaceId", input.workspaceId.trim());
  }
  if (input.calendarId?.trim()) {
    url.searchParams.set("calendarId", input.calendarId.trim());
  }
  url.searchParams.set("from", input.from);
  url.searchParams.set("to", input.to);

  const payload = await requestJsonCached<{ events?: CalendarEventRecord[] }>(url, undefined, 120_000);
  return Array.isArray(payload.events) ? payload.events : [];
}

export async function fetchIcloudCalendarEvents(input: {
  workspaceId?: string;
  from: string;
  to: string;
  calendarId?: string;
}): Promise<CalendarEventRecord[]> {
  const url = new URL("/api/calendar/caldav/events", window.location.origin);
  if (input.workspaceId?.trim()) {
    url.searchParams.set("workspaceId", input.workspaceId.trim());
  }
  if (input.calendarId?.trim()) {
    url.searchParams.set("calendarId", input.calendarId.trim());
  }
  url.searchParams.set("from", input.from);
  url.searchParams.set("to", input.to);

  const payload = await requestJsonCached<{ events?: CalendarEventRecord[] }>(url, undefined, 120_000);
  return Array.isArray(payload.events) ? payload.events : [];
}

export async function createCalendarEvent(input: {
  workspaceId?: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
}): Promise<CalendarEventRecord> {
  const url = new URL("/api/calendar/events", window.location.origin);
  if (input.workspaceId?.trim()) {
    url.searchParams.set("workspaceId", input.workspaceId.trim());
  }

  const payload = await requestJson<{ event: CalendarEventRecord }>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  invalidateCacheMatch(/GET:.*\/api\/calendar\/events|GET:.*\/api\/calendar\/calendars/);

  return payload.event;
}
