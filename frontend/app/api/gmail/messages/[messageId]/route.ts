import { NextRequest, NextResponse } from "next/server";
import { GoogleConfigError } from "@/lib/google/env";
import { GoogleApiError } from "@/lib/google/http";
import { getGmailMessageDetail } from "@/lib/google/gmail";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { GOOGLE_GMAIL_READONLY_SCOPE } from "@/lib/google/scopes";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";

export const runtime = "nodejs";
const GMAIL_ROUTE_TIMEOUT_MS = 10_000;
const GMAIL_DETAIL_CACHE_TTL_MS = 60_000;

type GmailMessageDetailPayload = {
  ok: true;
  workspaceId: string;
  message: unknown;
};

const gmailDetailCache = new Map<string, { expiresAt: number; payload: GmailMessageDetailPayload }>();
const gmailDetailInflight = new Map<string, Promise<GmailMessageDetailPayload>>();

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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await context.params;
  const resolved = getWorkspaceId(request, false);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
      { status: resolved.status }
    );
  }
  const requestedWorkspaceId = resolved.workspaceId;
  const auth = await getGoogleAuthContext(request, requestedWorkspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, loginUrl: auth.loginUrl ?? "/signin" },
      { status: auth.status }
    );
  }

  if (!messageId?.trim()) {
    return NextResponse.json(
      { error: "messageId is required." },
      { status: 400 }
    );
  }

  try {
    const key = `${auth.context.workspaceId}::${messageId}`;
    const cached = gmailDetailCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }

    const pending =
      gmailDetailInflight.get(key) ??
      (async () => {
        const credentials = await withGmailRouteTimeout(
          resolveCredentials({
            provider: "google",
            workspaceId: auth.context.workspaceId,
            userId: auth.context.userId,
            requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE],
          })
        );
        if (!credentials.ok) {
          throw new RouteResponseError(
            NextResponse.json(
              { error: credentials.message, code: credentials.code, missingScopes: credentials.missingScopes },
              { status: credentials.status }
            )
          );
        }

        const message = await withGmailRouteTimeout(
          getGmailMessageDetail({
            accessToken: credentials.accessToken,
            messageId,
          })
        );

        const payload: GmailMessageDetailPayload = {
          ok: true,
          workspaceId: auth.context.workspaceId,
          message,
        };
        gmailDetailCache.set(key, {
          expiresAt: Date.now() + GMAIL_DETAIL_CACHE_TTL_MS,
          payload,
        });
        gmailDetailInflight.delete(key);
        return payload;
      })().catch((error) => {
        gmailDetailInflight.delete(key);
        throw error;
      });

    if (!gmailDetailInflight.has(key)) {
      gmailDetailInflight.set(key, pending);
    }

    return NextResponse.json(await pending);
  } catch (error) {
    if (error instanceof RouteResponseError) {
      return error.response;
    }
    if (error instanceof GmailRouteTimeoutError) {
      return NextResponse.json(
        { error: error.message, code: "timeout" },
        { status: 504 }
      );
    }
    if (error instanceof GoogleApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof GoogleConfigError) {
      return NextResponse.json(
        { error: error.issues.join(" | "), code: "config_error" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Gmail message detail.",
      },
      { status: 500 }
    );
  }
}
