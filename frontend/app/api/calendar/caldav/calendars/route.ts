import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

type TokenBridgePayload = {
  present?: boolean;
  host?: string | null;
  username?: string | null;
  password?: string | null;
};

type CaldavCalendarsPayload = {
  ok: true;
  calendars: Array<Record<string, unknown>>;
};

const caldavCalendarsCache = new Map<string, { expiresAt: number; payload: CaldavCalendarsPayload }>();
const caldavCalendarsInflight = new Map<string, Promise<CaldavCalendarsPayload>>();
const CALDAV_CALENDARS_CACHE_TTL_MS = 300_000;

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

  try {
    const cached = caldavCalendarsCache.get(workspaceId);
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
      caldavCalendarsInflight.get(workspaceId) ??
      (async () => {
        // Email I/O currently exposes CalDAV events and not a dedicated calendar list.
        // Return a deterministic synthetic primary calendar so the UI can render.
        await requestEmailIo("/caldav/events", {
          method: "POST",
          body: {
            workspaceId,
            userId,
            provider: "icloud_caldav",
            calendarId: "primary",
            credentials: {
              serverUrl: credentials.serverUrl,
              username: credentials.username,
              appPassword: credentials.appPassword,
            },
          },
          context: { provider: "icloud_caldav", reason: "calendar/caldav/calendars" },
          request,
        });

        const payload: CaldavCalendarsPayload = {
          ok: true,
          calendars: [
            {
              id: "primary",
              summary: "iCloud",
              backgroundColor: null,
              foregroundColor: null,
              accessRole: "owner",
              primary: true,
              selected: true,
              timeZone: null,
            },
          ],
        };
        caldavCalendarsCache.set(workspaceId, {
          expiresAt: Date.now() + CALDAV_CALENDARS_CACHE_TTL_MS,
          payload,
        });
        caldavCalendarsInflight.delete(workspaceId);
        return payload;
      })().catch((error) => {
        caldavCalendarsInflight.delete(workspaceId);
        throw error;
      });

    if (!caldavCalendarsInflight.has(workspaceId)) {
      caldavCalendarsInflight.set(workspaceId, pending);
    }

    return NextResponse.json(await pending);
  } catch (error: unknown) {
    return handleEmailIoApiError({
      route: "calendar/caldav/calendars",
      workspaceId,
      error,
    });
  }
}
