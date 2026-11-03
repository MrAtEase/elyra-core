import { NextRequest, NextResponse } from "next/server";
import type { WhoamiResponse } from "@/types/whoami";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import type { UiBootstrapContract } from "@/lib/orb-os/contracts/types";
import { resolveUiModel } from "@/lib/orb-os/contracts/rendering";
import type {
  DashboardConnectedApp,
  DashboardGoogleConnectionState,
  DashboardGoal,
  DashboardInboxMessage,
  DashboardPayload,
  DashboardRun,
  DashboardSection,
  DashboardSectionState,
  DashboardSections,
  DashboardSummary,
  DashboardSuggestedAction,
  DashboardTask,
  DashboardUpcomingItem,
} from "@/lib/orb-os/dashboard/types";
import { buildExampleBootstrapContract } from "@/lib/orb-os/contracts/examples";
import { getWorkspaceId, resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import { listGmailMessages } from "@/lib/google/gmail";
import { listGoogleCalendarEvents } from "@/lib/google/calendar";
import { listGoogleOpenTasks } from "@/lib/google/tasks";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_TASKS_READONLY_SCOPE,
} from "@/lib/google/scopes";
import { fetchWhoamiPayload, getWhoamiUserId } from "@/lib/api/whoamiClient";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

// ─── Route-level cache (per user, 30 s TTL) ───────────────────────────────────
const DASHBOARD_CACHE_TTL_MS = 30_000;
const dashboardCache = new Map<string, { expiresAt: number; payload: DashboardPayload }>();
const dashboardInflight = new Map<string, Promise<DashboardPayload>>();

function resolveWorkspaceId(request: NextRequest, payload: WhoamiResponse): string | null {
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
  const resolved = getWorkspaceId(request, false);
  const requested = resolved.ok ? (resolved.workspaceId ?? "") : "";

  // Resolve canonical frontend IDs (ws-personal, ws-elyra-core) to real UUIDs
  if (requested) {
    const realId = resolveCanonicalWorkspaceId(requested, workspaces);
    if (realId) return realId;
  }

  // whoami payload from lightweight auth services can omit workspaces[].
  // In that case we still trust explicitly requested workspace scope.
  const normalizedRequested = normalizeWorkspaceId(requested) ?? requested;
  if (normalizedRequested && workspaces.length === 0) {
    return normalizedRequested;
  }

  const fallback =
    payload.activeWorkspace?.id ||
    payload.session?.activeWorkspaceId ||
    payload.workspaceId ||
    payload.userSettings?.defaultWorkspaceId ||
    workspaces[0]?.id ||
    null;
  return fallback ?? null;
}

function buildGoals(workspaceId: string): { north_star: DashboardGoal[]; operational: DashboardGoal[] } {
  return {
    north_star: [],
    operational: [],
  };
}

function buildRuns(workspaceId: string): DashboardRun[] {
  return [];
}

function buildConnectedApps(
  workspaceId: string,
  contract: UiBootstrapContract,
  googleState: DashboardGoogleConnectionState,
): DashboardConnectedApp[] {
  return contract.app_manifest
    .filter((manifest) =>
      contract.installed_apps.some(
        (app) => app.workspace_id === workspaceId && app.app_id === manifest.app_id && app.installed && app.enabled,
      ),
    )
    .map((manifest) => {
      const integration = contract.integration_status.find((entry) => {
        return manifest.auth_requirements.some((req) => req.integration_id === entry.integration_id);
      });
      const hasPolicyBlockedBadge = manifest.status_badges.includes("policy_blocked");
      const requiresGoogleAuth = manifest.auth_requirements.some(
        (requirement) => requirement.integration_id === "google_oauth",
      );
      let status: DashboardConnectedApp["status"] = "connected";
      if (hasPolicyBlockedBadge) {
        status = "policy_blocked";
      } else if (integration?.state === "degraded") {
        status = "degraded";
      } else if (integration?.state === "needs_auth" || integration?.state === "disconnected") {
        status = "needs_auth";
      } else if (!integration && requiresGoogleAuth) {
        status = "needs_auth";
      } else if (requiresGoogleAuth && googleState === "needs_scope") {
        status = "needs_scope";
      }
      return {
        app_id: manifest.app_id,
        app_name: manifest.name,
        icon_name: manifest.icon.name,
        status,
        scopes_count: integration?.scopes.length ?? 0,
        last_refresh_at: integration?.last_refresh_at ?? null,
        detail: integration?.error_message_safe ?? null,
      };
    });
}

