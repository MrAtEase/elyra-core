import { Suspense } from "react";
import LeadsWindow from "@/components/os/apps/leads/LeadsWindow";

export default function OsLeadsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Leads…</div>}>
      <LeadsWindow />
    </Suspense>
  );
}
