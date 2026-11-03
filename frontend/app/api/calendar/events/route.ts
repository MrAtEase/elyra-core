import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GoogleConfigError } from "@/lib/google/env";
import { GoogleApiError } from "@/lib/google/http";
import {
  createGoogleCalendarEvent,
  listGoogleCalendarEvents,
} from "@/lib/google/calendar";
import { getGoogleAuthContext } from "@/lib/google/auth";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
} from "@/lib/google/scopes";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

export const runtime = "nodejs";
const CALENDAR_EVENTS_CACHE_TTL_MS = 60_000;

type CalendarEventsPayload = {
  ok: true;
  workspaceId: string;
  events: unknown[];
};

const calendarEventsCache = new Map<string, { expiresAt: number; payload: CalendarEventsPayload }>();
const calendarEventsInflight = new Map<string, Promise<CalendarEventsPayload>>();

const CreateEventSchema = z.object({
  workspaceId: z.string().trim().optional(),
  calendarId: z.string().trim().optional(),
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  start: z.string().trim().min(1, "start is required"),
  end: z.string().trim().min(1, "end is required"),
  attendees: z.array(z.string().trim().email()).optional(),
});

function handleFailure(error: unknown): NextResponse {
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
        error instanceof Error ? error.message : "Unable to process calendar request.",
    },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  const timing = createServerTimingTrace("api/calendar/events");
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

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const calendarId =
    request.nextUrl.searchParams.get("calendarId") ?? undefined;

  if (!from || !to) {
    return respond(NextResponse.json(
      { error: "from and to query params are required." },
      { status: 400 }
    ));
  }

  try {
    const key = `${auth.context.workspaceId}::${calendarId ?? ""}::${from}::${to}`;
    const cached = calendarEventsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      timing.mark("cache", "hit");
      return respond(NextResponse.json(cached.payload), {
        workspaceId: auth.context.workspaceId,
        cache: "hit",
      });
    }

    const pending =
      calendarEventsInflight.get(key) ??
      (async () => {
        const credentials = await timing.measure(
          "credentials",
          resolveCredentials({
            provider: "google",
            workspaceId: auth.context.workspaceId,
            userId: auth.context.userId,
            requiredScopes: [GOOGLE_CALENDAR_READONLY_SCOPE],
          }),
          "google credentials"
        );
        if (!credentials.ok) {
          throw new Error(JSON.stringify({
            __calendarRoute: true,
            error: credentials.message,
            code: credentials.code,
            missingScopes: credentials.missingScopes,
            status: credentials.status,
          }));
        }

        const events = await timing.measure(
          "calendar_api",
          listGoogleCalendarEvents({
            accessToken: credentials.accessToken,
            ...(calendarId ? { calendarId } : {}),
            from,
            to,
          }),
          "google calendar list"
        );

        const payload: CalendarEventsPayload = {
          ok: true,
          workspaceId: auth.context.workspaceId,
          events,
        };
        calendarEventsCache.set(key, {
          expiresAt: Date.now() + CALENDAR_EVENTS_CACHE_TTL_MS,
          payload,
        });
        calendarEventsInflight.delete(key);
        return payload;
      })().catch((error) => {
        calendarEventsInflight.delete(key);
        throw error;
      });

    if (!calendarEventsInflight.has(key)) {
      calendarEventsInflight.set(key, pending);
    }

    return respond(NextResponse.json(await pending), {
      workspaceId: auth.context.workspaceId,
      cache: "miss",
    });
  } catch (error) {
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message) as {
          __calendarRoute?: boolean;
          error?: string;
          code?: string;
          missingScopes?: string[];
          status?: number;
        };
        if (parsed.__calendarRoute) {
          return respond(NextResponse.json(
            { error: parsed.error, code: parsed.code, missingScopes: parsed.missingScopes ?? [] },
            { status: parsed.status ?? 500 }
          ), { workspaceId: auth.context.workspaceId, mode: "route_error" });
        }
      } catch {
        // ignore
      }
    }
    return respond(handleFailure(error), { workspaceId: auth.context.workspaceId, mode: "failure" });
  }
}

export async function POST(request: NextRequest) {
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

  const body = await request.json().catch(() => null);
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((issue) => issue.message)
          .join(" | "),
      },
      { status: 400 }
    );
  }

  try {
    const credentials = await resolveCredentials({
      provider: "google",
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId,
      requiredScopes: [GOOGLE_CALENDAR_EVENTS_SCOPE],
    });
    if (!credentials.ok) {
      return NextResponse.json(
        { error: credentials.message, code: credentials.code, missingScopes: credentials.missingScopes },
        { status: credentials.status }
      );
    }

    const event = await createGoogleCalendarEvent({
      accessToken: credentials.accessToken,
      ...(parsed.data.calendarId ? { calendarId: parsed.data.calendarId } : {}),
      title: parsed.data.title,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      ...(parsed.data.location ? { location: parsed.data.location } : {}),
      start: parsed.data.start,
      end: parsed.data.end,
      ...(parsed.data.attendees ? { attendees: parsed.data.attendees } : {}),
    });

    return NextResponse.json({
      ok: true,
      workspaceId: auth.context.workspaceId,
      event,
    });
  } catch (error) {
    return handleFailure(error);
  }
}
