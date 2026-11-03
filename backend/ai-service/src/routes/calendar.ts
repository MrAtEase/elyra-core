import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { AuthError, ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getGoogleAccessToken } from "../tools/google-auth.js";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

type CalendarEvent = {
  id?: string;
  summary?: string;
  colorId?: string;
  eventType?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string }> };
};

type CalendarListResponse = {
  items?: CalendarEvent[];
};

class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const querySchema = z.object({
  workspaceId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function normalizeWorkspaceId(
  request: AuthenticatedRequest,
  workspaceIdFromQuery: string | undefined,
): string {
  const workspaceId = workspaceIdFromQuery?.trim() || request.workspaceId?.trim();
  if (!workspaceId) {
    throw new ValidationError("workspaceId is required");
  }
  return workspaceId;
}

async function resolveWorkspaceOrThrow(
  request: AuthenticatedRequest,
  requestedWorkspaceId: string,
): Promise<string> {
  const workspaceId = await resolveAuthorizedWorkspaceId(
    request.userId,
    requestedWorkspaceId,
  );
  if (!workspaceId) {
    throw new AuthError("No access to requested workspace");
  }
  return workspaceId;
}

async function calendarRequest<TResponse>(
  accessToken: string,
  path: string,
): Promise<TResponse> {
  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  const googleErrorMessage = (() => {
    if (!payload || typeof payload !== "object") return null;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object") return null;
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  })();

  if (!response.ok) {
    const message = googleErrorMessage ?? `Google API request failed (${response.status})`;
    throw new GoogleApiError(response.status, message, payload);
  }

  return payload as TResponse;
}

function toIso(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString();
}

function isVideoCall(event: CalendarEvent): boolean {
  if (typeof event.hangoutLink === "string" && event.hangoutLink.length > 0) return true;
  const entries = event.conferenceData?.entryPoints ?? [];
  return entries.some((entry) => entry.entryPointType === "video");
}

function mapEvent(event: CalendarEvent) {
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date ?? "";
  const startIso = toIso(start);
  const endIso = toIso(end);
  const dateValue = startIso || start;

  const attendees = (event.attendees ?? [])
    .map((attendee) => attendee.email)
    .filter((email): email is string => typeof email === "string" && email.length > 0);

  return {
    id: event.id ?? "",
    title: event.summary?.trim() || "(Untitled event)",
    start: startIso || start,
    end: endIso || end,
    date: dateValue ? dateValue.slice(0, 10) : "",
    color: event.colorId ?? "",
    category: event.eventType ?? event.colorId ?? "default",
    location: event.location ?? null,
    attendees,
    isVideoCall: isVideoCall(event),
  };
}

function sendNotConnected(reply: FastifyReply) {
  return reply.status(409).send({
    error: "not_connected",
    message: "Google workspace is not connected",
  });
}

function handleGoogleApiError(reply: FastifyReply, error: unknown): void {
  if (error instanceof GoogleApiError) {
    if (error.status === 401 || error.status === 403) {
      sendNotConnected(reply);
      return;
    }
    throw new ValidationError(error.message);
  }
  throw error;
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  monday.setHours(0, 0, 0, 0);

  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);

  return {
    from: monday.toISOString(),
    to: nextMonday.toISOString(),
  };
}

export async function calendarRoutes(app: FastifyInstance) {
  app.get("/v1/calendar/events", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const authRequest = request as AuthenticatedRequest;
    const requestedWorkspaceId = normalizeWorkspaceId(
      authRequest,
      parsed.data.workspaceId,
    );
    const workspaceId = await resolveWorkspaceOrThrow(authRequest, requestedWorkspaceId);

    const accessToken = await getGoogleAccessToken(workspaceId);
    if (!accessToken) {
      return sendNotConnected(reply);
    }

    const fallbackRange = defaultDateRange();
    const from = parsed.data.from ?? fallbackRange.from;
    const to = parsed.data.to ?? fallbackRange.to;

    try {
      const data = await calendarRequest<CalendarListResponse>(
        accessToken,
        `/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(
          from,
        )}&timeMax=${encodeURIComponent(to)}&maxResults=100`,
      );
      const events = (data.items ?? []).map(mapEvent);
      return reply.send({ events });
    } catch (error) {
      logger.warn({ err: error, workspaceId }, "Calendar list request failed");
      handleGoogleApiError(reply, error);
      return undefined;
    }
  });
}