function buildUpcoming(): DashboardUpcomingItem[] {
  return [];
}

function summarizeMailbox(messages: Awaited<ReturnType<typeof listGmailMessages>>): {
  unreadCount: number;
  latest: DashboardInboxMessage[];
} {
  const unreadCount = messages.filter((message) => !message.isRead).length;
  const latest = messages.slice(0, 5).map((message) => ({
    id: message.id,
    from: message.from,
    subject: message.subject,
    snippet: message.preview,
    at: message.date,
    is_read: message.isRead,
  }));
  return { unreadCount, latest };
}

function nowRange(daysAhead = 7) {
  const now = new Date();
  const to = new Date(now);
  to.setDate(to.getDate() + daysAhead);
  return { from: now.toISOString(), to: to.toISOString() };
}

async function buildDashboardSummary(input: {
  workspaceId: string;
  userId: string | null;
  runsData: DashboardRun[];
  timing?: ReturnType<typeof createServerTimingTrace>;
}): Promise<DashboardSummary> {
  const requiredScopes = [
    GOOGLE_GMAIL_READONLY_SCOPE,
    GOOGLE_CALENDAR_READONLY_SCOPE,
    GOOGLE_TASKS_READONLY_SCOPE,
  ];

  const summary: DashboardSummary = {
    google: {
      state: "disconnected",
      reason: null,
      required_scopes: [],
    },
    today: {
      date: new Date().toISOString().slice(0, 10),
      next_event: null,
      tasks_open_count: 0,
      tasks: [],
    },
    inbox: {
      unread_count: 0,
      latest: [],
    },
    activity: {
      runs_count: input.runsData.length,
      latest_runs: input.runsData.slice(0, 5),
    },
  };

  const baseCredentials = await (input.timing
    ? input.timing.measure(
        "credentials",
        resolveCredentials({
          provider: "google",
          workspaceId: input.workspaceId,
          userId: input.userId,
          requiredScopes: [],
        }),
        "google base credentials"
      )
    : resolveCredentials({
        provider: "google",
        workspaceId: input.workspaceId,
        userId: input.userId,
        requiredScopes: [],
      }));

  // ── Google-Basisstatus auswerten ─────────────────────────────────────────
  if (!baseCredentials.ok) {
    summary.google.state =
      baseCredentials.code === "missing_scopes"
        ? "needs_scope"
        : baseCredentials.code === "needs_auth"
          ? "needs_auth"
          : "error";
    summary.google.reason = baseCredentials.message;
    summary.google.required_scopes =
      baseCredentials.code === "missing_scopes" ? baseCredentials.missingScopes : requiredScopes;
    return summary;
  }

  const missingScopes = requiredScopes.filter((scope) => !baseCredentials.scopes.includes(scope));
  if (missingScopes.length > 0) {
    summary.google.state = "needs_scope";
    summary.google.reason = `Missing scope(s): ${missingScopes.join(", ")}`;
    summary.google.required_scopes = missingScopes;
  } else {
    summary.google.state = "connected";
  }

  const canReadGmail = baseCredentials.scopes.includes(GOOGLE_GMAIL_READONLY_SCOPE);
  const canReadCalendar = baseCredentials.scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE);
  const canReadTasks = baseCredentials.scopes.includes(GOOGLE_TASKS_READONLY_SCOPE);

  // ── Gmail, Calendar und Tasks parallel fetchen ───────────────────────────
  const range = nowRange(7);
  const [inboxResult, eventsResult, tasksResult] = await Promise.allSettled([
    canReadGmail
      ? (input.timing
          ? input.timing.measure(
              "gmail",
              listGmailMessages({ accessToken: baseCredentials.accessToken, q: "in:inbox", limit: 10 }),
              "gmail inbox"
            )
          : listGmailMessages({ accessToken: baseCredentials.accessToken, q: "in:inbox", limit: 10 }))
      : Promise.resolve([] as Awaited<ReturnType<typeof listGmailMessages>>),
    canReadCalendar
      ? (input.timing
          ? input.timing.measure(
              "calendar",
              listGoogleCalendarEvents({
                accessToken: baseCredentials.accessToken,
                from: range.from,
                to: range.to,
                limit: 20,
              }),
              "calendar events"
            )
          : listGoogleCalendarEvents({
              accessToken: baseCredentials.accessToken,
              from: range.from,
              to: range.to,
              limit: 20,
            }))
      : Promise.resolve([] as Awaited<ReturnType<typeof listGoogleCalendarEvents>>),
    canReadTasks
      ? (input.timing
          ? input.timing.measure(
              "tasks",
              listGoogleOpenTasks({ accessToken: baseCredentials.accessToken }),
              "google tasks"
            )
          : listGoogleOpenTasks({ accessToken: baseCredentials.accessToken }))
      : Promise.resolve([] as Awaited<ReturnType<typeof listGoogleOpenTasks>>),
  ]);

  // ── Gmail-Ergebnis anwenden ───────────────────────────────────────────────
  if (inboxResult.status === "fulfilled" && inboxResult.value.length > 0) {
    const inboxSummary = summarizeMailbox(inboxResult.value);
    summary.inbox.unread_count = inboxSummary.unreadCount;
    summary.inbox.latest = inboxSummary.latest;
  } else if (inboxResult.status === "rejected" && summary.google.state === "connected") {
    summary.google.state = "error";
    summary.google.reason =
      inboxResult.reason instanceof Error ? inboxResult.reason.message : "Unable to load Gmail inbox.";
  }

  // ── Calendar-Ergebnis anwenden ────────────────────────────────────────────
  if (eventsResult.status === "fulfilled") {
    const next = eventsResult.value[0];
    if (next) {
      summary.today.next_event = {
        id: next.id,
        kind: "event",
        title: next.title,
        at: next.start || next.date,
        source: next.calendarId ?? "google_calendar",
      };
    }
  } else if (eventsResult.status === "rejected" && summary.google.state === "connected") {
    summary.google.state = "error";
    summary.google.reason =
      eventsResult.reason instanceof Error
        ? eventsResult.reason.message
        : "Unable to load calendar events.";
  }

  // ── Tasks-Ergebnis anwenden ───────────────────────────────────────────────
  if (tasksResult.status === "fulfilled") {
    const tasks = tasksResult.value;
    summary.today.tasks_open_count = tasks.length;
    summary.today.tasks = tasks.slice(0, 5).map((task) => ({
      id: task.id,
      title: task.title,
      due_at: task.due_at,
    }));
  } else if (tasksResult.status === "rejected" && summary.google.state === "connected") {
    summary.google.state = "error";
    summary.google.reason =
      tasksResult.reason instanceof Error ? tasksResult.reason.message : "Unable to load tasks.";
  }

  return summary;
}

