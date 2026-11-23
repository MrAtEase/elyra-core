import { Suspense } from "react";
import VisibilityWindow from "@/components/os/apps/visibility/VisibilityWindow";

export default function OsVisibilityPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade KI-Sichtbarkeit…</div>}>
      <VisibilityWindow />
    </Suspense>
  );
}
