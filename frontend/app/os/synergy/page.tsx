import { Suspense } from "react";
import SynergyWindow from "@/components/os/apps/synergy/SynergyWindow";

export default function OsSynergyPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Paid-Organic-Synergie…</div>}>
      <SynergyWindow />
    </Suspense>
  );
}
