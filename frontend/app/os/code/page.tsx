import { Suspense } from "react";
import CodingAgentWindow from "@/components/os/apps/code/CodingAgentWindow";

export default function OsCodePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-white/30">
          Loading Coder…
        </div>
      }
    >
      <CodingAgentWindow />
    </Suspense>
  );
}
