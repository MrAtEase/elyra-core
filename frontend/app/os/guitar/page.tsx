import { Suspense } from "react";
import GuitarWindow from "@/components/os/apps/guitar/GuitarWindow";

export default function OsGuitarPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Gitarre…</div>}>
      <GuitarWindow />
    </Suspense>
  );
}
