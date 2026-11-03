"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildAssistantEndpoint,
  getLanguageUpdateEndpoint,
  getThemeUpdateEndpoint,
  getWhoamiEndpoint,
  getWorkspacesActiveEndpoint,
} from "@/utils/auth-guard";
import { getWorkspaceMailPolicy } from "@/lib/workspace/mailProviderPolicy";
import { getDefaultThemeForMode, getThemeGroup, normalizeThemeKey, type ThemeKey } from "@/lib/theme";
import { AppLanguage, resolveAppLanguage, resolveAppLanguageFromString } from "@/lib/i18n";
import {
  buildAuthRequiredPayload,
  useWhoamiLoader,
  type AuthRequiredPayload,
  type AuthState,
} from "@/lib/auth/useWhoamiLoader";
import type { WhoamiResponse } from "@/types/whoami";
import type { PendingAction, PokerState } from "@/types/poker";
import type {
  CalendarEventRecord,
  CalendarEventInput,
  CalendarEventUpdateInput,
  CalendarPendingAction,
} from "@/types/calendar";
import type { MailThread } from "@/components/workspace/mail/mailTypes";

type CalendarStatus = "idle" | "loading" | "ready" | "not_connected" | "no_access" | "error";

export type MailStatus = "loading" | "not_connected" | "connected" | "no_access" | "error";

export type MailListItem = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
};

export type MailMessageDetail = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
};

export type MailLabel = {
  id: string;
  name: string;
};

export type MailSendInput = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
};

class CalendarHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, CalendarHttpError.prototype);
  }
}

// ── Client-side integration status cache (60s TTL) ──────────────────────────
// Prevents redundant network calls on rapid workspace switches.
type CachedIntegrationStatus = {
  data: Array<Record<string, unknown>>;
  fetchedAt: number;
};
const _integrationStatusCache = new Map<string, CachedIntegrationStatus>();
const INTEGRATION_CACHE_TTL_MS = 60_000;

function getCachedIntegrationStatus(workspaceId: string): Array<Record<string, unknown>> | null {
  const entry = _integrationStatusCache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > INTEGRATION_CACHE_TTL_MS) {
    _integrationStatusCache.delete(workspaceId);
    return null;
  }
  return entry.data;
}

function setCachedIntegrationStatus(workspaceId: string, data: Array<Record<string, unknown>>): void {
  _integrationStatusCache.set(workspaceId, { data, fetchedAt: Date.now() });
}
// ────────────────────────────────────────────────────────────────────────────

type WorkspaceContextValue = {
  data: WhoamiResponse | null;
  loading: boolean;
  error: string | null;
  authRequired: AuthRequiredPayload | null;
  authState: AuthState;
  loginUrl: string | null;
  authRequiredFromWhoami: boolean;
  refresh: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  setTheme: (theme: ThemeKey | null) => Promise<boolean>;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<boolean>;
  forceUnauthenticated: () => void;
  setResolvedActiveWorkspaceId: (id: string | null) => void;
  workspaceScopedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  calendarEvents: CalendarEventRecord[];
  calendarLoading: boolean;
  calendarError: string | null;
  calendarStatus: CalendarStatus;
  refreshCalendar: () => Promise<void>;
  canWriteCalendar: boolean;
  createCalendarEvent: (payload: CalendarEventInput) => Promise<void>;
  updateCalendarEvent: (eventId: string, payload: CalendarEventUpdateInput) => Promise<void>;
  deleteCalendarEvent: (eventId: string) => Promise<void>;
  pendingCalendarAction: CalendarPendingAction | null;
  confirmPendingCalendarAction: () => Promise<void>;
  dismissPendingCalendarAction: () => Promise<void>;
  pokerState: PokerState | null;
  refreshPokerState: (workspaceId?: string | null) => Promise<void>;
  mailProvider: string | null;
  mailStatus: MailStatus;
  mailError: string | null;
  mailInbox: MailListItem[];
  mailThread: MailThread | null;
  mailThreadLoading: boolean;
  mailThreadError: string | null;
  activeMessage: MailMessageDetail | null;
  mailLabels: MailLabel[];
  mailLabelsLoading: boolean;
  mailLabelsError: string | null;
  mailIdentities: { id: string; email: string }[];
  activeMailIdentity: string | null;
  setActiveMailIdentity: (id: string | null) => void;
  loadMailLabels: () => Promise<void>;
  refreshMail: (labelId?: string) => Promise<void>;
  fetchMailMessage: (messageId: string) => Promise<void>;
  fetchMailThread: (threadId: string) => Promise<void>;
  sendAssistantChatMessage: (message: string) => Promise<void>;
  sendMail: (input: MailSendInput) => Promise<void>;
  trashMailThread: (threadId: string, labelId?: string) => Promise<void>;
  mailPendingAction: PendingAction | null;
  confirmMailAction: () => Promise<void>;
  requestMailRevision: () => Promise<void>;
  dismissMailAction: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function applyThemeToDocument(theme: ThemeKey) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = getThemeGroup(theme);
}

const resolveThemePreference = (
  userTheme: ThemeKey | null | undefined,
  workspaceTheme: ThemeKey | null | undefined,
  themeMode?: string | null
): ThemeKey => userTheme ?? workspaceTheme ?? getDefaultThemeForMode(themeMode);

