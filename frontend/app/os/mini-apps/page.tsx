import { Suspense } from "react";
import MiniAppsWindow from "@/components/os/apps/marketplace/MiniAppsWindow";

export default function OsMiniAppsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Mini-Apps…</div>}>
      <MiniAppsWindow />
    </Suspense>
  );
}
