"use client";

import { useMemo, useState } from "react";

type CalEvent = {
  id: string;
  title: string;
  time: string;
  duration: string;
  color: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const TODAY_EVENTS: CalEvent[] = [
  { id: "e1", title: "Standup", time: "9:00", duration: "15 min", color: "rgba(56, 189, 248, 0.6)" },
  { id: "e2", title: "Design Review", time: "10:30", duration: "45 min", color: "rgba(168, 85, 247, 0.6)" },
  { id: "e3", title: "Lunch with Team", time: "12:00", duration: "1 hr", color: "rgba(34, 197, 94, 0.5)" },
  { id: "e4", title: "Sprint Planning", time: "14:00", duration: "1 hr", color: "rgba(251, 146, 60, 0.6)" },
  { id: "e5", title: "1:1 with Sarah", time: "16:00", duration: "30 min", color: "rgba(236, 72, 153, 0.5)" },
];

export default function CalendarApp() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const monthName = new Date(year, month).toLocaleString("en", { month: "long" });

  const grid = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfWeek(year, month);
    const cells: Array<number | null> = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [year, month]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const isToday = (day: number | null) =>
    day !== null && year === now.getFullYear() && month === now.getMonth() && day === now.getDate();

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_240px] text-white">
      <section className="border-r border-white/10 p-4 overflow-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {monthName} {year}
          </h2>
          <div className="flex gap-1">
            <button type="button" onClick={prevMonth} className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/[0.06]">
              &larr;
            </button>
            <button type="button" onClick={nextMonth} className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/[0.06]">
              &rarr;
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px">
          {DAYS.map((d) => (
            <div key={d} className="pb-2 text-center text-[10px] font-medium uppercase tracking-wider text-white/35">
              {d}
            </div>
          ))}
          {grid.map((day, i) => (
            <div
              key={i}
              className={`flex h-12 items-start justify-center pt-1 text-xs ${
                day === null ? "" : "rounded-md hover:bg-white/[0.04]"
              } ${isToday(day) ? "bg-white/[0.08] font-semibold text-cyan-300" : "text-white/70"}`}
            >
              {day}
            </div>
          ))}
        </div>
      </section>

      <section className="p-4 overflow-auto">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
          Today&apos;s Agenda
        </p>
        <div className="grid gap-2">
          {TODAY_EVENTS.map((evt) => (
            <div key={evt.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ background: evt.color }} />
                <p className="text-[13px] font-medium">{evt.title}</p>
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                {evt.time} &middot; {evt.duration}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
