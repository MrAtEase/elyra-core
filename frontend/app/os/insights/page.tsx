import { Suspense } from "react";
import InsightsWindow from "@/components/os/apps/insights/InsightsWindow";

export default function OsInsightsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade KI-Newsletter-Digest…</div>}>
      <InsightsWindow />
    </Suspense>
  );
}