const safeCalendarTimestamp = (value: string | null) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortCalendarEvents = (events: CalendarEventRecord[]) =>
  [...events].sort((a, b) => safeCalendarTimestamp(a.start) - safeCalendarTimestamp(b.start));

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const {
    data,
    loading,
    error,
    authRequired,
    authState,
    loginUrl,
    authRequiredFromWhoami,
    refresh: refreshWhoami,
    handleWhoamiResponse,
    setLoading,
    setError,
    setAuthRequired,
    setLoginUrl,
    setData,
    setAuthState,
  } = useWhoamiLoader();

  const [resolvedActiveWorkspaceId, setResolvedActiveWorkspaceId] = useState<string | null>(null);
  const [pokerState, setPokerState] = useState<PokerState | null>(null);
  const activeWorkspaceId = data?.activeWorkspace?.id ?? null;
  const workspaceScopedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? {});
      if (activeWorkspaceId) {
        headers.set("x-workspace-id", activeWorkspaceId);
      }
      const resolvedInput =
        activeWorkspaceId && input.startsWith("/api/")
          ? (() => {
              const absolute = new URL(input, window.location.origin);
              if (!absolute.searchParams.get("workspace_id") && !absolute.searchParams.get("workspaceId")) {
                absolute.searchParams.set("workspace_id", activeWorkspaceId);
              }
              return `${absolute.pathname}${absolute.search}`;
            })()
          : input;
      return fetch(resolvedInput, {
        credentials: "include",
        ...init,
        headers,
      });
    },
    [activeWorkspaceId]
  );
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>("idle");
  const [mailStatus, setMailStatus] = useState<MailStatus>("loading");
  const [mailInbox, setMailInbox] = useState<MailListItem[]>([]);
  const [mailError, setMailError] = useState<string | null>(null);
  const [mailThread, setMailThread] = useState<MailThread | null>(null);
  const [mailThreadLoading, setMailThreadLoading] = useState(false);
  const [mailThreadError, setMailThreadError] = useState<string | null>(null);
  const [activeMessage, setActiveMessage] = useState<MailMessageDetail | null>(null);
  const [mailLabels, setMailLabels] = useState<MailLabel[]>([]);
  const [mailLabelsLoading, setMailLabelsLoading] = useState(false);
  const [mailLabelsError, setMailLabelsError] = useState<string | null>(null);
  const [mailProvider, setMailProvider] = useState<string | null>(null);
  const [mailIdentities, setMailIdentities] = useState<{ id: string; email: string }[]>([]);
  const [activeMailIdentity, setActiveMailIdentity] = useState<string | null>(null);
  const canWriteCalendar = useMemo(
    () => (data?.capabilities ?? []).includes("work.calendar.write"),
    [data?.capabilities]
  );
  const noAccessWorkspaceRef = useRef<string | null>(null);
  const mailNoAccessWorkspaceRef = useRef<string | null>(null);
  const mailAbortControllerRef = useRef<AbortController | null>(null);
  const mailRequestIdRef = useRef(0);
  const mailThreadRequestIdRef = useRef(0);
  const workspaceLanguageSelection = resolveAppLanguageFromString(
    data?.userSettings?.language ?? null
  );
  const logCalendarError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      if (error instanceof CalendarHttpError && error.status === 502) {
        console.warn("[workspace] calendar request failed (gateway)", error);
      } else {
        console.error("[workspace] calendar request failed", error);
      }
      setCalendarError(message);
      return message;
    },
    [setCalendarError]
  );

  const logMailError = useCallback(
    (error: unknown, fallback: string) => {
      console.error("[workspace] mail request failed", error);
      const message = error instanceof Error ? error.message : fallback;
      setMailError(message);
      return message;
    },
    [setMailError]
  );

  const markMailWorkspaceNoAccess = useCallback(() => {
    setMailStatus("no_access");
    setMailError("workspace_not_accessible");
  }, []);

  const refreshPokerState = useCallback(async (workspaceId?: string | null) => {
    const targetWorkspaceId = workspaceId ?? activeWorkspaceId;
    if (!targetWorkspaceId) {
      setPokerState(null);
      return;
    }
    if (noAccessWorkspaceRef.current === targetWorkspaceId) {
      setPokerState(null);
      return;
    }
    setPokerState(null);
    try {
      const response = await fetch(
        buildAssistantEndpoint(`/assistant/workspaces/${targetWorkspaceId}/poker`),
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setPokerState(null);
          return;
        }
        throw new Error(`Status ${response.status}`);
      }
      const payload = await response.json().catch(() => null);
      if (payload && payload.state) {
        setPokerState(payload.state);
        return;
      }
    } catch (error) {
      console.error("[workspace] failed to load PokerState", error);
    }
    setPokerState(null);
  }, [activeWorkspaceId]);

  const clearRemotePendingAction = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      const response = await fetch(
        buildAssistantEndpoint(`/assistant/workspaces/${encodeURIComponent(activeWorkspaceId)}/poker`),
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pending_action: null }),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          (payload && typeof payload === "object" && "error" in payload && payload.error) ||
          (payload && typeof payload === "object" && "message" in payload && payload.message) ||
          response.statusText ||
          "Unable to clear Merlin action";
        throw new Error(message as string);
      }
      await refreshPokerState(activeWorkspaceId);
    } catch (error) {
      logCalendarError(error, "Unable to clear pending Merlin action");
      throw error;
    }
  }, [activeWorkspaceId, logCalendarError, refreshPokerState]);

  const refreshCalendar = useCallback(async () => {
    if (!activeWorkspaceId) {
      noAccessWorkspaceRef.current = null;
      setCalendarEvents([]);
      setCalendarError(null);
      setCalendarStatus("idle");
      setCalendarLoading(false);
      return;
    }
    if (noAccessWorkspaceRef.current === activeWorkspaceId) {
      setCalendarLoading(false);
      return;
    }
    setCalendarLoading(true);
    setCalendarError(null);
    setCalendarStatus("loading");
    try {
      const response = await fetch(
        buildAssistantEndpoint(
          `/assistant/workspaces/${encodeURIComponent(activeWorkspaceId)}/calendar/events`
        ),
        {
          method: "GET",
          credentials: "include",
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const payloadBody = payload && typeof payload === "object" ? payload : null;
        const errorCode =
          payloadBody && "error" in payloadBody && payloadBody.error;
        const errorDetail =
          payloadBody && "code" in payloadBody && payloadBody.code;
        if (
          errorCode === "calendar_not_connected" ||
          errorDetail === "NOT_CONNECTED"
        ) {
          setCalendarEvents([]);
          setCalendarError(
            (typeof payloadBody?.message === "string" && payloadBody.message) ||
              "Calendar not connected"
          );
          setCalendarStatus("not_connected");
          return;
        }
        if (errorCode === "workspace_not_accessible") {
          setCalendarEvents([]);
          setCalendarStatus("no_access");
          noAccessWorkspaceRef.current = activeWorkspaceId;
          return;
        }
        if (response.status === 401 || response.status === 403 || errorCode === "AUTH_ERROR") {
          setCalendarEvents([]);
          setCalendarStatus("not_connected");
          setCalendarError(
            (payloadBody && typeof payloadBody.message === "string" && payloadBody.message) ||
              "Calendar auth required"
          );
          return;
        }
        const message =
          (payload && typeof payload === "object" && "error" in payload && payload.error) ||
          (payload && typeof payload === "object" && "message" in payload && payload.message) ||
          response.statusText ||
          "Failed to load calendar events";
        if (
          typeof message === "string" &&
          message.toUpperCase().includes("AUTH_ERROR")
        ) {
          setCalendarEvents([]);
          setCalendarStatus("not_connected");
          setCalendarError("Calendar auth required");
          return;
        }
        setCalendarEvents([]);
        throw new CalendarHttpError(response.status, message);
      }
      // Handle both array responses and {connected: false, events: []} shape
      const eventList = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).events)
        ? (payload as Record<string, unknown>).events as unknown[]
        : null;

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const obj = payload as Record<string, unknown>;
        if (obj.connected === false) {
          setCalendarEvents([]);
          setCalendarStatus("not_connected");
          setCalendarError(
            typeof obj.message === "string" ? obj.message : "Calendar not connected"
          );
          return;
        }
      }

      if (!Array.isArray(eventList)) {
        setCalendarEvents([]);
        console.error("[workspace] calendar response was not an array", payload);
        throw new Error("Calendar response must be an array");
      }
      const normalized = eventList
        .map((entry): CalendarEventRecord | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const record = entry as Record<string, any>;
          const start = typeof record.start_at === "string" ? record.start_at : null;
          if (!start) {
            return null;
          }
          const end = typeof record.end_at === "string" ? record.end_at : null;
          return {
            id: (record.id || `event-${Math.random().toString(16).slice(2)}`).toString(),
            title:
              (record.title && record.title.toString().trim()) || "Untitled event",
            start,
            end,
            source: (record.source || "external").toString(),
            workspaceId: activeWorkspaceId,
            isEditable: canWriteCalendar,
          };
        })
        .filter((item): item is CalendarEventRecord => Boolean(item));
      setCalendarEvents(sortCalendarEvents(normalized));
      setCalendarStatus("ready");
      noAccessWorkspaceRef.current = null;
    } catch (error) {
      setCalendarStatus("error");
      logCalendarError(error, "Unable to load calendar events");
      throw error;
    } finally {
      setCalendarLoading(false);
    }
  }, [activeWorkspaceId, canWriteCalendar, logCalendarError]);

  const refreshMail = useCallback(
    async (labelId: string = "INBOX") => {
      const workspaceId = activeWorkspaceId;
      if (!workspaceId) {
        mailNoAccessWorkspaceRef.current = null;
        setMailInbox([]);
        setMailStatus("not_connected");
        setMailError(null);
        setActiveMessage(null);
        return;
      }
      if (mailNoAccessWorkspaceRef.current === workspaceId) {
        return;
      }
      mailAbortControllerRef.current?.abort();
      const controller = new AbortController();
      mailAbortControllerRef.current = controller;
      const requestId = ++mailRequestIdRef.current;
      const isStale = () => requestId !== mailRequestIdRef.current;

      setMailStatus("loading");
      setMailError(null);
      setMailInbox([]);
      setActiveMessage(null);
      try {
        // Use cached integration status if fresh (avoids re-fetch on rapid workspace switch)
        let statusItems: Array<Record<string, any>> = getCachedIntegrationStatus(workspaceId) as Array<Record<string, any>> ?? [];
        if (statusItems.length === 0) {
          const statusResponse = await workspaceScopedFetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations`,
            {
              method: "GET",
              signal: controller.signal,
            }
          );
          if (isStale()) {
            return;
          }
          const statusPayload = await statusResponse.json().catch(() => null);
          if (isStale()) {
            return;
          }
          if (!statusResponse.ok) {
            if (statusResponse.status === 403) {
              mailNoAccessWorkspaceRef.current = workspaceId;
              if (isStale()) {
                return;
              }
              markMailWorkspaceNoAccess();
              return;
            }
            if (statusResponse.status === 401) {
              if (isStale()) {
                return;
              }
              setMailStatus("not_connected");
              return;
            }
            const message =
              (statusPayload &&
                typeof statusPayload === "object" &&
                "error" in statusPayload &&
                statusPayload.error) ||
              statusResponse.statusText ||
              "Unable to check mail connection";
            throw new Error(message);
          }
          statusItems =
            statusPayload && typeof statusPayload === "object" && Array.isArray((statusPayload as any).integrations)
              ? ((statusPayload as any).integrations as Array<Record<string, any>>)
              : [];
          // Cache the result for 60s
          setCachedIntegrationStatus(workspaceId, statusItems);
        }
        const mailPolicy = getWorkspaceMailPolicy(workspaceId);
        const connectedMail = statusItems.some((entry) => {
          const key = String(entry.integrationKey ?? "").toLowerCase();
          const state = String(entry.status ?? "").toLowerCase();
          const connected = state === "connected" || entry.connected === true;
          if (!connected) return false;
          if ((key === "imap" || key === "icloud_imap") && mailPolicy.allowed.includes("imap")) {
            return true;
          }
          if (key === "google_oauth" && mailPolicy.allowed.includes("google")) {
            return true;
          }
          return false;
        });
        if (!connectedMail) {
          if (isStale()) {
            return;
          }
          setMailStatus("not_connected");
          return;
        }
        const normalizedLabel = labelId || "INBOX";
        const inboxResponse = await workspaceScopedFetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/mail/threads?limit=20&label=${encodeURIComponent(
            normalizedLabel
          )}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        );
        if (isStale()) {
          return;
        }
        const inboxPayload = await inboxResponse.json().catch(() => null);
        if (isStale()) {
          return;
        }
        if (!inboxResponse.ok) {
          if (inboxResponse.status === 403) {
            mailNoAccessWorkspaceRef.current = workspaceId;
            if (isStale()) {
              return;
            }
            markMailWorkspaceNoAccess();
            return;
          }
          if (inboxResponse.status === 401) {
            if (isStale()) {
              return;
            }
            setMailStatus("not_connected");
            return;
          }
          const message =
            (inboxPayload &&
              typeof inboxPayload === "object" &&
              "error" in inboxPayload &&
              inboxPayload.error) ||
            inboxResponse.statusText ||
            "Unable to load inbox";
          if (inboxPayload?.error === "gmail_error") {
            if (isStale()) {
              return;
            }
            setMailStatus("error");
            setMailError(message);
            return;
          }
          throw new Error(message);
        }
        const inboxBody =
          inboxPayload && typeof inboxPayload === "object"
            ? (inboxPayload as Record<string, any>)
            : null;
        // Handle {connected: false} shape (same as calendar API)
        if (inboxBody && inboxBody.connected === false && !("ok" in inboxBody)) {
          if (isStale()) return;
          setMailInbox([]);
          setMailStatus("not_connected");
          setMailError(
            typeof inboxBody.message === "string"
              ? inboxBody.message
              : "Mail not connected"
          );
          return;
        }
        if (inboxBody && "ok" in inboxBody && inboxBody.ok === false) {
          const message =
            (typeof inboxBody.error === "string" && inboxBody.error) ||
            (typeof inboxBody.message === "string" && inboxBody.message) ||
            "Mail threads request failed";
          if (isStale()) {
            return;
          }
          setMailInbox([]);
          if (inboxBody.code === "NOT_CONNECTED") {
            setMailStatus("not_connected");
            setMailError(message);
            return;
          }
          console.error("[workspace] mail threads response not ok", inboxBody);
          throw new Error(message);
        }
        const rawThreads = Array.isArray(inboxBody?.threads)
          ? inboxBody.threads
          : Array.isArray(inboxBody?.inbox)
          ? inboxBody.inbox
          : Array.isArray(inboxBody?.messages)
          ? inboxBody.messages
          : null;
        if (!Array.isArray(rawThreads)) {
          if (isStale()) {
            return;
          }
          setMailInbox([]);
          console.error("[workspace] mail threads response invalid", inboxPayload);
          throw new Error("Invalid mail threads response");
        } else {
          if (isStale()) {
            return;
          }
          const normalizedList = rawThreads
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const id = (entry.id || entry.threadId)?.toString() || "";
              if (!id) {
                return null;
              }
              return {
                id,
                from: (entry.from || entry.fromName || entry.fromAddress || "").toString(),
                subject: (entry.subject || "").toString(),
                snippet: (entry.snippet || entry.preview || entry.body || "").toString(),
                date: (entry.date || entry.receivedAt || "").toString(),
                unread: typeof entry.unread === "boolean" ? entry.unread : !Boolean(entry.isRead),
              } as MailListItem;
            })
            .filter((item): item is MailListItem => Boolean(item));
          setMailInbox(normalizedList);
        }
        if (isStale()) {
          return;
        }
        setMailStatus("connected");
        mailNoAccessWorkspaceRef.current = null;
      } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (isStale()) {
        return;
      }
      if (
        error instanceof TypeError &&
        typeof error.message === "string" &&
        error.message.toLowerCase().includes("failed to fetch")
      ) {
        return;
      }
      setMailStatus((prev) =>
        prev === "no_access" || prev === "not_connected" ? prev : "error"
      );
      logMailError(error, "Unable to load mail inbox");
    }
  }, [activeWorkspaceId, logMailError, workspaceScopedFetch]);

  const loadMailLabels = useCallback(async () => {
    const workspaceId = activeWorkspaceId;
    if (!workspaceId) {
      setMailLabels([]);
      setMailLabelsError(null);
      return;
    }
    setMailLabelsLoading(true);
    setMailLabelsError(null);
    try {
      const response = await fetch(
        buildAssistantEndpoint(
          `/assistant/workspaces/${encodeURIComponent(workspaceId)}/mail/labels`
        ),
        {
          method: "GET",
          credentials: "include",
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error) ||
          response.statusText ||
          "Unable to load mail labels";
        if (
          payload &&
          typeof payload === "object" &&
          payload.code === "NOT_CONNECTED"
        ) {
          setMailStatus((prev) =>
            prev === "no_access" ? prev : "not_connected"
          );
          setMailLabels([]);
          setMailLabelsError(message);
          return;
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          (payload && typeof payload === "object" && payload.code === "AUTH_ERROR") ||
          (typeof message === "string" && message.toUpperCase().includes("AUTH_ERROR"))
        ) {
          setMailStatus((prev) =>
            prev === "no_access" ? prev : "not_connected"
          );
          setMailLabels([]);
          setMailLabelsError("Mail auth required");
          return;
        }
        throw new Error(message);
      }
      const payloadBody =
        payload && typeof payload === "object" ? (payload as Record<string, any>) : null;
      if (payloadBody && "ok" in payloadBody && payloadBody.ok === false) {
        const message =
          (typeof payloadBody.error === "string" && payloadBody.error) ||
          (typeof payloadBody.message === "string" && payloadBody.message) ||
          "Unable to load mail labels";
        if (payloadBody.code === "NOT_CONNECTED") {
          setMailStatus((prev) =>
            prev === "no_access" ? prev : "not_connected"
          );
          setMailLabels([]);
          setMailLabelsError(message);
          return;
        }
        setMailLabels([]);
        console.error("[workspace] mail labels response not ok", payloadBody);
        throw new Error(message);
      }
      if (Array.isArray(payloadBody?.labels)) {
        const normalized = payloadBody.labels
          .filter((label: any) => label && typeof label === "object")
          .map((label: any) => ({
            id: (label.id || "").toString(),
            name: (label.name || label.id || "").toString(),
          }))
          .filter((entry: MailLabel) => Boolean(entry.id));
        setMailLabels(normalized);
      } else {
        setMailLabels([]);
        console.error("[workspace] mail labels response invalid", payload);
        throw new Error("Invalid mail labels response");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load mail labels";
      setMailLabelsError(message);
      console.error("[workspace] load mail labels failed", error);
    } finally {
      setMailLabelsLoading(false);
    }
  }, [activeWorkspaceId]);

  const sendMail = useCallback(
    async (input: MailSendInput) => {
      if (!activeWorkspaceId) {
        throw new Error("workspace_required");
      }
      const response = await fetch(
        buildAssistantEndpoint(
          `/assistant/workspaces/${encodeURIComponent(activeWorkspaceId)}/mail/send`
        ),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: input.to,
            subject: input.subject,
            bodyText: input.body,
            ...(input.cc ? { cc: input.cc } : {}),
            ...(input.bcc ? { bcc: input.bcc } : {}),
          }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error) ||
          response.statusText ||
          "Unable to send mail";
        throw new Error(message);
      }
      await refreshMail();
    },
    [activeWorkspaceId, refreshMail]
  );

  const trashMailThread = useCallback(
    async (threadId: string, labelId?: string) => {
      if (!activeWorkspaceId) {
        throw new Error("workspace_required");
      }
      if (!threadId) {
        throw new Error("thread_id_required");
      }
      const response = await fetch(
        buildAssistantEndpoint(
          `/assistant/workspaces/${encodeURIComponent(
            activeWorkspaceId
          )}/mail/threads/${encodeURIComponent(threadId)}/trash`
        ),
        {
          method: "POST",
          credentials: "include",
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error) ||
          response.statusText ||
          "Unable to trash thread";
        throw new Error(message);
      }
      await refreshMail(labelId);
    },
    [activeWorkspaceId, refreshMail]
  );

  const fetchMailThread = useCallback(
    async (threadId: string) => {
      if (!activeWorkspaceId || !threadId) {
        setMailThread(null);
        return;
      }
      const requestId = ++mailThreadRequestIdRef.current;
      const isStale = () => requestId !== mailThreadRequestIdRef.current;
      setMailThreadLoading(true);
      setMailThreadError(null);
      setMailThread(null);
      try {
        const response = await workspaceScopedFetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mail/messages/${encodeURIComponent(threadId)}`,
          {
            method: "GET",
          }
        );
        const payload = await response.json().catch(() => null);
        if (isStale()) {
          return;
        }
        if (!response.ok) {
          if (response.status === 404) {
            const notFoundMessage = "Thread nicht gefunden";
            setMailThreadError(notFoundMessage);
            setMailThread(null);
            setActiveMessage(null);
            return;
          }
          if (response.status === 403) {
            mailNoAccessWorkspaceRef.current = activeWorkspaceId;
            setMailStatus("no_access");
            logMailError(
              new Error("workspace_not_accessible"),
              "Workspace not accessible"
            );
            return;
          }
          if (response.status === 401) {
            setMailStatus("not_connected");
            return;
          }
          const message =
            (payload &&
              typeof payload === "object" &&
              "error" in payload &&
              payload.error) ||
            response.statusText ||
            "Unable to load mail thread";
          throw new Error(message);
        }
        const payloadBody =
          payload && typeof payload === "object" ? (payload as Record<string, any>) : null;
        const thread = payloadBody?.thread
          ? (payloadBody.thread as MailThread)
          : payloadBody?.message
          ? ({
              id: (payloadBody.message.threadId || payloadBody.message.id || threadId).toString(),
              subject: (payloadBody.message.subject || "E-Mail").toString(),
              participants: [payloadBody.message.from || "Unknown sender"].filter(Boolean),
              messages: [
                {
                  id: (payloadBody.message.id || threadId).toString(),
                  from: (payloadBody.message.from || "").toString(),
                  to: Array.isArray(payloadBody.message.to) ? payloadBody.message.to : [],
                  cc: Array.isArray(payloadBody.message.cc) ? payloadBody.message.cc : [],
                  subject: (payloadBody.message.subject || "E-Mail").toString(),
                  snippet: (payloadBody.message.snippet || payloadBody.message.preview || "").toString(),
                  textPlain: (payloadBody.message.bodyText || payloadBody.message.snippet || "").toString(),
                  textHtml:
                    typeof payloadBody.message.bodyHtml === "string"
                      ? payloadBody.message.bodyHtml
                      : undefined,
                  date: (payloadBody.message.date || "").toString(),
                },
              ],
            } as MailThread)
          : null;
        if (!thread) {
          throw new Error("Invalid thread payload");
        }
        if (isStale()) {
          return;
        }
        setMailThread(thread);
        const latestMessage = thread.messages[thread.messages.length - 1];
        if (latestMessage) {
          const nextActiveMessage: MailMessageDetail = {
            id: latestMessage.id,
            from: latestMessage.from,
            to: latestMessage.to,
            cc: latestMessage.cc,
            subject:
              latestMessage.subject && latestMessage.subject.trim()
                ? latestMessage.subject
                : thread.subject || "E-Mail",
            date: latestMessage.date,
            snippet: latestMessage.snippet || "",
            bodyText: latestMessage.textPlain || latestMessage.snippet || "",
            threadId: thread.id,
          };
          if (latestMessage.textHtml) {
            nextActiveMessage.bodyHtml = latestMessage.textHtml;
          }
          setActiveMessage(nextActiveMessage);
        } else {
          setActiveMessage(null);
        }
      } catch (error) {
        if (isStale()) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unable to load mail thread";
        if (/Failed to fetch Gmail thread/i.test(errorMessage)) {
          setMailThreadError("Thread nicht gefunden");
          setMailThread(null);
          setActiveMessage(null);
          return;
        }
        const reported = logMailError(error, "Unable to load mail thread");
        setMailThreadError(reported);
        setMailThread(null);
        setActiveMessage(null);
      } finally {
        if (!isStale()) {
          setMailThreadLoading(false);
        }
      }
    },
    [activeWorkspaceId, logMailError, workspaceScopedFetch]
  );

  const fetchMailMessage = useCallback(
    async (messageId: string) => {
      if (!activeWorkspaceId || !messageId) {
        return;
      }
      setMailError(null);
      setActiveMessage(null);
      try {
        const response = await workspaceScopedFetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mail/messages/${encodeURIComponent(messageId)}`,
          {
            method: "GET",
          }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 403) {
            mailNoAccessWorkspaceRef.current = activeWorkspaceId;
            setMailStatus("no_access");
            logMailError(
              new Error("workspace_not_accessible"),
              "Workspace not accessible"
            );
            return;
          }
          if (response.status === 401) {
            setMailStatus("not_connected");
            return;
          }
          const message =
            (payload &&
              typeof payload === "object" &&
              "error" in payload &&
              payload.error) ||
            response.statusText ||
            "Unable to load message";
          throw new Error(message);
        }
        if (payload && typeof payload === "object" && payload.message) {
          setActiveMessage(payload.message as MailMessageDetail);
        }
      } catch (error) {
        setMailStatus((prev) =>
          prev === "no_access" || prev === "not_connected" ? prev : "error"
        );
        logMailError(error, "Unable to load mail message");
      }
    },
    [activeWorkspaceId, logMailError, workspaceScopedFetch]
  );

  const sendAssistantChatMessage = useCallback(
    async (message: string) => {
      if (!activeWorkspaceId) {
        throw new Error("workspace_required");
      }
      const response = await fetch(
        buildAssistantEndpoint("/v1/runs"),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: activeWorkspaceId,
            prompt: message,
            language: resolveAppLanguage(workspaceLanguageSelection),
          }),
        }
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Status ${response.status}`);
      }
      await refreshPokerState(activeWorkspaceId);
      await refreshMail();
    },
    [activeWorkspaceId, refreshMail, refreshPokerState]
  );

  const mailPendingAction = useMemo<PendingAction | null>(() => {
    const action = pokerState?.pending_action;
    if (!action || action.status !== "proposed") {
      return null;
    }
    if (action.type !== "mail_send") {
      return null;
    }
    return action;
  }, [pokerState]);

  const confirmMailAction = useCallback(async () => {
    if (!mailPendingAction) {
      return;
    }
    await sendAssistantChatMessage("Ja, bitte senden.");
  }, [mailPendingAction, sendAssistantChatMessage]);

  const requestMailRevision = useCallback(async () => {
    if (!mailPendingAction) {
      return;
    }
    const subject = mailPendingAction.payload?.subject || "diese E-Mail";
    await sendAssistantChatMessage(
      `Bitte überarbeite den vorgeschlagenen E-Mail-Entwurf (${subject}) und schlage mir eine neue Version vor.`
    );
  }, [mailPendingAction, sendAssistantChatMessage]);

  const dismissMailAction = useCallback(async () => {
    try {
      await clearRemotePendingAction();
    } catch (error) {
      logMailError(error, "Unable to dismiss mail action");
      throw error;
    }
  }, [clearRemotePendingAction, logMailError]);

  const callCalendarEndpoint = useCallback(
    async (
      path: string,
      payload: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> => {
      if (!activeWorkspaceId) {
        throw new Error("Workspace is required");
      }
      const response = await fetch(buildAssistantEndpoint(path), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (data && typeof data === "object" && "error" in data && data.error) ||
          (data && typeof data === "object" && "message" in data && data.message) ||
          response.statusText ||
          "Calendar request failed";
        throw new Error(message as string);
      }
      return data;
    },
    [activeWorkspaceId]
  );

  const createCalendarEvent = useCallback(
    async (input: CalendarEventInput) => {
      if (!canWriteCalendar) {
        throw new Error("Calendar write access is required");
      }
      const tempId = `local-${Date.now().toString(36)}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const optimistic: CalendarEventRecord = {
        id: tempId,
        title: input.title || "Untitled event",
        start: input.start,
        end: input.end,
        source: "local",
        workspaceId: activeWorkspaceId,
        isEditable: true,
        isOptimistic: true,
      };
      setCalendarEvents((current) => sortCalendarEvents([...current, optimistic]));
      try {
        await callCalendarEndpoint("/assistant/calendar/events/create", {
          summary: input.title,
          title: input.title,
          start: input.start,
          end: input.end,
          description: input.description,
          location: input.location,
        });
        await refreshCalendar();
      } catch (error) {
        setCalendarEvents((current) => current.filter((event) => event.id !== tempId));
        logCalendarError(error, "Failed to create calendar event");
        throw error;
      }
    },
    [activeWorkspaceId, callCalendarEndpoint, canWriteCalendar, logCalendarError, refreshCalendar]
  );

  const updateCalendarEvent = useCallback(
    async (eventId: string, payload: CalendarEventUpdateInput) => {
      if (!canWriteCalendar) {
        throw new Error("Calendar write access is required");
      }
      let previous: CalendarEventRecord | null = null;
      setCalendarEvents((current) =>
        sortCalendarEvents(
          current.map((event) => {
            if (event.id !== eventId) {
              return event;
            }
            previous = event;
            return {
              ...event,
              title: payload.title ?? event.title,
              start: payload.start ?? event.start,
              end: payload.end ?? event.end,
              isOptimistic: true,
            };
          })
        )
      );
      try {
        await callCalendarEndpoint("/assistant/calendar/events/update", {
          id: eventId,
          eventId,
          summary: payload.title,
          title: payload.title,
          start: payload.start,
          end: payload.end,
          description: payload.description,
          location: payload.location,
        });
        await refreshCalendar();
      } catch (error) {
        if (previous) {
          setCalendarEvents((current) =>
            sortCalendarEvents(
              current.map((event) => (event.id === eventId ? previous! : event))
            )
          );
        }
        logCalendarError(error, "Failed to update calendar event");
        throw error;
      }
    },
    [callCalendarEndpoint, canWriteCalendar, logCalendarError, refreshCalendar]
  );

  const deleteCalendarEvent = useCallback(
    async (eventId: string) => {
      if (!canWriteCalendar) {
        throw new Error("Calendar write access is required");
      }
      let removed: CalendarEventRecord | null = null;
      setCalendarEvents((current) => {
        const filtered = current.filter((event) => {
          if (event.id === eventId) {
            removed = event;
            return false;
          }
          return true;
        });
        return filtered;
      });
      try {
        await callCalendarEndpoint("/assistant/calendar/events/delete", {
          id: eventId,
          eventId,
        });
        await refreshCalendar();
      } catch (error) {
        if (removed) {
          setCalendarEvents((current) => sortCalendarEvents([...current, removed!]));
        }
        logCalendarError(error, "Failed to delete calendar event");
        throw error;
      }
    },
    [callCalendarEndpoint, canWriteCalendar, logCalendarError, refreshCalendar]
  );

  const pendingCalendarAction = useMemo<CalendarPendingAction | null>(() => {
    const action = pokerState?.pending_action;
    if (!action || action.status !== "proposed") {
      return null;
    }
    if (
      action.type !== "calendar_create" &&
      action.type !== "calendar_update" &&
      action.type !== "calendar_delete"
    ) {
      return null;
    }
    return action as CalendarPendingAction;
  }, [pokerState]);

  const confirmPendingCalendarAction = useCallback(async () => {
    if (!pendingCalendarAction) {
      return;
    }
    const payload = pendingCalendarAction.payload || {};
    try {
      if (pendingCalendarAction.type === "calendar_create") {
        const start =
          payload.start ||
          payload.startIso ||
          payload.start_at ||
          new Date().toISOString();
        const end =
          payload.end ||
          payload.endIso ||
          payload.end_at ||
          start;
        await createCalendarEvent({
          title: (payload.summary || payload.title || "New event").toString(),
          start: start.toString(),
          end: end.toString(),
          description: payload.description,
          location: payload.location,
        });
      } else if (pendingCalendarAction.type === "calendar_update") {
        const eventId = (payload.eventId || payload.id || "").toString();
        if (!eventId) {
          throw new Error("Missing event id");
        }
        await updateCalendarEvent(eventId, {
          title: payload.summary || payload.title,
          start: payload.start,
          end: payload.end,
          description: payload.description,
          location: payload.location,
        });
      } else if (pendingCalendarAction.type === "calendar_delete") {
        const eventId = (payload.eventId || payload.id || "").toString();
        if (!eventId) {
          throw new Error("Missing event id");
        }
        await deleteCalendarEvent(eventId);
      }
      await clearRemotePendingAction();
    } catch (error) {
      logCalendarError(error, "Failed to confirm Merlin calendar action");
      throw error;
    }
  }, [
    pendingCalendarAction,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    clearRemotePendingAction,
    logCalendarError,
  ]);

  const dismissPendingCalendarAction = useCallback(async () => {
    try {
      await clearRemotePendingAction();
    } catch (error) {
      logCalendarError(error, "Failed to dismiss Merlin calendar action");
      throw error;
    }
  }, [clearRemotePendingAction, logCalendarError]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshWhoami();
  }, [refreshWhoami]);

  const forceUnauthenticated = useCallback(() => {
    const fallbackPayload = buildAuthRequiredPayload(null);
    setData(null);
    setAuthState("unauthenticated");
    setAuthRequired(fallbackPayload);
    setLoginUrl(fallbackPayload.loginUrl);
    setError(null);
    setLoading(false);
  }, [setData, setAuthState, setAuthRequired, setLoginUrl, setError, setLoading]);

  useEffect(() => {
    void refreshMail();
    return () => {
      mailAbortControllerRef.current?.abort();
    };
  }, [refreshMail]);

  useEffect(() => {
    void loadMailLabels();
  }, [loadMailLabels]);

  useEffect(() => {
    const themeKey = normalizeThemeKey(
      data?.resolvedTheme ??
        resolveThemePreference(
          data?.userSettings?.theme ?? null,
          data?.activeWorkspace?.defaultThemeKey ?? null,
          data?.activeWorkspace?.brand?.themeMode ?? null
        )
    );
    applyThemeToDocument(themeKey);
  }, [
    data?.resolvedTheme,
    data?.userSettings?.theme,
    data?.activeWorkspace?.defaultThemeKey,
    data?.activeWorkspace?.brand?.themeMode,
  ]);

  useEffect(() => {
    void refreshPokerState(activeWorkspaceId);
  }, [refreshPokerState, activeWorkspaceId]);

  useEffect(() => {
    void refreshCalendar().catch(() => undefined);
  }, [refreshCalendar]);

  const setActiveWorkspace = useCallback(
    async (workspaceId: string) => {
      setLoading(true);
      setError(null);
      setAuthRequired(null);
      setLoginUrl(null);
      try {
        const response = await fetch(getWorkspacesActiveEndpoint(), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });
        const result = await handleWhoamiResponse(response);

        if ("error" in result) {
          setError(result.error);
          return;
        }
        if ("authRequired" in result) {
          return;
        }
        await refresh();
      } catch (err) {
        const message =
          err instanceof TypeError
            ? "Unable to reach the assistant API. Make sure the backend worker is running and the origin is correct."
            : (err as Error).message;
        if (!(err instanceof TypeError)) {
          console.error("Workspace: failed to switch workspace", err);
        }
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [handleWhoamiResponse, refresh, setLoading, setError, setAuthRequired, setLoginUrl]
  );

  const setTheme = useCallback(
    async (theme: ThemeKey | null) => {
      const nextTheme = theme === null ? null : normalizeThemeKey(theme);
      const previousResolvedTheme = normalizeThemeKey(
        data?.resolvedTheme ??
          resolveThemePreference(
            data?.userSettings?.theme ?? null,
            data?.activeWorkspace?.defaultThemeKey ?? null,
            data?.activeWorkspace?.brand?.themeMode ?? null
          )
      );
      const nextResolvedTheme = normalizeThemeKey(
        resolveThemePreference(
          nextTheme,
          data?.activeWorkspace?.defaultThemeKey ?? null,
          data?.activeWorkspace?.brand?.themeMode ?? null
        )
      );
      setLoading(true);
      setError(null);
      setAuthRequired(null);
      setLoginUrl(null);
      applyThemeToDocument(nextResolvedTheme);
      let ok = false;
      try {
        const response = await fetch(getThemeUpdateEndpoint(), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: nextTheme }),
        });
        const result = await handleWhoamiResponse(response);

        if ("error" in result) {
          setError(result.error);
          applyThemeToDocument(previousResolvedTheme);
          return false;
        }
        if ("authRequired" in result) {
          applyThemeToDocument(previousResolvedTheme);
          return false;
        }
        await refresh();
        ok = true;
      } catch (err) {
        applyThemeToDocument(previousResolvedTheme);
        const message =
          err instanceof TypeError
            ? "Unable to reach the assistant API. Make sure the backend worker is running and the origin is correct."
            : (err as Error).message;
        if (!(err instanceof TypeError)) {
          console.error("Workspace: failed to update theme", err);
        }
        setError(message);
      } finally {
        setLoading(false);
      }
      return ok;
    },
    [
      data?.activeWorkspace?.brand?.themeMode,
      data?.activeWorkspace?.defaultThemeKey,
      data?.resolvedTheme,
      data?.userSettings?.theme,
      handleWhoamiResponse,
      refresh,
      setLoading,
      setError,
      setAuthRequired,
      setLoginUrl,
    ]
  );

  const setLanguage = useCallback(
    async (language: AppLanguage) => {
      let ok = false;
      setLoading(true);
      setError(null);
      setAuthRequired(null);
      setLoginUrl(null);
      try {
        const response = await fetch(getLanguageUpdateEndpoint(), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language }),
        });
        const result = await handleWhoamiResponse(response);
        if ("error" in result) {
          setError(result.error);
          return false;
        }
        if ("authRequired" in result) {
          return false;
        }
        await refresh();
        ok = true;
      } catch (err) {
        const message =
          err instanceof TypeError
            ? "Unable to reach the assistant API. Make sure the backend worker is running and the origin is correct."
            : (err as Error).message;
        if (!(err instanceof TypeError)) {
          console.error("Workspace: failed to update language", err);
        }
        setError(message);
      } finally {
        setLoading(false);
      }
      return ok;
    },
    [handleWhoamiResponse, refresh, setLoading, setError, setAuthRequired, setLoginUrl]
  );

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      authRequired,
      authState,
      loginUrl,
      authRequiredFromWhoami,
      refresh,
      setActiveWorkspace,
      setTheme,
      language: workspaceLanguageSelection,
      setLanguage,
      forceUnauthenticated,
      setResolvedActiveWorkspaceId,
      workspaceScopedFetch,
      calendarEvents,
      calendarLoading,
      calendarError,
      calendarStatus,
      refreshCalendar,
      canWriteCalendar,
      createCalendarEvent,
      updateCalendarEvent,
      deleteCalendarEvent,
      pendingCalendarAction,
      confirmPendingCalendarAction,
      dismissPendingCalendarAction,
      pokerState,
      refreshPokerState,
      mailProvider,
      mailStatus,
      mailError,
      mailInbox,
      mailThread,
      mailThreadLoading,
      mailThreadError,
      activeMessage,
      mailLabels,
      mailLabelsLoading,
      mailLabelsError,
      mailIdentities,
      activeMailIdentity,
      setActiveMailIdentity,
      loadMailLabels,
      refreshMail,
      fetchMailMessage,
      fetchMailThread,
      sendAssistantChatMessage,
      sendMail,
      trashMailThread,
      mailPendingAction,
      confirmMailAction,
      requestMailRevision,
      dismissMailAction,
    }),
    [
      data,
      loading,
      error,
      authRequired,
      authState,
      loginUrl,
      authRequiredFromWhoami,
      refresh,
      setActiveWorkspace,
      setTheme,
      workspaceLanguageSelection,
      setLanguage,
      forceUnauthenticated,
      setResolvedActiveWorkspaceId,
      workspaceScopedFetch,
      calendarEvents,
      calendarLoading,
      calendarError,
      calendarStatus,
      refreshCalendar,
      canWriteCalendar,
      createCalendarEvent,
      updateCalendarEvent,
      deleteCalendarEvent,
      pendingCalendarAction,
      confirmPendingCalendarAction,
      dismissPendingCalendarAction,
      pokerState,
      refreshPokerState,
      mailProvider,
      mailStatus,
      mailError,
      mailInbox,
      mailThread,
      mailThreadLoading,
      mailThreadError,
      activeMessage,
      mailLabels,
      mailLabelsLoading,
      mailLabelsError,
      mailIdentities,
      activeMailIdentity,
      loadMailLabels,
      refreshMail,
      fetchMailMessage,
      fetchMailThread,
      sendAssistantChatMessage,
      sendMail,
      trashMailThread,
      mailPendingAction,
      confirmMailAction,
      requestMailRevision,
      dismissMailAction,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceData(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("WorkspaceData must be used within WorkspaceProvider");
  }
  return context;
}

/**
 * Safe variant — returns null when called outside a WorkspaceProvider.
 * Use this in providers that mount at the OS shell level (e.g. LocaleProvider)
 * where WorkspaceProvider is not guaranteed to be in the tree.
 */
export function useWorkspaceDataOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext) ?? null;
}

export type { WhoamiWorkspaceBrand, WhoamiWorkspace, WhoamiWorkspaceConnection, WhoamiResponse } from "@/types/whoami";
