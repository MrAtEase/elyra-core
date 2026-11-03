"use client";

import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ModuleHeader from "@/components/workspace/ModuleHeader";
import WorkScopeBadge from "@/components/workspace/WorkScopeBadge";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { useCalendar } from "@/components/workspace/calendar/useCalendar";
import IcloudCalendarConnect from "@/components/workspace/calendar/IcloudCalendarConnect";
import { buildAssistantEndpoint } from "@/utils/auth-guard";
import { cn } from "@/lib/utils";
import {
  PANE_SCROLL,
  STAGE_GREY_READABLE,
  STAGE_INNER,
  STAGE_SHELL,
} from "@/lib/ui/surfaces";

type CalendarView = "day" | "week" | "month";

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const mondayIndex = (day + 6) % 7;
  return addDays(x, -mondayIndex);
}
function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function endOfMonth(d: Date) {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeekMonday(d: Date) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getMonthMatrix(anchor: Date) {
  const mStart = startOfMonth(anchor);
  const mEnd = endOfMonth(anchor);
  const gridStart = startOfWeekMonday(mStart);

  const weeks: Date[][] = [];
  let cur = gridStart;

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(week);

    if (cur > mEnd && ((cur.getDay() + 6) % 7) === 0) {
      break;
    }
  }

  return weeks;
}

