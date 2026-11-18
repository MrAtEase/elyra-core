import { Suspense } from "react";
import LanguagesWindow from "@/components/os/apps/languages/LanguagesWindow";

export default function OsLanguagesPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Sprachen…</div>}>
      <LanguagesWindow />
    </Suspense>
  );
}
