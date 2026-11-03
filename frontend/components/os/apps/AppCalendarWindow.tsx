"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Sparkles } from "lucide-react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function AppCalendarWindow() {
  const { calendarStatus, calendarEvents, refreshCalendar, createCalendarEvent, sendAssistantChatMessage } = useWorkspaceData();
  const [modalOpen, setModalOpen] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [end, setEnd] = useState(toLocalDateTimeInput(new Date(Date.now() + 25 * 60 * 60 * 1000)));

  useEffect(() => {
    void refreshCalendar();
  }, [refreshCalendar]);

  const agenda = useMemo(
    () =>
      [...calendarEvents]
        .sort((a, b) => Date.parse(a.start ?? "") - Date.parse(b.start ?? ""))
        .slice(0, 16),
    [calendarEvents]
  );

  const handleCreate = async () => {
    try {
      await createCalendarEvent({
        title: title.trim() || "Untitled event",
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
      setStatusText("Event created.");
      setTitle("");
      setModalOpen(false);
      void refreshCalendar();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to create event");
    }
  };

  const handleScheduleWithElyra = async () => {
    setStatusText("Scheduling with Elyra...");
    try {
      await sendAssistantChatMessage("Schedule a 45-minute focus session tomorrow at 11:00 and propose alternatives if busy.");
      setStatusText("Elyra created a scheduling proposal. Review and confirm.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unable to schedule with Elyra");
    }
  };

  if (calendarStatus !== "ready") {
    return (
      <section className="h-full p-5 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-white/45">Calendar Setup</p>
        <h2 className="mt-2 text-lg font-semibold">Connect Calendar</h2>
        <p className="mt-2 text-sm text-white/70">
          {calendarStatus === "not_connected"
            ? "Calendar is not connected yet. This is a first-run setup state."
            : calendarStatus === "loading"
            ? "Checking calendar connection..."
            : "Calendar access is limited for this workspace."}
        </p>
      </section>
    );
  }

  return (
    <section className="relative h-full p-5 text-white">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/45">Upcoming</p>
          <h2 className="text-lg font-semibold">Calendar</h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleScheduleWithElyra}
            className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm"
          >
            <Sparkles size={14} /> Schedule with Elyra
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-cyan-300/45 bg-cyan-300/20 px-3 py-2 text-sm font-semibold text-cyan-50"
          >
            <CalendarPlus size={14} /> Create event
          </button>
        </div>
      </div>

      <div className="grid max-h-[calc(100%-80px)] gap-2 overflow-auto pr-1">
        {agenda.length === 0 ? <p className="text-sm text-white/65">No upcoming events.</p> : null}
        {agenda.map((event) => (
          <article key={event.id} className="rounded-lg border border-white/12 bg-white/[0.03] p-3">
            <p className="text-sm font-semibold">{event.title || "Untitled event"}</p>
            <p className="text-xs text-white/70">
              {event.start ? new Date(event.start).toLocaleString() : "No start"}{event.end ? ` - ${new Date(event.end).toLocaleString()}` : ""}
            </p>
            <p className="mt-1 text-xs text-white/45">Source: {event.source || "primary"}</p>
          </article>
        ))}
      </div>

      {modalOpen ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#090d16] p-4">
            <h3 className="mb-3 text-base font-semibold">Create Event</h3>
            <div className="grid gap-2">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title"
                className="rounded-md border border-white/12 bg-black/25 px-3 py-2 text-sm outline-none"
              />
              <input
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="rounded-md border border-white/12 bg-black/25 px-3 py-2 text-sm outline-none"
              />
              <input
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="rounded-md border border-white/12 bg-black/25 px-3 py-2 text-sm outline-none"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-white/12 px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                className="rounded-md border border-cyan-300/45 bg-cyan-300/20 px-3 py-2 text-sm font-semibold text-cyan-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {statusText ? <p className="mt-3 text-xs text-white/65">{statusText}</p> : null}
    </section>
  );
}
