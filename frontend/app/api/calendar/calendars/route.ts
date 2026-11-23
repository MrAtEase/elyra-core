import { NextRequest, NextResponse } from "next/server";
import { GoogleConfigError } from "@/lib/google/env";
import { GoogleApiError } from "@/lib/google/http";
import { listGoogleCalendars } from "@/lib/google/calendar";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { GOOGLE_CALENDAR_READONLY_SCOPE } from "@/lib/google/scopes";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";

export const runtime = "nodejs";
const CALENDAR_LIST_CACHE_TTL_MS = 300_000;

type CalendarListPayload = {
  ok: true;
  workspaceId: string;
  calendars: unknown[];
};

const calendarListCache = new Map<string, { expiresAt: number; payload: CalendarListPayload }>();
const calendarListInflight = new Map<string, Promise<CalendarListPayload>>();

export async function GET(request: NextRequest) {
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

  try {
    const key = auth.context.workspaceId;
    const cached = calendarListCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }

    const pending =
      calendarListInflight.get(key) ??
      (async () => {
        const credentials = await resolveCredentials({
          provider: "google",
          workspaceId: auth.context.workspaceId,
          userId: auth.context.userId,
          requiredScopes: [GOOGLE_CALENDAR_READONLY_SCOPE],
        });
        if (!credentials.ok) {
          throw new Error(JSON.stringify({
            __calendarListRoute: true,
            error: credentials.message,
            code: credentials.code,
            missingScopes: credentials.missingScopes,
            status: credentials.status,
          }));
        }

        const calendars = await listGoogleCalendars(credentials.accessToken);
        const payload: CalendarListPayload = {
          ok: true,
          workspaceId: auth.context.workspaceId,
          calendars,
        };
        calendarListCache.set(key, {
          expiresAt: Date.now() + CALENDAR_LIST_CACHE_TTL_MS,
          payload,
        });
        calendarListInflight.delete(key);
        return payload;
      })().catch((error) => {
        calendarListInflight.delete(key);
        throw error;
      });

    if (!calendarListInflight.has(key)) {
      calendarListInflight.set(key, pending);
    }

    return NextResponse.json(await pending);
  } catch (error) {
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message) as {
          __calendarListRoute?: boolean;
          error?: string;
          code?: string;
          missingScopes?: string[];
          status?: number;
        };
        if (parsed.__calendarListRoute) {
          return NextResponse.json(
            { error: parsed.error, code: parsed.code, missingScopes: parsed.missingScopes ?? [] },
            { status: parsed.status ?? 500 }
          );
        }
      } catch {
        // ignore
      }
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
            : "Unable to load Google calendars.",
      },
      { status: 500 }
    );
  }
}
