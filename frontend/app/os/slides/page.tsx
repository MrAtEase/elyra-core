import { Suspense } from "react";
import SlidesWindow from "@/components/os/apps/slides/SlidesWindow";

export default function OsSlidesPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Slides…</div>}>
      <SlidesWindow />
    </Suspense>
  );
}
