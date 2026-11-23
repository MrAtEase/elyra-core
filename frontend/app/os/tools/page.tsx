import { Suspense } from "react";
import ToolboxWindow from "@/components/os/apps/toolbox/ToolboxWindow";

export default function OsToolsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Werkzeuge…</div>}>
      <ToolboxWindow />
    </Suspense>
  );
}
