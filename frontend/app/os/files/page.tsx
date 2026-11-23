import { Suspense } from "react";
import FilesWindow from "@/components/os/apps/files/FilesWindow";

export default function OsFilesPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Files…</div>}>
      <FilesWindow />
    </Suspense>
  );
}
