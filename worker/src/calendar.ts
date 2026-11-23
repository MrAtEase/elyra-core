const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export async function listUpcoming(accessToken: string) {
  const timeMin = new Date().toISOString();
  const url = new URL(`${CAL_BASE}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
