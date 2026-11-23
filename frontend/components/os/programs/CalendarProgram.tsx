"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { Badge, Button, ConfirmModal, Toast } from "@/components/os/primitives";

function toIsoLocal(date: Date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

type DraftEvent = {
  id?: string;
  title: string;
  start: string;
  end: string;
  attendees: string;
};

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const quickPrompts = ["Weekly sync", "Focus block", "Client review", "1:1 Meeting"];

// Event colour palette (cycles through index)
const EVENT_COLORS = [
  { bg: "rgba(99,102,241,0.18)", border: "rgba(99,102,241,0.5)", text: "rgba(165,180,252,1)" },
  { bg: "rgba(236,72,153,0.18)", border: "rgba(236,72,153,0.5)", text: "rgba(249,168,212,1)" },
  { bg: "rgba(34,197,94,0.18)",  border: "rgba(34,197,94,0.5)",  text: "rgba(134,239,172,1)" },
  { bg: "rgba(251,191,36,0.18)", border: "rgba(251,191,36,0.5)", text: "rgba(253,224,132,1)" },
  { bg: "rgba(56,189,248,0.18)", border: "rgba(56,189,248,0.5)", text: "rgba(125,211,252,1)" },
];

function buildMonthCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset
  const startOffset = (firstDay + 6) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarProgram() {
  const pathname = usePathname() ?? "";
  const slug = pathname.startsWith("/w/") ? pathname.split("/")[2] ?? "active" : "active";
  const {
    calendarStatus,
    calendarEvents,
    refreshCalendar,
    createCalendarEvent,
    updateCalendarEvent,
  } = useWorkspaceData();

  const isConnected = calendarStatus === "ready";

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [showForm, setShowForm] = useState(false);

  const [draft, setDraft] = useState<DraftEvent>({
    title: "",
    start: toIsoLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    end: toIsoLocal(new Date(Date.now() + 25 * 60 * 60 * 1000)),
    attendees: "",
  });
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected) void refreshCalendar();
  }, [isConnected, refreshCalendar]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  // Events grouped by day of month (current view month only)
  const eventsByDay = useMemo(() => {
    const map: Record<number, typeof calendarEvents> = {};
    for (const evt of calendarEvents) {
      if (!evt.start) continue;
      const d = new Date(evt.start);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        (map[day] ??= []).push(evt);
      }
    }
    return map;
  }, [calendarEvents, viewYear, viewMonth]);

  const selectedEvents = useMemo(
    () => (selectedDay ? (eventsByDay[selectedDay] ?? []) : []),
    [eventsByDay, selectedDay],
  );

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const createOrUpdate = async () => {
    setConfirmOpen(false);
    const startIso = new Date(draft.start).toISOString();
    const endIso = new Date(draft.end).toISOString();
    try {
      if (editingEventId) {
        await updateCalendarEvent(editingEventId, {
          title: draft.title.trim() || "Untitled event",
          start: startIso,
          end: endIso,
        });
        setToast("Event updated.");
      } else {
        await createCalendarEvent({
          title: draft.title.trim() || "Untitled event",
          start: startIso,
          end: endIso,
        });
        setToast("Event created.");
      }
      setDraft((prev) => ({ ...prev, title: "", attendees: "" }));
      setEditingEventId(null);
      setShowForm(false);
      void refreshCalendar();
      window.setTimeout(() => setToast(null), 2400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save event";
      setToast(message);
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--bg-canvas)" }}
    >
      {/* ── Connect banner (only shown when not connected) ── */}
      {!isConnected && (
        <div
          className="flex shrink-0 items-center gap-3 border-b px-5 py-2.5"
          style={{
            borderColor: "var(--os-border-faint)",
            background: "rgba(99,102,241,0.08)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--text-secondary)", flex: 1 }}>
            Verbinde Google Calendar, Outlook oder CalDAV um echte Termine zu sehen.
          </span>
          <Link href={`/w/${slug}/marketplace`}>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:opacity-90"
              style={{ background: "var(--os-accent)", color: "#fff" }}
            >
              Verbinden
            </button>
          </Link>
        </div>
      )}

      {/* ── Main layout: calendar grid + detail panel ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: month grid */}
        <div
          className="flex w-[300px] shrink-0 flex-col border-r"
          style={{ borderColor: "var(--os-border-faint)" }}
        >
          {/* Month navigation */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--os-border-faint)" }}
          >
            <button
              type="button"
              onClick={prevMonth}
              className="rounded-lg p-1 transition hover:bg-white/8"
              style={{ color: "var(--text-secondary)" }}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="rounded-lg p-1 transition hover:bg-white/8"
              style={{ color: "var(--text-secondary)" }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 px-3 pt-3">
            {DAY_NAMES.map((d) => (
              <div
                key={d}
                className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5 px-3 pb-3">
            {cells.map((day, i) => {
              const isToday =
                day === today.getDate() &&
                viewMonth === today.getMonth() &&
                viewYear === today.getFullYear();
              const isSelected = day === selectedDay;
              const hasEvents = day !== null && (eventsByDay[day]?.length ?? 0) > 0;

              return (
                <button
                  key={i}
                  type="button"
                  disabled={day === null}
                  onClick={() => day !== null && setSelectedDay(day)}
                  className="relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs transition"
                  style={{
                    background: isToday
                      ? "var(--os-accent)"
                      : isSelected
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    color: isToday
                      ? "#fff"
                      : day !== null
                        ? "var(--text-primary)"
                        : "transparent",
                    fontWeight: isToday || isSelected ? 600 : 400,
                    cursor: day !== null ? "pointer" : "default",
                  }}
                >
                  {day}
                  {hasEvents && !isToday && (
                    <span
                      className="absolute bottom-0.5 h-1 w-1 rounded-full"
                      style={{ background: "var(--os-accent)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick action */}
          <div className="mt-auto border-t px-3 py-3" style={{ borderColor: "var(--os-border-faint)" }}>
            <button
              type="button"
              onClick={() => setShowForm((prev) => !prev)}
              className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-xs transition hover:bg-white/5"
              style={{
                borderColor: "var(--os-border-faint)",
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
            >
              <Plus size={12} />
              Neues Event erstellen
            </button>
          </div>
        </div>

        {/* Right: day detail / event list / form */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          {showForm ? (
            /* ── Create / Edit form ── */
            <div className="mx-auto w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                  {editingEventId ? "Event bearbeiten" : "Neues Event"}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg px-2 py-1 text-xs transition hover:bg-white/8"
                  style={{ color: "var(--text-muted)" }}
                >
                  Abbrechen
                </button>
              </div>

              {/* Quick prompt chips */}
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, title: prompt }))}
                    className="rounded-full border px-3 py-1 text-xs transition hover:bg-white/8"
                    style={{
                      borderColor: "var(--os-border-faint)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {[
                { label: "Titel", key: "title", type: "text", placeholder: "Event title..." },
                { label: "Start", key: "start", type: "datetime-local", placeholder: "" },
                { label: "Ende", key: "end", type: "datetime-local", placeholder: "" },
                { label: "Teilnehmer (kommasepariert)", key: "attendees", type: "text", placeholder: "email@..." },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </label>
                  <input
                    type={type}
                    value={draft[key as keyof DraftEvent] ?? ""}
                    placeholder={placeholder}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[color:var(--os-accent)]"
                    style={{
                      background: "var(--bg-elevated)",
                      borderColor: "var(--os-border-faint)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  if (!isConnected) {
                    setToast("Bitte zuerst Google Calendar verbinden.");
                    window.setTimeout(() => setToast(null), 2400);
                    return;
                  }
                  setConfirmOpen(true);
                }}
                className="w-full rounded-xl py-2.5 text-sm font-semibold transition hover:opacity-90"
                style={{ background: "var(--os-accent)", color: "#fff" }}
              >
                {editingEventId ? "Aktualisieren" : "Event erstellen"}
              </button>
            </div>
          ) : selectedDay !== null ? (
            /* ── Selected day events ── */
            <div className="space-y-4">
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {selectedDay}. {MONTH_NAMES[viewMonth]} {viewYear}
              </h3>

              {selectedEvents.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center rounded-2xl border py-12 text-center"
                  style={{
                    borderColor: "var(--os-border-faint)",
                    borderStyle: "dashed",
                  }}
                >
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {isConnected ? "Keine Events an diesem Tag" : "Kalender verbinden um Events zu sehen"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowForm(true)}
                    className="mt-3 rounded-lg px-3 py-1.5 text-xs transition hover:bg-white/8"
                    style={{ color: "var(--os-accent)" }}
                  >
                    + Neues Event
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((event, idx) => {
                    const col = EVENT_COLORS[idx % EVENT_COLORS.length]!;
                    return (
                      <article
                        key={event.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border p-4"
                        style={{
                          background: col.bg,
                          borderColor: col.border,
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate" style={{ color: col.text }}>
                            {event.title || "Untitled"}
                          </p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                            {event.start ? new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                            {event.end ? ` – ${new Date(event.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                          </p>
                          {event.source && (
                            <Badge tone="neutral" className="mt-1.5 text-[10px]">
                              {event.source}
                            </Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const start = event.start ? new Date(event.start) : new Date();
                            const end = event.end
                              ? new Date(event.end)
                              : new Date(start.getTime() + 45 * 60000);
                            setEditingEventId(event.id);
                            setDraft({
                              id: event.id,
                              title: event.title,
                              start: toIsoLocal(start),
                              end: toIsoLocal(end),
                              attendees: "",
                            });
                            setShowForm(true);
                          }}
                        >
                          Bearbeiten
                        </Button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center"
              style={{ color: "var(--text-muted)" }}
            >
              <p className="text-sm">Wähle einen Tag aus</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={editingEventId ? "Event aktualisieren?" : "Event erstellen?"}
        message={`${draft.title || "Untitled event"} am ${new Date(draft.start).toLocaleString("de-DE", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={createOrUpdate}
      />
      <Toast message={toast} />
    </div>
  );
}

export function ListCalendar({ name }: { name: string }) {
  return (
    <article className="ec-list-row" role="listitem" aria-label={`Calendar ${name}`}>
      <span>
        <strong>{name}</strong>
        <small>Connected and available for orchestration</small>
      </span>
      <Badge tone="accent">Active</Badge>
    </article>
  );
}
