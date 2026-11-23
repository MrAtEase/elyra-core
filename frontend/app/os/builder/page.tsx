import { Suspense } from "react";
import BuilderWindow from "@/components/os/apps/builder/BuilderWindow";

export default function OsBuilderPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Builder…</div>}>
      <BuilderWindow />
    </Suspense>
  );
}
