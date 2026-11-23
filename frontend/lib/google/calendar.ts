import { googleApiFetch } from "@/lib/google/http";

export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string | null;
  primary: boolean;
  selected: boolean;
  timeZone: string | null;
};

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  date: string;
  color?: string;
  category?: string;
  location?: string | null;
  attendees?: string[];
  isVideoCall?: boolean;
  calendarId?: string;
};

type CalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    backgroundColor?: string;
    foregroundColor?: string;
    accessRole?: string;
    primary?: boolean;
    selected?: boolean;
    timeZone?: string;
  }>;
};

type CalendarEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type CalendarEventResponse = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: CalendarEventDateTime;
  end?: CalendarEventDateTime;
  colorId?: string;
  eventType?: string;
  attendees?: Array<{ email?: string }>;
  hangoutLink?: string;
  conferenceData?: Record<string, unknown>;
};

type CalendarEventsResponse = {
  items?: CalendarEventResponse[];
};

function normalizeEventDate(value: CalendarEventDateTime | undefined): string {
  if (!value) return "";
  if (typeof value.dateTime === "string" && value.dateTime.trim()) {
    return value.dateTime;
  }
  if (typeof value.date === "string" && value.date.trim()) {
    return value.date;
  }
  return "";
}

function normalizeDateKey(value: CalendarEventDateTime | undefined): string {
  if (!value) return "";
  if (typeof value.date === "string" && value.date.trim()) return value.date;
  if (typeof value.dateTime === "string" && value.dateTime.trim()) {
    return value.dateTime.slice(0, 10);
  }
  return "";
}

function mapEvent(
  item: CalendarEventResponse,
  calendarId: string
): GoogleCalendarEvent | null {
  if (!item.id) return null;
  const start = normalizeEventDate(item.start);
  const end = normalizeEventDate(item.end);
  const date = normalizeDateKey(item.start);

  const mapped: GoogleCalendarEvent = {
    id: item.id,
    title: item.summary?.trim() || "(Untitled event)",
    start,
    end,
    date,
    location: item.location || null,
    attendees: Array.isArray(item.attendees)
      ? item.attendees
          .map((attendee) => attendee?.email?.trim())
          .filter((email): email is string => Boolean(email))
      : [],
    isVideoCall: Boolean(item.hangoutLink || item.conferenceData),
    calendarId,
  };
  if (item.colorId) {
    mapped.color = item.colorId;
  }
  if (item.eventType) {
    mapped.category = item.eventType;
  }
  return mapped;
}

export async function listGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarListItem[]> {
  const response = await googleApiFetch<CalendarListResponse>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    accessToken
  );
  const items = Array.isArray(response.items) ? response.items : [];

  return items
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.id))
    .map((item) => ({
      id: item.id!,
      summary: item.summary?.trim() || "Untitled",
      backgroundColor: item.backgroundColor ?? null,
      foregroundColor: item.foregroundColor ?? null,
      accessRole: item.accessRole ?? null,
      primary: Boolean(item.primary),
      selected: Boolean(item.selected),
      timeZone: item.timeZone ?? null,
    }));
}

export async function listGoogleCalendarEvents(input: {
  accessToken: string;
  calendarId?: string;
  from: string;
  to: string;
  limit?: number;
}): Promise<GoogleCalendarEvent[]> {
  const calendarId = input.calendarId?.trim() || "primary";
  const maxResults = Math.max(1, Math.min(250, Math.round(input.limit ?? 200)));
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("timeMin", input.from);
  url.searchParams.set("timeMax", input.to);

  const response = await googleApiFetch<CalendarEventsResponse>(
    url,
    input.accessToken
  );
  const items = Array.isArray(response.items) ? response.items : [];

  return items
    .map((item) => mapEvent(item, calendarId))
    .filter((event): event is GoogleCalendarEvent => Boolean(event));
}

export async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
}): Promise<GoogleCalendarEvent> {
  const calendarId = input.calendarId?.trim() || "primary";
  const body = {
    summary: input.title.trim(),
    description: input.description?.trim() || undefined,
    location: input.location?.trim() || undefined,
    start: {
      dateTime: input.start,
    },
    end: {
      dateTime: input.end,
    },
    attendees: (input.attendees ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email })),
  };

  const response = await googleApiFetch<CalendarEventResponse>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`,
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  const mapped = mapEvent(response, calendarId);
  if (!mapped) {
    throw new Error("Google Calendar create event returned invalid payload.");
  }
  return mapped;
}
