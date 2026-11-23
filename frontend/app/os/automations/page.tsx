import { Suspense } from "react";
import AutomationsWindow from "@/components/os/apps/automations/AutomationsWindow";

export default function OsAutomationsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Automationen (n8n)…</div>}>
      <AutomationsWindow />
    </Suspense>
  );
}