function sectionFromData<T>(data: T, options?: { integrationIds?: string[]; forceState?: DashboardSectionState }): DashboardSection<T> {
  const integrationMeta = options?.integrationIds ? { integration_ids: options.integrationIds } : {};
  if (options?.forceState) {
    return {
      state: options.forceState,
      data: options.forceState === "ready" ? data : null,
      ...integrationMeta,
    };
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { state: "empty", data: null, ...integrationMeta };
    }
    return { state: "ready", data, ...integrationMeta };
  }

  if (data && typeof data === "object") {
    const objectValues = Object.values(data as Record<string, unknown>);
    const hasArrayValues = objectValues.every((value) => Array.isArray(value));
    if (hasArrayValues) {
      const total = objectValues.reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
      if (total === 0) {
        return { state: "empty", data: null, ...integrationMeta };
      }
    }
  }

  return { state: "ready", data, ...integrationMeta };
}

function sectionError<T>(code: string, message: string): DashboardSection<T> {
  return {
    state: "error",
    data: null,
    error_code: code,
    error_message_safe: message,
  };
}

function withSectionFallback<T>(build: () => DashboardSection<T>, fallbackCode: string, fallbackMessage: string): DashboardSection<T> {
  try {
    return build();
  } catch {
    return sectionError<T>(fallbackCode, fallbackMessage);
  }
}

