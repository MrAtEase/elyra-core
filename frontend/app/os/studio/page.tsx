import { Suspense } from "react";
import StudioWindow from "@/components/os/apps/studio/StudioWindow";

export default function OsStudioPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Studio…</div>}>
      <StudioWindow />
    </Suspense>
  );
}
