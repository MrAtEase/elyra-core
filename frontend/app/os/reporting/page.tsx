import { Suspense } from "react";
import ReportingWindow from "@/components/os/apps/reporting/ReportingWindow";

export default function OsReportingPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Reporting…</div>}>
      <ReportingWindow />
    </Suspense>
  );
}
