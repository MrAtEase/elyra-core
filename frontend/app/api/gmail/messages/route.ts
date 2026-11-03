import { NextRequest, NextResponse } from "next/server";
import { GoogleConfigError } from "@/lib/google/env";
import { GoogleApiError } from "@/lib/google/http";
import { listGmailMessages } from "@/lib/google/gmail";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { GOOGLE_GMAIL_READONLY_SCOPE } from "@/lib/google/scopes";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

export const runtime = "nodejs";
const GMAIL_ROUTE_TIMEOUT_MS = 10_000;
const GMAIL_CACHE_TTL_MS = 60_000;

type GmailMessagesPayload = {
  ok: true;
  workspaceId: string;
  messages: unknown[];
};

const gmailResponseCache = new Map<string, { expiresAt: number; payload: GmailMessagesPayload }>();
const gmailInflight = new Map<string, Promise<GmailMessagesPayload>>();

class RouteResponseError extends Error {
  constructor(public readonly response: NextResponse) {
    super("route_response");
    this.name = "RouteResponseError";
  }
}

class GmailRouteTimeoutError extends Error {
  constructor() {
    super(`Gmail request timed out after ${GMAIL_ROUTE_TIMEOUT_MS}ms`);
    this.name = "GmailRouteTimeoutError";
  }
}

async function withGmailRouteTimeout<T>(task: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new GmailRouteTimeoutError()), GMAIL_ROUTE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function gmailCacheKey(workspaceId: string, q: string | undefined, limit: number | null) {
  return `${workspaceId}::${q ?? ""}::${limit ?? ""}`;
}

export async function GET(request: NextRequest) {
  const timing = createServerTimingTrace("api/gmail/messages");
  const respond = (response: NextResponse, meta?: Record<string, unknown>) => {
    timing.log(meta);
    return timing.apply(response) as NextResponse;
  };

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
      { error: auth.message, loginUrl: auth.loginUrl ?? "/signin" },
      { status: auth.status }
    ));
  }

  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limitCandidate = limitRaw ? Number(limitRaw) : null;
  const parsedLimit =
    typeof limitCandidate === "number" && Number.isFinite(limitCandidate)
      ? limitCandidate
      : null;

  try {
    const key = gmailCacheKey(auth.context.workspaceId, q, parsedLimit);
    const cached = gmailResponseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      timing.mark("cache", "hit");
      return respond(NextResponse.json(cached.payload), {
        workspaceId: auth.context.workspaceId,
        cache: "hit",
      });
    }

    const pending =
      gmailInflight.get(key) ??
      (async () => {
        const credentials = await timing.measure(
          "credentials",
          withGmailRouteTimeout(
            resolveCredentials({
              provider: "google",
              workspaceId: auth.context.workspaceId,
              userId: auth.context.userId,
              requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE],
            })
          ),
          "google credentials"
        );
        if (!credentials.ok) {
          throw new RouteResponseError(
            NextResponse.json(
              { error: credentials.message, code: credentials.code, missingScopes: credentials.missingScopes },
              { status: credentials.status }
            )
          );
        }

        const messages = await timing.measure(
          "gmail_api",
          withGmailRouteTimeout(
            listGmailMessages({
              accessToken: credentials.accessToken,
              ...(q ? { q } : {}),
              ...(parsedLimit !== null ? { limit: parsedLimit } : {}),
            })
          ),
          "gmail list"
        );

        const payload: GmailMessagesPayload = {
          ok: true,
          workspaceId: auth.context.workspaceId,
          messages,
        };
        gmailResponseCache.set(key, {
          expiresAt: Date.now() + GMAIL_CACHE_TTL_MS,
          payload,
        });
        gmailInflight.delete(key);
        return payload;
      })().catch((error) => {
        gmailInflight.delete(key);
        throw error;
      });

    if (!gmailInflight.has(key)) {
      gmailInflight.set(key, pending);
    }

    return respond(NextResponse.json(await pending), {
      workspaceId: auth.context.workspaceId,
      cache: "miss",
    });
  } catch (error) {
    if (error instanceof RouteResponseError) {
      return respond(error.response, { workspaceId: auth.context.workspaceId, mode: "route_error" });
    }
    if (error instanceof GmailRouteTimeoutError) {
      return respond(NextResponse.json(
        { error: error.message, code: "timeout" },
        { status: 504 }
      ), { workspaceId: auth.context.workspaceId, mode: "timeout" });
    }
    if (error instanceof GoogleApiError) {
      return respond(NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      ), { workspaceId: auth.context.workspaceId, mode: "google_api_error" });
    }
    if (error instanceof GoogleConfigError) {
      return respond(NextResponse.json(
        { error: error.issues.join(" | "), code: "config_error" },
        { status: 500 }
      ), { workspaceId: auth.context.workspaceId, mode: "config_error" });
    }
    return respond(NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Gmail messages.",
      },
      { status: 500 }
    ), { workspaceId: auth.context.workspaceId, mode: "unexpected_error" });
  }
}
