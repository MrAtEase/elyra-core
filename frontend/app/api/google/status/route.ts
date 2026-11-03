import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { getGoogleServerEnvSafe } from "@/lib/google/env";
import { loadStoredGoogleTokens } from "@/lib/google/tokenStore";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_TASKS_READONLY_SCOPE,
  hasRequiredScopes,
} from "@/lib/google/scopes";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

export const runtime = "nodejs";
const GOOGLE_STATUS_CACHE_TTL_MS = 60_000;

type GoogleStatusPayload = {
  ok: boolean;
  user?: {
    id: string;
    email: string | null;
    avatarUrl: string | null;
    initials: string;
  };
  workspace?: {
    id: string;
    name: string;
    slug: string;
  };
  google?: {
    connected: boolean;
    scopes: string[];
    hasGmailRead: boolean;
    hasCalendarRead: boolean;
    hasCalendarWrite: boolean;
    connectionState: "connected" | "needs_scope" | "needs_auth" | "error";
    missingRequiredScopes: string[];
    config: { ready: boolean; issues: string[] };
    error: string | null;
  };
  error?: string;
  loginUrl?: string;
};

const googleStatusCache = new Map<string, { expiresAt: number; payload: GoogleStatusPayload; status: number }>();

function deriveInitials(email: string | null): string {
  if (!email) return "EC";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase() || "EC";
  }
  return local.slice(0, 2).toUpperCase() || "EC";
}

export async function GET(request: NextRequest) {
  const timing = createServerTimingTrace("api/google/status");
  const respond = (response: NextResponse, meta?: Record<string, unknown>) => {
    timing.log(meta);
    return timing.apply(response) as NextResponse;
  };

  try {
    const resolved = getWorkspaceId(request, false);
    if (!resolved.ok) {
      return respond(NextResponse.json(
        { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
        { status: resolved.status }
      ));
    }
    const requestedWorkspaceId = resolved.workspaceId;
    const auth = await timing.measure(
      "auth",
      getGoogleAuthContext(request, requestedWorkspaceId),
      "whoami + workspace"
    );

    if (!auth.ok) {
      return respond(NextResponse.json(
        {
          ok: false,
          error: auth.message,
          loginUrl: auth.loginUrl ?? "/signin",
        },
        { status: auth.status }
      ));
    }

    const workspace =
      auth.context.workspaces.find(
        (item) => item.id === auth.context.workspaceId
      ) ?? auth.context.whoami.activeWorkspace;
    const shouldRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const cacheKey = `${auth.context.workspaceId}::${auth.context.userId}`;
    if (!shouldRefresh) {
      const cached = googleStatusCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        timing.mark("cache", "hit");
        return respond(NextResponse.json(cached.payload, { status: cached.status }), {
          workspaceId: auth.context.workspaceId,
          cache: "hit",
        });
      }
    }

    const envStatus = getGoogleServerEnvSafe();
    let connectionError: string | null = null;
    let scopes: string[] = [];
    let connected = false;

    if (envStatus.ok) {
      try {
        if (shouldRefresh) {
          await timing.measure(
            "refresh",
            resolveCredentials({
              provider: "google",
              workspaceId: auth.context.workspaceId,
              userId: auth.context.userId,
              requiredScopes: [],
            }),
            "forced credential refresh"
          );
        }
        const stored = await timing.measure(
          "tokens",
          loadStoredGoogleTokens(auth.context.workspaceId, auth.context.userId),
          "token store"
        );
        scopes = stored?.scopes ?? [];
        connected = Boolean(stored?.refreshToken || stored?.accessToken);
      } catch (error) {
        connectionError =
          error instanceof Error
            ? error.message
            : "Unable to load Google connection state.";
      }
    }

    const gmailRead = hasRequiredScopes(scopes, [GOOGLE_GMAIL_READONLY_SCOPE]).ok;
    const calendarRead = hasRequiredScopes(scopes, [GOOGLE_CALENDAR_READONLY_SCOPE]).ok;
    const calendarWrite = hasRequiredScopes(scopes, [GOOGLE_CALENDAR_EVENTS_SCOPE]).ok;
    const requiredScopes = [GOOGLE_GMAIL_READONLY_SCOPE, GOOGLE_CALENDAR_READONLY_SCOPE, GOOGLE_TASKS_READONLY_SCOPE];
    const missingRequiredScopes =
      connected
        ? requiredScopes.filter((scope) => !hasRequiredScopes(scopes, [scope]).ok)
        : [];
    const connectionState =
      !envStatus.ok
        ? "error"
        : connectionError && shouldRefresh
          ? "error"
          : !connected
            ? "needs_auth"
            : missingRequiredScopes.length > 0
              ? "needs_scope"
              : "connected";
    const payload: GoogleStatusPayload = {
      ok: true,
      user: {
        id: auth.context.userId,
        email: auth.context.email,
        avatarUrl:
          ((auth.context.whoami.user as Record<string, unknown> | undefined)
            ?.avatar_url as string | undefined) ?? null,
        initials: deriveInitials(auth.context.email),
      },
      workspace: {
        id: auth.context.workspaceId,
        name: workspace?.name ?? "elyra-core workspace",
        slug: workspace?.slug ?? "active",
      },
      google: {
        connected,
        scopes,
        hasGmailRead: gmailRead,
        hasCalendarRead: calendarRead,
        hasCalendarWrite: calendarWrite,
        connectionState,
        missingRequiredScopes,
        config: envStatus.ok
          ? { ready: true, issues: [] as string[] }
          : { ready: false, issues: envStatus.error.issues },
        error: connectionError,
      },
    };
    googleStatusCache.set(cacheKey, {
      expiresAt: Date.now() + GOOGLE_STATUS_CACHE_TTL_MS,
      payload,
      status: 200,
    });
    return respond(NextResponse.json(payload), {
      workspaceId: auth.context.workspaceId,
      cache: "miss",
      forcedRefresh: shouldRefresh,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error while loading Google status.";
    console.error("[api/google/status] failed", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return respond(NextResponse.json(
      {
        ok: false,
        error: message,
      } satisfies GoogleStatusPayload,
      { status: 503 }
    ));
  }
}
