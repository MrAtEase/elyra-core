import { Suspense } from "react";
import CalendarWindow from "@/components/os/apps/calendar/CalendarWindow";

export default function OsCalendarPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Calendar…</div>}>
      <CalendarWindow />
    </Suspense>
  );
}
