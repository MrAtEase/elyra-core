import { Suspense } from "react";
import MagicWindow from "@/components/os/apps/magic/MagicWindow";

export default function OsMagicPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Kartenmagie…</div>}>
      <MagicWindow />
    </Suspense>
  );
}
