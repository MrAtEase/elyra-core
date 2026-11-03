"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import {
  AiServiceError,
  createCalendarEvent,
  fetchCalendarCalendars,
  fetchCalendarEvents,
  fetchIcloudCalendarCalendars,
  fetchIcloudCalendarEvents,
  fetchWorkspaceIntegrationState,
  startGoogleConnect,
  type CalendarEventRecord,
  type CalendarListRecord,
  type WorkspaceIntegrationState,
} from "@/components/os/apps/liveGoogleClient";

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type NewEventDraft = {
  title: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
};

type PositionedEvent = CalendarEventRecord & {
  top: number;
  height: number;
  dayKey: string;
};

type CalendarFilter = "all" | "meeting" | "focus" | "other";

type CalendarSnapshot = {
  status: WorkspaceIntegrationState;
  calendars: CalendarListRecord[];
  selectedCalendarIds: string[];
  events: CalendarEventRecord[];
  selectedEventId: string | null;
  weekStartIso: string;
  savedAt: number;
};

function startOfWeekMonday(input: Date): Date {
  const date = new Date(input);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(input: Date, days: number): Date {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function toDayKey(input: Date): string {
  const year = input.getFullYear();
  const month = `${input.getMonth() + 1}`.padStart(2, "0");
  const day = `${input.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof AiServiceError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function toDate(value: string): Date | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function formatHourLabel(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: true,
  }).format(date);
}

function formatWeekHeadline(weekStart: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(weekStart);
}

function formatEventTime(event: CalendarEventRecord): string {
  const start = toDate(event.start || event.date);
  const end = toDate(event.end || event.start || event.date);
  if (!start || !end) return "Time TBD";

  if (event.start.length <= 10) {
    return "All day";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function detectCalendarFilter(event: CalendarEventRecord): CalendarFilter {
  const title = event.title.toLowerCase();
  if (
    event.attendees?.length ||
    event.isVideoCall ||
    /meet|sync|call|review|standup|demo/.test(title)
  ) {
    return "meeting";
  }
  if (/focus|deep work|strategy|writing|research|block/.test(title)) {
    return "focus";
  }
  return "other";
}

function eventAccent(event: CalendarEventRecord): string {
  return event.color || "#7c8cff";
}

function eventLayout(event: CalendarEventRecord): PositionedEvent {
  const start = toDate(event.start || event.date);
  const end = toDate(event.end || event.start || event.date);

  if (!start || !end || event.start.length <= 10) {
    const fallbackKey =
      event.date ||
      (event.start && event.start.length >= 10 ? event.start.slice(0, 10) : "");
    return {
      ...event,
      top: 6,
      height: 40,
      dayKey: fallbackKey,
    };
  }

  const durationHours = Math.max(
    0.5,
    (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  );
  const top = (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT;
  return {
    ...event,
    top,
    height: durationHours * HOUR_HEIGHT,
    dayKey: toDayKey(start),
  };
}

function monthGrid(anchor: Date): Array<{ key: string; label: number; date: Date; inMonth: boolean }> {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const firstWeekDay = (first.getDay() + 6) % 7;
  const start = addDays(first, -firstWeekDay);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return {
      key: toDayKey(date),
      label: date.getDate(),
      date,
      inMonth: date.getMonth() === anchor.getMonth(),
    };
  });
}

function calendarSnapshotKey(workspaceId: string) {
  return `elyra:calendar:snapshot:${workspaceId}`;
}

function loadCalendarSnapshot(workspaceId: string): CalendarSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(calendarSnapshotKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalendarSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCalendarSnapshot(workspaceId: string, snapshot: CalendarSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(calendarSnapshotKey(workspaceId), JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export default function CalendarApp() {
  const { activeWorkspace } = useKernel();
  const [status, setStatus] = useState<WorkspaceIntegrationState | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [calendars, setCalendars] = useState<CalendarListRecord[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [activeFilter, setActiveFilter] = useState<CalendarFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [eventDraft, setEventDraft] = useState<NewEventDraft>(() => {
    const now = new Date();
    const today = toDayKey(now);
    const nextHour = `${String((now.getHours() + 1) % 24).padStart(2, "0")}:00`;
    const plusTwo = `${String((now.getHours() + 2) % 24).padStart(2, "0")}:00`;
    return {
      title: "",
      description: "",
      location: "",
      date: today,
      startTime: nextHour,
      endTime: plusTwo,
    };
  });

  const workspaceId = status?.workspaceId ?? activeWorkspace.id;
  const workspaceSnapshotId = activeWorkspace.id;
  const googleState = status?.google;
  const calendarProvider = status?.calendarProvider ?? null;
  const canReadCalendar = Boolean(workspaceId && calendarProvider);
  const canWriteCalendar = Boolean(
    calendarProvider === "google" && googleState?.hasCalendarWrite
  );

  const weekDays = useMemo(
    () =>
      DAY_LABELS.map((label, index) => {
        const date = addDays(weekStart, index);
        return {
          label,
          date,
          key: toDayKey(date),
          dayNumber: date.getDate(),
        };
      }),
    [weekStart]
  );

  const monthCells = useMemo(() => monthGrid(weekStart), [weekStart]);
  const todayKey = toDayKey(new Date());

  // Keep selectedEventId in a ref so refreshCalendar doesn't rebuild on every event click
  const selectedEventIdRef = useRef(selectedEventId);
  useEffect(() => { selectedEventIdRef.current = selectedEventId; }, [selectedEventId]);
  const skipNextAutoRefreshRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const payload = await fetchWorkspaceIntegrationState(activeWorkspace.id);
      setStatus(payload);
      setError(null);
    } catch (statusError) {
      setStatus(null);
      setError(normalizeError(statusError, "Unable to validate session."));
    } finally {
      setStatusLoading(false);
    }
  }, [activeWorkspace.id]);

  // refreshCalendar: selectedEventId removed from deps to prevent re-fetch on event click
  const refreshCalendar = useCallback(async (
    overrideWorkspaceId?: string,
    overrideProvider?: string | null,
  ) => {
    const wid = overrideWorkspaceId ?? workspaceId;
    const provider = overrideProvider !== undefined ? overrideProvider : calendarProvider;
    if (!wid || !provider) return;
    setLoading(true);
    try {
      const calendarRows =
        provider === "icloud_caldav"
          ? await fetchIcloudCalendarCalendars({ workspaceId: wid })
          : await fetchCalendarCalendars({ workspaceId: wid });
      setCalendars(calendarRows);
      const defaultCalendarIds =
        selectedCalendarIds.length > 0
          ? selectedCalendarIds
          : calendarRows
              .filter((calendar) => calendar.primary || calendar.selected)
              .map((calendar) => calendar.id);
      const activeCalendarIds =
        defaultCalendarIds.length > 0
          ? defaultCalendarIds
          : calendarRows.map((calendar) => calendar.id);

      if (selectedCalendarIds.length === 0) {
        skipNextAutoRefreshRef.current = true;
        setSelectedCalendarIds(activeCalendarIds);
      }

      const from = weekStart.toISOString();
      const to = addDays(weekStart, 7).toISOString();
      const grouped = await Promise.all(
        activeCalendarIds.map(async (calendarId) => {
          try {
            return provider === "icloud_caldav"
              ? await fetchIcloudCalendarEvents({ workspaceId: wid, from, to, calendarId })
              : await fetchCalendarEvents({ workspaceId: wid, from, to, calendarId });
          } catch {
            return [] as CalendarEventRecord[];
          }
        })
      );

      const deduped = new Map<string, CalendarEventRecord>();
      for (const list of grouped) {
        for (const event of list) {
          const key = `${event.calendarId ?? "primary"}:${event.id}`;
          deduped.set(key, event);
        }
      }

      const mergedEvents = Array.from(deduped.values()).sort(
        (left, right) => Date.parse(left.start || left.date) - Date.parse(right.start || right.date)
      );
      setEvents(mergedEvents);
      const curSelectedEventId = selectedEventIdRef.current;
      if (curSelectedEventId && !mergedEvents.some((event) => event.id === curSelectedEventId)) {
        setSelectedEventId(null);
      }
      const statusForSnapshot = status?.workspaceId === wid ? status : null;
      if (statusForSnapshot) {
        saveCalendarSnapshot(wid, {
          status: statusForSnapshot,
          calendars: calendarRows,
          selectedCalendarIds: activeCalendarIds,
          events: mergedEvents,
          selectedEventId:
            curSelectedEventId && mergedEvents.some((event) => event.id === curSelectedEventId)
              ? curSelectedEventId
              : null,
          weekStartIso: weekStart.toISOString(),
          savedAt: Date.now(),
        });
      }
      setError(null);
    } catch (calendarError) {
      setError(normalizeError(calendarError, "Unable to load calendar events."));
    } finally {
      setLoading(false);
    }
  }, [calendarProvider, selectedCalendarIds, status, weekStart, workspaceId]); // selectedEventId removed

  // Combined initial load: fetch status + calendar events in one async flow (no re-render waterfall)
  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      const snapshot = loadCalendarSnapshot(activeWorkspace.id);
      if (snapshot) {
        setStatus(snapshot.status);
        setCalendars(snapshot.calendars);
        setSelectedCalendarIds(snapshot.selectedCalendarIds);
        setEvents(snapshot.events);
        setSelectedEventId(snapshot.selectedEventId);
        const snapshotWeek = new Date(snapshot.weekStartIso);
        if (Number.isFinite(snapshotWeek.getTime())) {
          setWeekStart(snapshotWeek);
        }
        setStatusLoading(false);
        setLoading(false);
        setError(null);
        setLoading(true);
      } else {
        setStatusLoading(true);
        setLoading(true);
      }
      try {
        const payload = await fetchWorkspaceIntegrationState(activeWorkspace.id);
        if (cancelled) return;
        setStatus(payload);
        setError(null);
        saveCalendarSnapshot(activeWorkspace.id, {
          status: payload,
          calendars: snapshot?.calendars ?? [],
          selectedCalendarIds: snapshot?.selectedCalendarIds ?? [],
          events: snapshot?.events ?? [],
          selectedEventId: snapshot?.selectedEventId ?? null,
          weekStartIso: (snapshot && typeof snapshot.weekStartIso === "string" ? snapshot.weekStartIso : weekStart.toISOString()),
          savedAt: Date.now(),
        });
        const wid = payload.workspaceId ?? activeWorkspace.id;
        const provider = payload.calendarProvider;
        if (!wid || !provider) return;
        await refreshCalendar(wid, provider);
      } catch (initError) {
        if (!cancelled) {
          setStatus(null);
          setError(normalizeError(initError, "Unable to validate session."));
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }
    void initialLoad();
    return () => { cancelled = true; };
  }, [activeWorkspace.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when week changes or canReadCalendar first becomes true
  const prevCanReadCalendar = useRef(false);
  useEffect(() => {
    if (!canReadCalendar) {
      setEvents([]);
      setCalendars([]);
      prevCanReadCalendar.current = false;
      return;
    }
    if (!prevCanReadCalendar.current) {
      prevCanReadCalendar.current = true;
      return; // Initial load handled above
    }
    if (skipNextAutoRefreshRef.current) {
      skipNextAutoRefreshRef.current = false;
      return;
    }
    // Week or calendar selection changed → re-fetch
    void refreshCalendar();
  }, [canReadCalendar, weekStart, selectedCalendarIds, refreshCalendar]);

  const visibleEvents = useMemo(
    () =>
      activeFilter === "all"
        ? events
        : events.filter((event) => detectCalendarFilter(event) === activeFilter),
    [activeFilter, events]
  );

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, PositionedEvent[]>();
    for (const event of visibleEvents) {
      const layout = eventLayout(event);
      if (!grouped.has(layout.dayKey)) grouped.set(layout.dayKey, []);
      grouped.get(layout.dayKey)!.push(layout);
    }
    for (const key of grouped.keys()) {
      grouped.set(
        key,
        grouped.get(key)!.sort((left, right) => left.top - right.top)
      );
    }
    return grouped;
  }, [visibleEvents]);

  const calendarCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of visibleEvents) {
      const key = event.calendarId ?? "primary";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [visibleEvents]);

  const selectedEvent = useMemo(
    () => visibleEvents.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, visibleEvents]
  );

  const todayEvents = useMemo(() => {
    const today = toDayKey(new Date());
    return visibleEvents.filter((event) => eventLayout(event).dayKey === today);
  }, [visibleEvents]);

  const nextEvent = useMemo(() => {
    const now = Date.now();
    return (
      [...visibleEvents]
        .map((event) => ({ event, start: Date.parse(event.start || event.date) }))
        .filter((entry) => Number.isFinite(entry.start) && entry.start >= now)
        .sort((left, right) => left.start - right.start)[0]?.event ?? null
    );
  }, [visibleEvents]);

  const primaryCalendarId = useMemo(
    () => calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id,
    [calendars]
  );

  const connectGoogle = async () => {
    try {
      await startGoogleConnect(workspaceId, "/os");
    } catch (connectError) {
      setError(normalizeError(connectError, "Unable to start Google connect."));
    }
  };

  const toggleCalendar = (calendarId: string) => {
    setSelectedCalendarIds((current) =>
      current.includes(calendarId)
        ? current.filter((id) => id !== calendarId)
        : [...current, calendarId]
    );
  };

  const submitNewEvent = async () => {
    if (!workspaceId || !canWriteCalendar) {
      setError("Connect Google with calendar write access to create events.");
      return;
    }
    if (!eventDraft.title.trim()) {
      setError("Event title is required.");
      return;
    }
    setEventSubmitting(true);
    try {
      const start = new Date(`${eventDraft.date}T${eventDraft.startTime}:00`).toISOString();
      const end = new Date(`${eventDraft.date}T${eventDraft.endTime}:00`).toISOString();

      await createCalendarEvent({
        workspaceId,
        ...(primaryCalendarId ? { calendarId: primaryCalendarId } : {}),
        title: eventDraft.title,
        ...(eventDraft.description ? { description: eventDraft.description } : {}),
        ...(eventDraft.location ? { location: eventDraft.location } : {}),
        start,
        end,
      });
      setEventModalOpen(false);
      setEventDraft((current) => ({ ...current, title: "", description: "", location: "" }));
      await refreshCalendar();
    } catch (submitError) {
      setError(normalizeError(submitError, "Unable to create event."));
    } finally {
      setEventSubmitting(false);
    }
  };

  if (statusLoading) {
    return (
      <div className="grid h-full gap-3 p-4 lg:grid-cols-[256px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="h-12 rounded-xl bg-white/[0.05]" />
          <div className="mt-5 h-36 rounded-2xl bg-white/[0.05]" />
          <div className="mt-5 space-y-2">
            <div className="h-10 rounded-xl bg-white/[0.05]" />
            <div className="h-10 rounded-xl bg-white/[0.05]" />
            <div className="h-10 rounded-xl bg-white/[0.05]" />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="h-12 rounded-xl bg-white/[0.05]" />
          <div className="mt-4 h-[min(60vh,520px)] rounded-2xl bg-white/[0.05]" />
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-rose-300/40 bg-rose-500/10 p-5 text-sm text-rose-100">
          {error ?? "Unable to load session."}
        </div>
      </div>
    );
  }

  if (!calendarProvider) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-white/15 bg-[#141823] p-6 text-white">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Calendar Integration</p>
          <h2 className="mt-2 text-2xl font-semibold">Connect Calendar</h2>
          <p className="mt-3 text-sm text-white/70">
            Connect this workspace with calendar access to display real events.
          </p>
          {!status.google.config.ready ? (
            <p className="mt-2 text-xs text-amber-200/85">
              Google is not configured in this environment. iCloud CalDAV remains available.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void connectGoogle();
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-pink-300/35 bg-pink-500/25 px-4 py-2.5 text-sm font-medium text-pink-50 transition hover:bg-pink-500/35"
            >
              <Plus size={16} />
              Connect Google
            </button>
            <a
              href={`/os/calendar/connect?workspaceId=${encodeURIComponent(workspaceId)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              <Plus size={16} />
              Connect iCloud
            </a>
          </div>
          {!status.google.config.ready && status.google.config.issues.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200/85">
              {status.google.config.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="mt-4 text-xs text-rose-200">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (calendarProvider === "google" && !status.google.config.ready) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-2xl border border-amber-300/35 bg-amber-500/10 p-6 text-sm text-amber-100">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-200/70">
            Google Configuration
          </p>
          <p className="mt-3">
            Missing Google env configuration. Set required variables and restart the app.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200/85">
            {status.google.config.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--os-accent) 10%, transparent), transparent 36%), var(--bg-canvas)",
      }}
    >
      <div className="grid h-full grid-cols-[256px_minmax(0,1fr)]">
        <aside
          className="flex h-full flex-col border-r p-4"
          style={{
            borderColor: "var(--os-border-soft)",
            background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)",
          }}
        >
          <button
            type="button"
            onClick={() => setEventModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105"
            style={{
              background: "linear-gradient(135deg, color-mix(in srgb, var(--os-accent) 88%, #fff), color-mix(in srgb, var(--os-accent) 62%, #1f2937))",
              boxShadow: "0 16px 32px color-mix(in srgb, var(--os-accent) 22%, transparent)",
            }}
          >
            <Plus size={18} />
            New Event
          </button>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border px-3 py-3" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">Today</p>
              <p className="mt-1 text-xl font-semibold text-[color:var(--text-primary)]">{todayEvents.length}</p>
              <p className="text-[11px] text-[color:var(--text-secondary)]">visible events</p>
            </div>
            <div className="rounded-2xl border px-3 py-3" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">Next Up</p>
              <p className="mt-1 truncate text-sm font-semibold text-[color:var(--text-primary)]">{nextEvent ? nextEvent.title : "No upcoming event"}</p>
              <p className="text-[11px] text-[color:var(--text-secondary)]">{nextEvent ? formatEventTime(nextEvent) : "Enjoy the gap"}</p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">
              {formatWeekHeadline(weekStart)}
            </p>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
              {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
                <span key={`${label}-${index}`} className="text-[color:var(--text-tertiary)]">
                  {label}
                </span>
              ))}
              {monthCells.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  className={cn(
                    "h-7 rounded-md text-[11px] transition",
                    cell.inMonth ? "text-white/75" : "text-white/30",
                    cell.key === todayKey && "bg-blue-500/70 font-semibold text-white"
                  )}
                  onClick={() => setWeekStart(startOfWeekMonday(cell.date))}
                  style={{
                    color:
                      cell.key === todayKey
                        ? "var(--text-on-accent, #fff)"
                        : cell.inMonth
                          ? "var(--text-secondary)"
                          : "var(--text-tertiary)",
                  }}
                >
                  {cell.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">My Calendars</p>
              <span className="rounded-full border px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                {calendarProvider === "icloud_caldav" ? "iCloud" : "Google"}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {calendars.map((calendar) => {
                const active = selectedCalendarIds.includes(calendar.id);
                const dotColor = calendar.backgroundColor || "#3b82f6";
                return (
                  <button
                    key={calendar.id}
                    type="button"
                    onClick={() => toggleCalendar(calendar.id)}
                    className="flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-sm transition"
                    style={{
                      borderColor: active ? "var(--border-focus)" : "var(--os-border-soft)",
                      background: active ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: dotColor }}
                      />
                      {calendar.summary}
                    </span>
                    <span className="text-xs text-[color:var(--text-tertiary)]">
                      {calendarCounts.get(calendar.id) ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">Filters</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {([
                  ["all", "All"],
                  ["meeting", "Meetings"],
                  ["focus", "Focus"],
                  ["other", "Other"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveFilter(value)}
                    className="rounded-full border px-3 py-1.5 text-[11px] font-medium transition"
                    style={{
                      borderColor: activeFilter === value ? "var(--border-focus)" : "var(--os-border-soft)",
                      background: activeFilter === value ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                      color: activeFilter === value ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="relative flex h-full min-h-0 flex-col">
          <header
            className="border-b px-5 py-4"
            style={{
              borderColor: "var(--os-border-soft)",
              background: "color-mix(in srgb, var(--bg-elevated) 90%, transparent)",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">Calendar</p>
                  <h2 className="text-3xl text-[color:var(--text-primary)]">{formatWeekHeadline(weekStart)}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
                  className="rounded-xl border px-3 py-1.5 text-sm transition"
                  style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
                >
                  Today
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((prev) => addDays(prev, -7))}
                  className="rounded-xl border p-2 transition"
                  style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
                  aria-label="Previous week"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart((prev) => addDays(prev, 7))}
                  className="rounded-xl border p-2 transition"
                  style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
                  aria-label="Next week"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void refreshCalendar()}
                  className="inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm transition"
                  style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
                >
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>
            {!canWriteCalendar ? (
              <p className="mt-2 text-xs text-amber-200">
                Connect with calendar write access to create new events.
              </p>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1080px]">
              <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b" style={{ borderColor: "var(--os-border-soft)" }}>
                <div />
                {weekDays.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() =>
                      setEventDraft((draft) => ({ ...draft, date: day.key }))
                    }
                    className={cn(
                      "border-l px-3 py-2 text-left transition",
                      day.key === todayKey && "bg-blue-500/15"
                    )}
                    style={{ borderColor: "var(--os-border-soft)" }}
                  >
                    <p className="text-sm text-[color:var(--text-secondary)]">{day.label}</p>
                    <p
                      className={cn(
                        "text-xl leading-tight",
                        day.key === todayKey ? "font-semibold text-blue-300" : "text-[color:var(--text-primary)]"
                      )}
                    >
                      {day.dayNumber}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
                <div className="relative h-[1536px] border-r" style={{ borderColor: "var(--os-border-soft)" }}>
                  {HOURS.map((hour) => (
                    <div
                      key={`hour-${hour}`}
                      className="absolute left-0 right-0 border-t px-2 text-[11px] text-[color:var(--text-tertiary)]"
                      style={{ top: hour * HOUR_HEIGHT, borderColor: "var(--border-subtle)" }}
                    >
                      <span className="-translate-y-1/2 pr-1" style={{ background: "var(--bg-canvas)" }}>
                        {formatHourLabel(hour)}
                      </span>
                    </div>
                  ))}
                </div>

                {weekDays.map((day) => {
                  const dayEvents = eventsByDay.get(day.key) ?? [];
                  return (
                    <div
                      key={`col-${day.key}`}
                      className={cn(
                        "relative h-[1536px] border-l",
                        day.key === todayKey && "bg-blue-500/[0.04]"
                      )}
                      style={{ borderColor: "var(--os-border-soft)" }}
                    >
                      {HOURS.map((hour) => (
                        <div
                          key={`${day.key}-line-${hour}`}
                          className="absolute left-0 right-0 border-t"
                          style={{ top: hour * HOUR_HEIGHT, borderColor: "var(--border-subtle)" }}
                        />
                      ))}

                      {dayEvents.map((event) => (
                        <button
                          key={`${event.calendarId ?? "primary"}-${event.id}`}
                          type="button"
                          onClick={() => setSelectedEventId(event.id)}
                          className={cn(
                            "absolute left-1.5 right-1.5 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-[0_8px_18px_rgba(0,0,0,0.25)] transition hover:brightness-110",
                            selectedEventId === event.id
                              ? "text-white"
                              : "text-white/95"
                          )}
                          style={{
                            top: event.top,
                            height: event.height,
                            borderColor:
                              selectedEventId === event.id
                                ? "color-mix(in srgb, #ffffff 26%, transparent)"
                                : "color-mix(in srgb, var(--event-accent) 30%, transparent)",
                            background:
                              selectedEventId === event.id
                                ? "color-mix(in srgb, var(--event-accent) 48%, rgba(15,23,42,0.88))"
                                : "color-mix(in srgb, var(--event-accent) 30%, rgba(15,23,42,0.82))",
                            ["--event-accent" as string]: eventAccent(event),
                          }}
                        >
                          <p className="truncate text-xs font-semibold">
                            {event.title}
                          </p>
                          <p className="truncate text-[11px] text-white/80">
                            {formatEventTime(event)}
                          </p>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {selectedEvent ? (
              <motion.aside
                initial={{ x: 28, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 28, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="absolute bottom-0 right-0 top-0 z-20 w-[384px] border-l p-5 backdrop-blur-xl"
                style={{
                  borderColor: "var(--os-border-soft)",
                  background: "color-mix(in srgb, var(--bg-elevated) 95%, transparent)",
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">
                      Event Detail
                    </p>
                    <h3 className="mt-2 text-xl text-[color:var(--text-primary)]">{selectedEvent.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEventId(null)}
                    className="rounded-md border p-1.5 transition"
                    style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="mt-5 space-y-3 text-sm text-[color:var(--text-secondary)]">
                  <p className="inline-flex items-center gap-2">
                    <Clock3 size={14} />
                    {formatEventTime(selectedEvent)}
                  </p>
                  {selectedEvent.location ? (
                    <p className="inline-flex items-center gap-2">
                      <MapPin size={14} />
                      {selectedEvent.location}
                    </p>
                  ) : null}
                  {selectedEvent.attendees && selectedEvent.attendees.length > 0 ? (
                    <p className="inline-flex items-center gap-2">
                      <Users size={14} />
                      {selectedEvent.attendees.slice(0, 5).join(", ")}
                    </p>
                  ) : null}
                  <p className="inline-flex items-center gap-2">
                    <CalendarDays size={14} />
                    {selectedEvent.calendarId ?? "primary"}
                  </p>
                  <div className="rounded-2xl border px-3 py-3 text-xs" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                    <p className="font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">Source</p>
                    <p className="mt-1 text-[color:var(--text-secondary)]">
                      Live from the connected {calendarProvider === "icloud_caldav" ? "iCloud CalDAV" : "Google"} calendar feed.
                    </p>
                  </div>
                </div>
              </motion.aside>
            ) : null}
          </AnimatePresence>
        </section>
      </div>

      {error ? (
        <div className="absolute bottom-4 right-4 rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <AnimatePresence>
        {eventModalOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEventModalOpen(false)}
            />
            <motion.div
              className="fixed inset-0 z-[310] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="w-full max-w-2xl rounded-xl border border-white/15 bg-[#141823] p-5 shadow-[0_28px_88px_rgba(0,0,0,0.6)]"
                initial={{ scale: 0.9, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.94, y: 12, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Create event</h3>
                  <button
                    type="button"
                    onClick={() => setEventModalOpen(false)}
                    className="rounded-md border border-white/10 p-1.5 text-white/70 transition hover:bg-white/[0.06]"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    value={eventDraft.title}
                    onChange={(event) =>
                      setEventDraft((prev) => ({ ...prev, title: event.target.value }))
                    }
                    placeholder="Event title"
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/85 outline-none placeholder:text-white/40 focus:border-pink-400/35"
                  />
                  <textarea
                    value={eventDraft.description}
                    onChange={(event) =>
                      setEventDraft((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Description"
                    className="h-20 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/40 focus:border-pink-400/35"
                  />
                  <input
                    value={eventDraft.location}
                    onChange={(event) =>
                      setEventDraft((prev) => ({ ...prev, location: event.target.value }))
                    }
                    placeholder="Location"
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/85 outline-none placeholder:text-white/40 focus:border-pink-400/35"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="date"
                      value={eventDraft.date}
                      onChange={(event) =>
                        setEventDraft((prev) => ({ ...prev, date: event.target.value }))
                      }
                      className="h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/85 outline-none focus:border-pink-400/35"
                    />
                    <input
                      type="time"
                      value={eventDraft.startTime}
                      onChange={(event) =>
                        setEventDraft((prev) => ({
                          ...prev,
                          startTime: event.target.value,
                        }))
                      }
                      className="h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/85 outline-none focus:border-pink-400/35"
                    />
                    <input
                      type="time"
                      value={eventDraft.endTime}
                      onChange={(event) =>
                        setEventDraft((prev) => ({ ...prev, endTime: event.target.value }))
                      }
                      className="h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/85 outline-none focus:border-pink-400/35"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-white/45">
                    {canWriteCalendar
                      ? "This event will be created in your primary Google calendar."
                      : "Connect with calendar write access to enable event creation."}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      canWriteCalendar ? void submitNewEvent() : void connectGoogle()
                    }
                    disabled={eventSubmitting}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition",
                      canWriteCalendar
                        ? "border border-pink-300/35 bg-pink-500/25 text-pink-50 hover:bg-pink-500/35"
                        : "border border-white/15 bg-white/[0.05] text-white/75"
                    )}
                  >
                    {eventSubmitting
                      ? "Creating..."
                      : canWriteCalendar
                      ? "Create event"
                      : "Reconnect Google"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
