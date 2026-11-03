import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

type CaldavWorkerEvent = {
  href?: string;
  etag?: string;
  data?: string;
};

type TokenBridgePayload = {
  present?: boolean;
  host?: string | null;
  username?: string | null;
  password?: string | null;
};

type CaldavEventsPayload = {
  ok: true;
  events: Array<Record<string, unknown>>;
};

const caldavEventsCache = new Map<string, { expiresAt: number; payload: CaldavEventsPayload }>();
const caldavEventsInflight = new Map<string, Promise<CaldavEventsPayload>>();
const CALDAV_EVENTS_CACHE_TTL_MS = 60_000;

function readIcsField(ics: string, key: string): string | null {
  const pattern = new RegExp(`(?:^|\\n)${key}(?:;[^\\n:]*)?:(.+)(?:\\n|$)`, "i");
  const match = ics.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function parseIcsDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return new Date(Date.UTC(year, month, day)).toISOString();
  }
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return new Date(year, month, day, hour, minute, second).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function mapWorkerEvent(event: CaldavWorkerEvent) {
  const ics = typeof event.data === "string" ? event.data : "";
  const uid = readIcsField(ics, "UID");
  const summary = readIcsField(ics, "SUMMARY");
  const location = readIcsField(ics, "LOCATION");
  const start = parseIcsDate(readIcsField(ics, "DTSTART"));
  const end = parseIcsDate(readIcsField(ics, "DTEND"));
  const id = uid || event.href || event.etag || `caldav-${Math.random().toString(36).slice(2, 10)}`;

  if (!start) return null;

  return {
    id,
    title: summary || "Event",
    start,
    end: end || start,
    date: start.slice(0, 10),
    color: undefined,
    category: "calendar",
    location,
    attendees: [],
    isVideoCall: false,
    calendarId: "primary",
  };
}

function resolveInternalSecret() {
  return (
    process.env.ELYRA_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.INTERNAL_API_KEY ||
    ""
  ).trim();
}

function normalizeServerUrl(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function loadCaldavCredentials(request: NextRequest, workspaceId: string) {
  const secret = resolveInternalSecret();
  if (!secret) {
    throw new Error("Calendar token bridge is not configured.");
  }

  const tokenUrl = new URL(
    `/api/internal/workspaces/${encodeURIComponent(workspaceId)}/integrations/icloud_caldav/token`,
    request.nextUrl.origin
  );
  const response = await fetch(tokenUrl, {
    headers: {
      "x-elyra-internal-secret": secret,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as TokenBridgePayload | null;
  const serverUrl = normalizeServerUrl(payload?.host);
  if (!response.ok || !payload?.present || !payload?.username || !payload?.password || !serverUrl) {
    return null;
  }
  return {
    serverUrl,
    username: payload.username,
    appPassword: payload.password,
  };
}

export async function GET(request: NextRequest) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  const resolvedWorkspace = getWorkspaceId(request, true);
  if (!resolvedWorkspace.ok) {
    return NextResponse.json(
      { error: resolvedWorkspace.error, reason: resolvedWorkspace.reason, hint: resolvedWorkspace.hint },
      { status: resolvedWorkspace.status }
    );
  }
  if (!resolvedWorkspace.workspaceId) {
    return NextResponse.json({ error: "workspaceId_required" }, { status: 400 });
  }
  const workspaceId = resolvedWorkspace.workspaceId;

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }

  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }

  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";
  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  const to = request.nextUrl.searchParams.get("to") ?? undefined;
  const cacheKey = `${workspaceId}::${calendarId}::${from ?? ""}::${to ?? ""}`;

  try {
    const cached = caldavEventsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }

    const credentials = await loadCaldavCredentials(request, workspaceId);
    if (!credentials) {
      return NextResponse.json({
        ok: false,
        error: "caldav_credentials_missing",
        message: "CalDAV is not connected for this workspace.",
      }, { status: 409 });
    }

    const pending =
      caldavEventsInflight.get(cacheKey) ??
      (async () => {
        const data = await requestEmailIo("/caldav/events", {
          method: "POST",
          body: {
            workspaceId,
            userId,
            provider: "icloud_caldav",
            calendarId,
            from,
            to,
            credentials: {
              serverUrl: credentials.serverUrl,
              username: credentials.username,
              appPassword: credentials.appPassword,
            },
          },
          context: { provider: "icloud_caldav", reason: "calendar/caldav/events" },
          request,
        });

        const rawEvents = Array.isArray(data) ? (data as unknown[]) : [];
        const events = rawEvents
          .filter((entry): entry is CaldavWorkerEvent => Boolean(entry && typeof entry === "object"))
          .map(mapWorkerEvent)
          .filter((entry): entry is NonNullable<ReturnType<typeof mapWorkerEvent>> => Boolean(entry));

        const payload: CaldavEventsPayload = { ok: true, events };
        caldavEventsCache.set(cacheKey, {
          expiresAt: Date.now() + CALDAV_EVENTS_CACHE_TTL_MS,
          payload,
        });
        caldavEventsInflight.delete(cacheKey);
        return payload;
      })().catch((error) => {
        caldavEventsInflight.delete(cacheKey);
        throw error;
      });

    if (!caldavEventsInflight.has(cacheKey)) {
      caldavEventsInflight.set(cacheKey, pending);
    }

    return NextResponse.json(await pending);
  } catch (error: unknown) {
    return handleEmailIoApiError({
      route: "calendar/caldav/events",
      workspaceId,
      error,
    });
  }
}
