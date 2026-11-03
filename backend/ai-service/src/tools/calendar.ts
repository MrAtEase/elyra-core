import { registerTool } from "./registry.js";
import { getGoogleAccessToken } from "./google-auth.js";
import { logger } from "../lib/logger.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

async function googleFetch(
  accessToken: string,
  path: string,
  options?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return (await res.json()) as Record<string, unknown>;
}

registerTool("calendar.list", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Google Calendar not connected. Please connect your Google account in Settings.", connected: false };
  }

  const timeMin = (input["timeMin"] as string) ?? new Date().toISOString();
  const timeMax = (input["timeMax"] as string) ?? new Date(Date.now() + 7 * 86400_000).toISOString();

  const data = await googleFetch(token, `/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`);

  const items = (data["items"] as Array<Record<string, unknown>>) ?? [];
  const events = items.map((e) => ({
    id: e["id"],
    summary: e["summary"],
    start: (e["start"] as Record<string, unknown>)?.["dateTime"] ?? (e["start"] as Record<string, unknown>)?.["date"],
    end: (e["end"] as Record<string, unknown>)?.["dateTime"] ?? (e["end"] as Record<string, unknown>)?.["date"],
    location: e["location"],
  }));

  logger.debug({ count: events.length }, "calendar.list");
  return { events, text: `Found ${events.length} events` };
});

registerTool("calendar.create", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Google Calendar not connected.", connected: false };
  }

  const body = {
    summary: input["summary"],
    description: input["description"] ?? "",
    start: { dateTime: input["start"] },
    end: { dateTime: input["end"] },
    location: input["location"] ?? undefined,
  };

  const result = await googleFetch(token, "/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { eventId: result["id"], text: `Created event: ${input["summary"]}` };
});