export async function GET(request: NextRequest) {
  try {
    const timing = createServerTimingTrace("api/os/dashboard");
    const respond = (response: NextResponse, meta?: Record<string, unknown>) => {
      timing.log(meta);
      return timing.apply(response) as NextResponse;
    };

    const requestWorkspace = getWorkspaceId(request, false);
    if (!requestWorkspace.ok) {
      return respond(NextResponse.json(
        { ok: false, error: requestWorkspace.error, reason: requestWorkspace.reason, hint: requestWorkspace.hint },
        { status: requestWorkspace.status }
      ));
    }

    const { response, payload } = await timing.measure("whoami", fetchWhoamiPayload(request), "worker auth");
    if (!response.ok || !payload) {
      return respond(NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status }));
    }

    const workspaceId = resolveWorkspaceId(request, payload);
    const role = (payload.membership?.role || "member").toLowerCase();
    if (!workspaceId) {
      return respond(NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 }));
    }

    const userId = getWhoamiUserId(payload);
    const cacheKey = `${workspaceId}::${userId ?? "anon"}`;

    // ── Cache-Hit prüfen ───────────────────────────────────────────────────────
    const cached = dashboardCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      timing.mark("cache", "hit");
      return respond(NextResponse.json({ ok: true, dashboard: cached.payload, _cache: "hit" }), {
        workspaceId,
        cache: "hit",
      });
    }

    // ── In-Flight-Deduplizierung ───────────────────────────────────────────────
    const existing = dashboardInflight.get(cacheKey);
    if (existing) {
      const dashboard = await existing;
      timing.mark("cache", "inflight");
      return respond(NextResponse.json({ ok: true, dashboard, _cache: "inflight" }), {
        workspaceId,
        cache: "inflight",
      });
    }

    const buildPromise = (async (): Promise<DashboardPayload> => {
      let contract: UiBootstrapContract;
      const runsData = buildRuns(workspaceId);
      const summaryPromise = buildDashboardSummary({ workspaceId, userId, runsData, timing });
      try {
        contract = await timing.measure(
          "contract",
          buildBootstrapContractFromDb(workspaceId, { userId, seedIfMissing: true }),
          "supabase contract"
        );
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[api/os/dashboard] failed to load DB-backed contract; using fallback contract", {
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        contract = buildExampleBootstrapContract(workspaceId);
      }

      const [ui, summary] = await Promise.all([
        timing.measure("ui", Promise.resolve(resolveUiModel(contract, { role })), "render ui model"),
        summaryPromise,
      ]);

      const googleNeedsAuth = summary.google.state === "needs_auth";
      const googleNeedsScope = summary.google.state === "needs_scope";

      const sections: DashboardSections = {
        goals: withSectionFallback(
          () => sectionFromData(buildGoals(workspaceId)),
          "GOALS_LOAD_FAILED",
          "Goals temporarily unavailable",
        ),
        runs: withSectionFallback(
          () => sectionFromData(runsData),
          "RUNS_LOAD_FAILED",
          "Runs temporarily unavailable",
        ),
        apps: withSectionFallback(
          () => {
            const data = buildConnectedApps(workspaceId, contract, summary.google.state);
            const hasAnyConnected = data.some((app) => app.status === "connected");
            if (googleNeedsScope) return sectionFromData(data, { integrationIds: ["google_oauth"], forceState: "needs_scope" });
            if (!hasAnyConnected || googleNeedsAuth) return sectionFromData(data, { integrationIds: ["google_oauth"], forceState: "needs_auth" });
            return sectionFromData(data, { integrationIds: ["google_oauth"] });
          },
          "APPS_LOAD_FAILED",
          "Apps temporarily unavailable",
        ),
        actions: withSectionFallback(
          () => {
            const actions: DashboardSuggestedAction[] = ui.orb_quick_actions
              .map((action) => {
                const tool = contract.tool_registry.find((entry) => entry.tool_name === action.tool_ref);
                return {
                  action_id: action.action_id,
                  app_id: action.app_id,
                  app_name: action.app_name,
                  label: action.label,
                  tool_ref: action.tool_ref,
                  state: action.state,
                  risk_level: tool?.risk_level ?? "read_only",
                  requires_approval: Boolean(tool?.requires_approval ?? action.requires_approval),
                };
              })
              .filter((action) => action.state !== "disabled" && action.state !== "policy_blocked");

            if (actions.length === 0) {
              return sectionFromData(actions);
            }

            const hasReady = actions.some((action) => action.state === "ready");
            if (!hasReady && googleNeedsScope) {
              return sectionFromData(actions, { integrationIds: ["google_oauth"], forceState: "needs_scope" });
            }
            if (!hasReady && googleNeedsAuth) {
              return sectionFromData(actions, { integrationIds: ["google_oauth"], forceState: "needs_auth" });
            }
            return sectionFromData(actions, { integrationIds: ["google_oauth"] });
          },
          "ACTIONS_LOAD_FAILED",
          "Suggested actions temporarily unavailable",
        ),
        upcoming: withSectionFallback(
          () => {
            const data = [
              ...(summary.today.next_event ? [summary.today.next_event] : []),
              ...summary.today.tasks.map((task) => ({
                id: task.id,
                kind: "task" as const,
                title: task.title,
                at: task.due_at ?? new Date().toISOString(),
                source: "google_tasks",
              })),
            ];
            if (googleNeedsScope && data.length === 0) {
              return sectionFromData(data, { integrationIds: ["google_oauth"], forceState: "needs_scope" });
            }
            if (googleNeedsAuth && data.length === 0) {
              return sectionFromData(data, { integrationIds: ["google_oauth"], forceState: "needs_auth" });
            }
            return sectionFromData(data, { integrationIds: ["google_oauth"] });
          },
          "UPCOMING_LOAD_FAILED",
          "Upcoming items temporarily unavailable",
        ),
      };

      const impactedSections = (
        Object.entries(sections) as Array<[keyof DashboardSections, DashboardSection<unknown>]>
      )
        .filter(([, section]) => section.state === "error")
        .map(([key]) => key);

      const dashboard: DashboardPayload = {
        workspace_id: workspaceId,
        generated_at: new Date().toISOString(),
        health: {
          state: impactedSections.length > 0 ? "degraded" : "ok",
          impacted_sections: impactedSections,
        },
        sections,
        summary,
      };

      return dashboard;
    })();

    dashboardInflight.set(cacheKey, buildPromise);
    try {
      const dashboard = await buildPromise;
      dashboardCache.set(cacheKey, { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, payload: dashboard });
      return respond(NextResponse.json({ ok: true, dashboard, _cache: "miss" }), {
        workspaceId,
        cache: "miss",
      });
    } finally {
      dashboardInflight.delete(cacheKey);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/os/dashboard] CRITICAL EXCEPTION:", msg);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", detail: msg }, { status: 500 });
  }
}
