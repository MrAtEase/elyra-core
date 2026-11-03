"use client";

import dynamic from "next/dynamic";

type CalendarWindowProps = {
  windowId?: string;
};

const CalendarApp = dynamic(() => import("@/components/os/apps/calendar/CalendarApp"), {
  loading: () => (
    <div className="grid h-full gap-3 p-4 lg:grid-cols-[256px_minmax(0,1fr)]">
      <div className="rounded-2xl bg-white/[0.04]" />
      <div className="rounded-2xl bg-white/[0.04]" />
    </div>
  ),
});

export default function CalendarWindow(_props: CalendarWindowProps) {
  return <CalendarApp />;
}