function formatDayHeader(d: Date) {
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" });
}
function formatMonthTitle(d: Date) {
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
function formatTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type AnyEvent = any;

function eventTitle(ev: AnyEvent) {
  return (
    ev?.summary ??
    ev?.title ??
    ev?.name ??
    ev?.subject ??
    (ev?.isPrivate ? "Busy" : "Termin")
  );
}

type EventKind = "focus" | "meeting" | "admin" | "neutral";

type CalendarEvent = {
  raw: AnyEvent;
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  attendees: any[];
  isPrivate: boolean;
  kind: EventKind;
};

function deriveEventKind(title: string): EventKind {
  const normalized = title.toLowerCase();
  if (/(deep work|focus|konzentriert|konzentration|fokus|block|abschluss)/.test(normalized)) {
    return "focus";
  }
  if (/(call|meet|meeting|video|zoom|google|switch|partner|sync)/.test(normalized)) {
    return "meeting";
  }
  if (/(admin|email|mail|orga|nachbearbeitung|follow-up|recherche|organisation)/.test(normalized)) {
    return "admin";
  }
  return "neutral";
}

const DAY_HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEK_START_HOUR = 8;
const WEEK_END_HOUR = 20;
const WEEK_HOUR_PX = 56;
const WEEK_VISIBLE_HOURS = WEEK_END_HOUR - WEEK_START_HOUR;
const WEEK_TRACK_HEIGHT = WEEK_VISIBLE_HOURS * WEEK_HOUR_PX;
const DAY_SLOT_HEIGHT_FALLBACK = 62;
const GRID_HOUR_HEIGHT = 60;
const FULL_DAY_MINUTES = 24 * 60;

function parseEventStart(ev: AnyEvent): Date | null {
  const raw =
    ev?.start?.dateTime ??
    ev?.start?.date ??
    ev?.startTime ??
    ev?.start ??
    ev?.startsAt ??
    ev?.starts_at ??
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEventEnd(ev: AnyEvent): Date | null {
  const raw =
    ev?.end?.dateTime ??
    ev?.end?.date ??
    ev?.endTime ??
    ev?.end ??
    ev?.endsAt ??
    ev?.ends_at ??
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAllDay(ev: AnyEvent) {
  const s = ev?.start?.date ?? ev?.startDate ?? null;
  const e = ev?.end?.date ?? ev?.endDate ?? null;
  return Boolean(s && e) || Boolean(ev?.allDay);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function minutesSinceStartHour(d: Date) {
  return (d.getHours() - WEEK_START_HOUR) * 60 + d.getMinutes();
}

function isAllDayLike(event: CalendarEvent) {
  if (event.allDay) return true;
  const start = event.start;
  const end = event.end;
  if (!start || !end) return false;

  const durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
  const startsMidnight = start.getHours() === 0 && start.getMinutes() === 0;
  const endsMidnight = end.getHours() === 0 && end.getMinutes() === 0;

  // Most 24h or very long blocks shouldn't live inside the timed grid.
  if (startsMidnight && endsMidnight && durationMin >= 23 * 60) return true;
  if (durationMin >= 10 * 60) return true;
  return false;
}

function positionTimedEvent(ev: CalendarEvent) {
  const start = ev.start;
  const end = ev.end;
  if (!start || !end) return null;
  const totalMin = (WEEK_END_HOUR - WEEK_START_HOUR) * 60;
  const startMin = clamp(minutesSinceStartHour(start), 0, totalMin);
  const endMin = clamp(minutesSinceStartHour(end), 0, totalMin);
  const top = (startMin / 60) * WEEK_HOUR_PX;
  const height = Math.max(
    18,
    ((Math.max(endMin, startMin + 15) - startMin) / 60) * WEEK_HOUR_PX,
  );
  return { top, height };
}

const QUICK_PLAN_PROMPTS = ["90m Deep Work", "Lunch", "Call prep", "Free slot finden"];

function formatDuration(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function getPayloadValue(payload: Record<string, unknown> | undefined, keys: string[]) {
  if (!payload) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

const PENDING_ACTION_COPY: Record<string, string> = {
  calendar_create: "Neuer Fokusblock",
  calendar_update: "Termin anpassen",
  calendar_delete: "Termin entfernen",
};

const PENDING_START_KEYS = [
  "start",
  "startIso",
  "start_at",
  "startDate",
  "start_date",
  "startTime",
  "startsAt",
  "starts_at",
];

const PENDING_END_KEYS = [
  "end",
  "endIso",
  "end_at",
  "endDate",
  "end_date",
  "endTime",
  "endsAt",
  "ends_at",
];

export default function CalendarPage() {
  const {
    data,
    calendarStatus,
    refreshCalendar,
    sendAssistantChatMessage,
    pendingCalendarAction,
    confirmPendingCalendarAction,
    dismissPendingCalendarAction,
  } = useWorkspaceData();
  const workspaceId = data?.activeWorkspace?.id ?? null;

  const [view, setView] = useState<CalendarView>("day");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSlotHour, setSelectedSlotHour] = useState<number | null>(null);
  const [planPrompt, setPlanPrompt] = useState("");
  const [planStatus, setPlanStatus] = useState<"idle" | "pending" | "done">("idle");
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const planInputRef = useRef<HTMLInputElement | null>(null);
  const weekXScrollRef = useRef<HTMLDivElement | null>(null);
  const dayScrollRef = useRef<HTMLDivElement | null>(null);
  const dayCanvasRef = useRef<HTMLDivElement | null>(null);
  const weekBodyRef = useRef<HTMLDivElement | null>(null);
  const daySlotRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const calendarScrollWrapperRef = useRef<HTMLDivElement | null>(null);
  const autoScrollTriggeredRef = useRef(false);
  const [calendarHeaderHeight, setCalendarHeaderHeight] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [isBrowserRendered, setIsBrowserRendered] = useState(false);
  const [dayNowTop, setDayNowTop] = useState<number | null>(null);

  const { items, isLoading, error, refresh } = useCalendar(workspaceId ?? undefined);
  const calendarConnectRef = useRef<HTMLDivElement | null>(null);
  const handleConnectCalendarClick = useCallback(() => {
    calendarConnectRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const today = useMemo(() => startOfDay(new Date()), [nowTick]);
  const now = useMemo(() => new Date(), [nowTick]);
  const nowHour = now.getHours();
  const nowMinutes = now.getMinutes();
  const nowLabel = useMemo(
    () =>
      now.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [now]
  );
  const cursorDay = useMemo(() => startOfDay(cursor), [cursor]);
  const cursorDayKey = cursorDay.getTime();
  const isCursorToday = cursorDayKey === today.getTime();
  const todayKey = today.getTime();

  const computeNowLineTop = useCallback(() => {
    if (view !== "day" || !isCursorToday) return null;
    const hour = clamp(nowHour, 0, 23);
    const slot = daySlotRefs.current[hour];
    if (!slot) return null;
    const minuteRatio = nowMinutes / 60;
    return slot.offsetTop + slot.offsetHeight * minuteRatio;
  }, [view, isCursorToday, nowHour, nowMinutes]);

  const visibleRange = useMemo(() => {
    if (view === "day") {
      const start = startOfDay(cursorDay);
      const end = addDays(start, 1);
      return { start, end };
    }
    if (view === "week") {
      const start = startOfWeek(cursorDay);
      const end = addDays(start, 7);
      return { start, end };
    }
    const start = startOfWeek(startOfMonth(cursorDay));
    const end = addDays(startOfWeek(addDays(endOfMonth(cursorDay), 1)), 7);
    return { start, end };
  }, [cursorDay, view]);

  const normalizedEvents = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
      return list
        .map((ev: AnyEvent) => {
          const start = parseEventStart(ev);
          const end = parseEventEnd(ev);
          if (!start) return null;
          const endSafe = end ?? addDays(start, 0);
          const titleText = eventTitle(ev);
          return {
            raw: ev,
            id: String(
              ev?.id ?? ev?.eventId ?? ev?.googleId ?? `${start.toISOString()}-${titleText}`
            ),
            title: titleText,
            start,
            end: endSafe,
            allDay: isAllDay(ev),
            location: ev?.location ?? ev?.place ?? null,
            attendees: ev?.attendees ?? ev?.participants ?? [],
            isPrivate: Boolean(ev?.isPrivate || ev?.visibility === "private"),
            kind: deriveEventKind(titleText),
          };
        })
      .filter(Boolean) as Array<CalendarEvent>;
  }, [items]);

  const getEventsForDate = useCallback(
    (date: Date) => {
      const dayStart = startOfDay(date);
      const dayEnd = addDays(dayStart, 1);
      return normalizedEvents
        .filter((ev) => ev.start < dayEnd && ev.end > dayStart)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    },
    [normalizedEvents],
  );

  const eventsInRange = useMemo(() => {
    const { start, end } = visibleRange;
    return normalizedEvents
      .filter((ev) => ev.start < end && ev.end > start)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [normalizedEvents, visibleRange]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return eventsInRange.find((ev) => ev.id === selectedId) ?? normalizedEvents.find((ev) => ev.id === selectedId) ?? null;
  }, [eventsInRange, normalizedEvents, selectedId]);

  const todaySnapshot = useMemo(() => {
    const now = new Date();
    return normalizedEvents
      .filter((ev) => {
        return startOfDay(ev.start).getTime() === today.getTime() && ev.end.getTime() > now.getTime();
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
  }, [normalizedEvents, today]);

  const todaySnapshotHint = useMemo(() => {
    if (todaySnapshot) {
      const diffMinutes = Math.max(0, (todaySnapshot.start.getTime() - Date.now()) / 60000);
      return `Nächster Termin um ${formatTime(todaySnapshot.start)} · noch ${formatDuration(diffMinutes)} frei.`;
    }
    return "Heute stehen noch keine Termine im Kalender.";
  }, [todaySnapshot]);

  const pendingActionInfo = useMemo(() => {
    if (!pendingCalendarAction) return null;
    const payload = pendingCalendarAction.payload || {};
    const startValue = getPayloadValue(payload, PENDING_START_KEYS);
    const endValue = getPayloadValue(payload, PENDING_END_KEYS);
    const startDate = parseTimestamp(startValue);
    const endDate = parseTimestamp(endValue);
    const rawTitle =
      payload.summary ??
      payload.title ??
      payload.name ??
      payload.subject ??
      payload.label ??
      null;
    const title =
      typeof rawTitle === "string" && rawTitle.length ? rawTitle : "Merlin Vorschlag";
    const timeLabel = startDate
      ? endDate
        ? `${formatDayHeader(startDate)} · ${formatTime(startDate)} – ${formatTime(endDate)}`
        : `${formatDayHeader(startDate)} · ${formatTime(startDate)}`
      : null;
    return {
      title,
      typeLabel: PENDING_ACTION_COPY[pendingCalendarAction.type] ?? "Merlin Vorschlag",
      timeLabel,
    };
  }, [pendingCalendarAction]);

  const selectedDurationLabel = useMemo(() => {
    if (!selected) return null;
    const diffMinutes = Math.round((selected.end.getTime() - selected.start.getTime()) / 60000);
    if (diffMinutes <= 0) {
      return null;
    }
    return formatDuration(diffMinutes);
  }, [selected]);

  const daysForWeek = useMemo(() => {
    const start = startOfWeek(cursorDay);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursorDay]);

  const monthWeeks = useMemo(() => getMonthMatrix(cursorDay), [cursorDay]);

  const dayList = useMemo(() => {
    const dayStart = startOfDay(cursorDay);
    const dayEnd = addDays(dayStart, 1);
    return normalizedEvents
      .filter((ev) => ev.start < dayEnd && ev.end > dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [cursorDay, normalizedEvents]);

  const daySlots = useMemo(() => {
    const buckets = new Map<number, CalendarEvent[]>();
    for (const hour of DAY_HOURS) {
      buckets.set(hour, []);
    }
    for (const ev of dayList) {
      const hour = clamp(ev.start.getHours(), 0, 23);
      buckets.get(hour)?.push(ev);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return DAY_HOURS.map((hour) => ({
      hour,
      events: buckets.get(hour) ?? [],
    }));
  }, [dayList]);

  const weekGridDays = useMemo(() => {
    if (view === "day") {
      return [cursorDay];
    }
    return daysForWeek;
  }, [view, cursorDay, daysForWeek]);

  const eventsByDayHour = useMemo(() => {
    const gridDays = weekGridDays;
    const baseDay = gridDays[0];
    if (!baseDay) {
      return new Map<string, CalendarEvent[]>();
    }
    const baseTime = startOfDay(baseDay).getTime();
    const map = new Map<string, CalendarEvent[]>();
    for (const event of eventsInRange) {
      const dayIndex = Math.floor(
        (startOfDay(event.start).getTime() - baseTime) / (24 * 60 * 60 * 1000),
      );
      if (dayIndex < 0 || dayIndex >= gridDays.length) {
        continue;
      }
      const hour = clamp(event.start.getHours(), 0, 23);
      const key = `${dayIndex}-${hour}`;
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }
    return map;
  }, [eventsInRange, weekGridDays]);

  const handlePrev = useCallback(() => {
    setSelectedId(null);
    setCursor((prev) => {
      if (view === "day") return addDays(prev, -1);
      if (view === "week") return addDays(prev, -7);
      const x = new Date(prev);
      x.setMonth(x.getMonth() - 1);
      return x;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setSelectedId(null);
    setCursor((prev) => {
      if (view === "day") return addDays(prev, 1);
      if (view === "week") return addDays(prev, 7);
      const x = new Date(prev);
      x.setMonth(x.getMonth() + 1);
      return x;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    autoScrollTriggeredRef.current = false;
    setSelectedId(null);
    setCursor(startOfDay(new Date()));
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedSlotHour(null);
    setSelectedId(id);
  }, []);

  const handleSlotSelect = useCallback((hour: number) => {
    setSelectedId(null);
    setSelectedSlotHour(hour);
  }, []);

  const handleSlotMerlinSuggest = useCallback(() => {
    if (selectedSlotHour === null) return;
    setPlanPrompt(`${pad2(selectedSlotHour)}:00 Fokus`);
    planInputRef.current?.focus();
  }, [selectedSlotHour]);

  const handleCalendarWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (view !== "day" && view !== "week") return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const scroller = document.querySelector('[data-workspace-scroll="true"]') as HTMLElement | null;
      if (!scroller) return;
      scroller.scrollTop += event.deltaY;
      event.preventDefault();
    },
    [view],
  );

  useEffect(() => {
    const tick = setInterval(() => setNowTick((x) => x + 1), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    setIsBrowserRendered(true);
  }, []);

  const isConnected = calendarStatus === "ready" || calendarStatus === "loading";
  const planDisabledReason = !workspaceId
    ? "Kein Workspace ausgewählt."
    : !isConnected
    ? "Kalender muss verbunden sein."
    : "";
  const planDisabled = planStatus === "pending" || Boolean(planDisabledReason);
  const planButtonLabel = planStatus === "pending" ? "Merlin hört zu..." : "Planen";

  const handlePlanSubmit = useCallback(async () => {
    const prompt = planPrompt.trim();
    if (!prompt) {
      setPlanMessage("Erzähl Merlin, was du geplant haben möchtest.");
      return;
    }
    if (!workspaceId) {
      setPlanMessage("Kein Workspace ausgewählt.");
      return;
    }
    if (!isConnected) {
      setPlanMessage("Kalender muss verbunden sein.");
      return;
    }
    setPlanStatus("pending");
    setPlanMessage("Merlin baut einen Vorschlag...");
    try {
      await sendAssistantChatMessage(`Plan request: ${prompt}`);
      setPlanMessage("Merlin hat die Anfrage registriert. Schau dir den Vorschlag weiter unten an.");
      setPlanStatus("done");
    } catch (error) {
      console.error("[CalendarPage] plan request failed", error);
      setPlanMessage(
        error instanceof Error ? error.message : "Plananfrage konnte nicht gestartet werden."
      );
      setPlanStatus("idle");
    }
  }, [isConnected, planPrompt, sendAssistantChatMessage, workspaceId]);

  const handleChipClick = useCallback((value: string) => {
    setPlanPrompt(value);
    planInputRef.current?.focus();
  }, []);

  const handleFocusBlockAction = useCallback(() => {
    setPlanPrompt("90m Deep Work");
    planInputRef.current?.focus();
  }, []);

  const handleSelectionAction = useCallback(
    (action: string) => {
      if (!selected) return;
      console.info("[CalendarPage] selection action", action, selected);
    },
    [selected]
  );

  useEffect(() => {
    if (view !== "day") {
      setSelectedSlotHour(null);
    }
  }, [view]);

  useEffect(() => {
    if (view !== "day" || !isCursorToday) {
      setDayNowTop(null);
      return;
    }
    const nextTop = computeNowLineTop();
    if (nextTop === null) return;
    setDayNowTop(nextTop);
  }, [computeNowLineTop, view, isCursorToday]);

  const getSlotHeightPx = useCallback(() => {
    return daySlotRefs.current[0]?.offsetHeight ?? DAY_SLOT_HEIGHT_FALLBACK;
  }, []);

  const scrollDayToNow = useCallback(() => {
    if (view !== "day" || dayNowTop === null) return;
    const container = dayScrollRef.current;
    if (!container) return;
    const target = dayNowTop - container.clientHeight * 0.25;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = clamp(target, 0, maxScroll);
  }, [dayNowTop, view]);

  const todayVisibleInGrid = weekGridDays.some((day) => startOfDay(day).getTime() === todayKey);
  const shouldShowNowLine =
    view === "day" ? isCursorToday : view === "week" ? todayVisibleInGrid : false;
  const nowMinutesSinceMidnight = clamp(nowHour * 60 + nowMinutes, 0, FULL_DAY_MINUTES);
  const nowLineTop = calendarHeaderHeight + (nowMinutesSinceMidnight / 60) * GRID_HOUR_HEIGHT;

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const updateHeaderHeight = () => {
      const element = calendarGridRef.current?.querySelector<HTMLElement>(".calendar-day-header");
      const measured = element?.offsetHeight ?? 0;
      setCalendarHeaderHeight((prev) => (prev === measured ? prev : measured));
    };
    updateHeaderHeight();
    window.addEventListener("resize", updateHeaderHeight);
    return () => window.removeEventListener("resize", updateHeaderHeight);
  }, [view, weekGridDays.length]);

  useEffect(() => {
    autoScrollTriggeredRef.current = false;
  }, [view]);

  useEffect(() => {
    if (view !== "day" && view !== "week") {
      autoScrollTriggeredRef.current = false;
      return undefined;
    }
    if (typeof document === "undefined") return undefined;
    const scroller = document.querySelector('[data-workspace-scroll="true"]') as HTMLElement | null;
    const grid = calendarGridRef.current;
    if (!scroller || !grid) return undefined;
    if (!todayVisibleInGrid) {
      autoScrollTriggeredRef.current = false;
      return undefined;
    }
    if (autoScrollTriggeredRef.current) return undefined;

    autoScrollTriggeredRef.current = true;
    let frameA: number | null = null;
    let frameB: number | null = null;

    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(() => {
        const scrollerRect = scroller.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const offsetFromShell = gridRect.top - scrollerRect.top;
        const now = new Date();
        const minutes = clamp(now.getHours() * 60 + now.getMinutes(), 0, FULL_DAY_MINUTES);
        const target = (minutes / 60) * GRID_HOUR_HEIGHT;
        const desired = scroller.scrollTop + offsetFromShell + target - scroller.clientHeight * 0.33;
        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTo({ top: clamp(desired, 0, maxScroll), behavior: "smooth" });
      });
    });

    return () => {
      if (frameA !== null) cancelAnimationFrame(frameA);
      if (frameB !== null) cancelAnimationFrame(frameB);
    };
  }, [view, weekGridDays, todayVisibleInGrid, todayKey]);

  useEffect(() => {
    if (view !== "week") return undefined;
    const container = calendarScrollWrapperRef.current;
    if (!container) return undefined;
    const todayIndex = weekGridDays.findIndex(
      (day) => startOfDay(day).getTime() === todayKey,
    );
    if (todayIndex < 0) return undefined;
    const columns = Array.from(container.querySelectorAll<HTMLElement>(".calendar-day-header"));
    const target = columns[todayIndex];
    if (!target) return undefined;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, weekGridDays, todayKey]);

  useEffect(() => {
    if (view !== "day") return undefined;
    const container = calendarScrollWrapperRef.current;
    if (!container) return undefined;
    const now = new Date();
    const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    const pxPerMinute = GRID_HOUR_HEIGHT / 60;
    const targetOffset = Math.max(minutesSinceMidnight * pxPerMinute - 180, 0);
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const frame = requestAnimationFrame(() => {
      container.scrollTop = Math.min(targetOffset, maxScroll);
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  const handleConfirmPending = useCallback(async () => {
    if (!pendingCalendarAction) return;
    try {
      await confirmPendingCalendarAction();
    } catch (error) {
      console.error("[CalendarPage] confirm pending action failed", error);
    }
  }, [confirmPendingCalendarAction, pendingCalendarAction]);

  const handleDismissPending = useCallback(async () => {
    if (!pendingCalendarAction) return;
    try {
      await dismissPendingCalendarAction();
    } catch (error) {
      console.error("[CalendarPage] dismiss pending action failed", error);
    }
  }, [dismissPendingCalendarAction, pendingCalendarAction]);

  const isMonthView = view === "month";
  const calendarModeClass = isMonthView
    ? "calendar--month"
    : view === "week"
    ? "calendar--week"
    : "calendar--day";
  const gridStyle = {
    ["--day-count" as "--day-count"]: weekGridDays.length,
  } as CSSProperties;

  const rangeLabel = useMemo(() => {
    if (view === "month") return formatMonthTitle(cursorDay);
    if (view === "week") {
      const start = startOfWeek(cursorDay);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "short",
      })}`;
    }
    return cursorDay.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
  }, [cursorDay, view]);

  const renderMonthView = () => {
    if (!isMonthView) return null;
    const dowLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const monthIndex = cursorDay.getMonth();
    return (
      <div className="calendar-month">
        <div className="calendar-month-head">
          {dowLabels.map((label) => (
            <div key={label} className="calendar-month-dow">
              {label}
            </div>
          ))}
        </div>
        <div className="calendar-month-grid">
          {monthWeeks.flat().map((day, idx) => {
            const inMonth = day.getMonth() === monthIndex;
            const isToday = isSameDay(day, today);
            const events = getEventsForDate(day).slice(0, 2);
            const classes = [
              "calendar-month-cell",
              inMonth ? "is-in-month" : "is-out-month",
              isToday ? "is-today" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${day.toISOString()}-${idx}`}
                type="button"
                className={classes}
                onClick={() => {
                  setSelectedId(null);
                  setSelectedSlotHour(null);
                  setCursor(startOfDay(day));
                  setView("day");
                }}
              >
                <div className="calendar-month-date">{day.getDate()}</div>
                <div className="calendar-month-events">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="calendar-month-chip"
                      title={event.isPrivate ? "Busy" : event.title}
                    >
                      {event.isPrivate ? "Busy" : event.title}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTimelineView = () => (
    <div className="calendar-scroll-wrapper" ref={calendarScrollWrapperRef}>
      <div className="calendar-viewport" onWheel={handleCalendarWheel}>
        <div
          className={`calendar-grid ${view === "day" ? "calendar-grid--day" : ""}`}
          ref={calendarGridRef}
          style={gridStyle}
        >
          {shouldShowNowLine && (
            <div className="calendar-now-line" style={{ top: `${nowLineTop}px` }} aria-hidden="true">
              <span className="calendar-now-line-label">{nowLabel}</span>
            </div>
          )}
          <div className="calendar-header-row">
            <div className="calendar-time-gutter">Time</div>
            {weekGridDays.map((day) => {
              const isToday = startOfDay(day).getTime() === todayKey;
              return (
                <div
                  key={`day-${day.toISOString()}`}
                  className={`calendar-day-header ${isToday ? "is-today" : ""}`}
                >
                  <span>{day.toLocaleDateString("de-DE", { weekday: "short" })}</span>
                  <span>{day.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}</span>
                </div>
              );
            })}
          </div>

          {Array.from({ length: 24 }).map((_, hour) => (
            <div key={`hour-${hour}`} className="calendar-row">
              <div className="calendar-time-gutter">{`${pad2(hour)}:00`}</div>
              {weekGridDays.map((day, dayIdx) => {
                const cellEvents = eventsByDayHour.get(`${dayIdx}-${hour}`) ?? [];
                return (
                  <div key={`cell-${dayIdx}-${hour}`} className="calendar-cell">
                    {cellEvents.slice(0, 2).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={`calendar-cell-event ${
                          selectedId === event.id ? "is-active" : ""
                        } calendar-cell-event--kind-${event.kind}`}
                        onClick={() => handleSelect(event.id)}
                        title={event.isPrivate ? "Busy" : event.title}
                      >
                        <span className="calendar-cell-event-title">
                          {event.isPrivate ? "Busy" : event.title}
                        </span>
                        <span className="calendar-cell-event-time">
                          {event.allDay ? "All day" : formatTime(event.start)}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <section className="workspace-main-panel calendar2035 calendar-readable">
      <header className="cal-header">
        <ModuleHeader
          moduleLabel="Calendar"
          subtitle="Dein Zeit-OS: schnell scannen, sauber planen, ruhig ausführen."
          rightSlot={
            <div className="cal-header__right-stack">
              <WorkScopeBadge />
              <div className="cal-header__bar">
                <div className="cal-nav">
                  <button className="btn btn-soft" type="button" onClick={handleToday}>
                    Today
                  </button>
                  <button
                    className="btn btn-soft icon"
                    type="button"
                    onClick={handlePrev}
                    aria-label="Previous"
                  >
                    ←
                  </button>
                  <button className="btn btn-soft icon" type="button" onClick={handleNext} aria-label="Next">
                    →
                  </button>
                  <div className="cal-range">{rangeLabel}</div>
                </div>

                <div className="cal-actions">
                  <div className="seg seg--light">
                    <button
                      type="button"
                      className={view === "day" ? "seg__item is-active" : "seg__item"}
                      onClick={() => setView("day")}
                    >
                      Day
                    </button>
                    <button
                      type="button"
                      className={view === "week" ? "seg__item is-active" : "seg__item"}
                      onClick={() => setView("week")}
                    >
                      Week
                    </button>
                    <button
                      type="button"
                      className={view === "month" ? "seg__item is-active" : "seg__item"}
                      onClick={() => setView("month")}
                    >
                      Month
                    </button>
                  </div>
                  <button className="btn btn-primary" type="button" onClick={() => void refresh()}>
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          }
        />
      </header>

      {workspaceId && (
        <div className="calendar2035__provider-line">
          {calendarStatus === "ready" && (
            <p className="calendar2035__provider-tag">Connected provider: iCloud</p>
          )}
          {calendarStatus !== "ready" && (
            <button
              type="button"
              className="calendar2035__btn calendar2035__btn--primary"
              onClick={handleConnectCalendarClick}
            >
             Connect iCloud Calendar
            </button>
          )}
        </div>
      )}
      {workspaceId && (
        <div ref={calendarConnectRef}>
          <IcloudCalendarConnect
            workspaceId={workspaceId}
            connected={calendarStatus === "ready"}
            identityEmail={data?.user?.email ?? null}
            onSuccess={() => refreshCalendar().catch(() => undefined)}
          />
        </div>
      )}

      <div className="relative">
        <div className={cn(STAGE_SHELL, "mt-4 h-[calc(100vh-120px)] min-h-[560px]")}>
          <div className={cn(STAGE_INNER, "h-full overflow-hidden")}>
            <div className={cn(STAGE_GREY_READABLE, "h-full overflow-hidden")}>
              <div className="calendar2035__shell h-full">
                <div className="calendar2035__main">
                  <div className="calendar-main__status">
                    {isLoading && <div className="calendar2035__hint">Lade Termine...</div>}
            {error && <div className="calendar2035__error">{String(error)}</div>}
            {!isLoading && !error && eventsInRange.length === 0 && (
              <div className="calendar2035__empty">Heute ist frei. (Oder du hast nur private Busy-Blöcke.)</div>
            )}
          </div>

          {!isLoading && !error && (
            <div className={`calendar-container ${calendarModeClass}`}>
              {isMonthView ? renderMonthView() : renderTimelineView()}
            </div>
          )}
        </div>
        <aside className={cn("calendar2035__side", PANE_SCROLL)}>
          <div className="calendar2035__side-card">
            <section className="calendar2035__plan-bar">
              <div className="calendar2035__plan-row">
                <input
                  ref={planInputRef}
                  type="text"
                  className="calendar2035__plan-input"
                  placeholder="Was soll Merlin planen?"
                  value={planPrompt}
                  onChange={(event) => setPlanPrompt(event.currentTarget.value)}
                  aria-label="Merlin Plan prompt"
                />
                <button
                  type="button"
                  className="calendar2035__btn calendar2035__plan-submit"
                  onClick={handlePlanSubmit}
                  disabled={planDisabled}
                  title={planDisabled ? planDisabledReason || undefined : undefined}
                >
                  {planButtonLabel}
                </button>
              </div>
              <div className="calendar2035__plan-chips">
                {QUICK_PLAN_PROMPTS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className={`calendar2035__plan-chip ${planPrompt.trim() === chip ? "is-active" : ""}`}
                    onClick={() => handleChipClick(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              {planMessage && (
                <p className="calendar2035__plan-helper" aria-live="polite">
                  {planMessage}
                </p>
              )}
              <details className="calendar2035__plan-output">
                <summary className="calendar2035__plan-output-summary">
                  <span>Merlin Vorschlag</span>
                  <span className="calendar2035__plan-output-summary-state">
                    {pendingActionInfo ? pendingActionInfo.typeLabel : "Noch kein Vorschlag."}
                  </span>
                </summary>
                <div className="calendar2035__plan-output-body">
                  {pendingActionInfo ? (
                    <div className="calendar2035__plan-output-card">
                      <p className="calendar2035__plan-output-card-title">{pendingActionInfo.title}</p>
                      {pendingActionInfo.timeLabel && (
                        <p className="calendar2035__plan-output-card-time">{pendingActionInfo.timeLabel}</p>
                      )}
                      <div className="calendar2035__plan-output-actions">
                        <button
                          type="button"
                          className="calendar2035__btn calendar2035__btn--primary"
                          onClick={handleConfirmPending}
                        >
                          Vorschlag übernehmen
                        </button>
                        <button
                          type="button"
                          className="calendar2035__btn"
                          onClick={handleDismissPending}
                        >
                          Ablehnen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="calendar2035__plan-output-empty">Noch kein Vorschlag.</p>
                  )}
                </div>
              </details>
            </section>

            <section className="calendar2035__selection-panel">
              <header className="calendar2035__selection-head">
                <div>
                  <p className="calendar2035__selection-title">Selection</p>
                <p className="calendar2035__selection-sub">
                  {selected
                    ? "Actions, Prep & Follow-ups"
                    : selectedSlotHour !== null
                    ? "Slot reserviert · leg direkt los"
                    : "Wähle einen Event und starte Aktionen."}
                </p>
              </div>
              <span className="calendar2035__selection-state">
                {selected ? "Event aktiv" : selectedSlotHour !== null ? "Slot aktiv" : "Heute leer"}
              </span>
            </header>

              {selected ? (
                <div className="calendar2035__selection-active">
                  <div className="calendar2035__selection-active-head">
                    <p className="calendar2035__selection-active-title">
                      {selected.isPrivate ? "Busy" : selected.title}
                    </p>
                    <p className="calendar2035__selection-active-time">
                      {selected.allDay
                        ? "Ganztägig"
                        : `${formatTime(selected.start)} – ${formatTime(selected.end)}`}
                    </p>
                  </div>
                  {selected.location && (
                    <details className="calendar2035__selection-meta">
                      <summary>Location & Meet-Link</summary>
                      <div className="calendar2035__selection-meta-body">{selected.location}</div>
                    </details>
                  )}
                  <div className="calendar2035__selection-actions">
                    {["Verschieben", "Kürzen", "Prep-Block davor", "Follow-up Mail"].map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`calendar2035__selection-action ${
                          label === "Verschieben" ? "calendar2035__selection-action--primary" : ""
                        }`}
                        onClick={() => handleSelectionAction(label)}
                        disabled={!isConnected}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="calendar2035__selection-data">
                    <div>
                      <span>Zeit</span>
                      <strong>
                        {selected.allDay
                          ? "Ganztägig"
                          : `${formatDayHeader(selected.start)} · ${formatTime(selected.start)} – ${formatTime(
                              selected.end
                            )}`}
                      </strong>
                    </div>
                    {selectedDurationLabel && (
                      <div>
                        <span>Dauer</span>
                        <strong>{selectedDurationLabel}</strong>
                      </div>
                    )}
                    {selected.location && (
                      <div>
                        <span>Ort</span>
                        <strong>{selected.location}</strong>
                      </div>
                    )}
                    <div>
                      <span>Teilnehmer</span>
                      <strong>{selected.attendees?.length ? selected.attendees.length : "—"}</strong>
                    </div>
                  </div>
                </div>
              ) : selectedSlotHour !== null ? (
                <div className="calendar2035__selection-slot">
                  <div className="calendar2035__selection-slot-head">
                    <p className="calendar2035__selection-slot-time">{`${pad2(selectedSlotHour)}:00 – ${pad2(
                      (selectedSlotHour + 1) % 24
                    )}:00`}</p>
                    <p className="calendar2035__selection-slot-title">Stundenblock frei</p>
                  </div>
                  <div className="calendar2035__selection-slot-actions">
                    <button
                      type="button"
                      className="calendar2035__selection-action calendar2035__selection-action--primary"
                      onClick={handleFocusBlockAction}
                    >
                      Block anlegen
                    </button>
                    <button
                      type="button"
                      className="calendar2035__selection-action"
                      onClick={handleSlotMerlinSuggest}
                    >
                      Merlin Vorschlag
                    </button>
                  </div>
                  <p className="calendar2035__selection-slot-hint">
                    Slot reserviert, damit Merlin oder du gleich reagieren kannst.
                  </p>
                </div>
              ) : (
                <div className="calendar2035__selection-empty">
                  <div className="calendar2035__selection-empty-label">Heute</div>
                  {todaySnapshot ? (
                    <>
                      <p className="calendar2035__selection-empty-title">
                        {todaySnapshot.isPrivate ? "Busy" : todaySnapshot.title}
                      </p>
                      <p className="calendar2035__selection-empty-time">{formatTime(todaySnapshot.start)}</p>
                    </>
                  ) : (
                    <>
                      <p className="calendar2035__selection-empty-title">Freier Tag</p>
                      <p className="calendar2035__selection-empty-time">Keine Einträge</p>
                    </>
                  )}
                  <p className="calendar2035__selection-empty-hint">{todaySnapshotHint}</p>
                  <button
                    type="button"
                    className="calendar2035__selection-action calendar2035__selection-action--primary"
                    onClick={handleFocusBlockAction}
                  >
                    Fokusblock einplanen
                  </button>
                </div>
              )}
            </section>
          </div>
        </aside>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
