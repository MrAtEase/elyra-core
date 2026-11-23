import { Suspense } from "react";
import FeedWindow from "@/components/os/apps/feed/FeedWindow";

export default function OsFeedPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Feed-Optimierer…</div>}>
      <FeedWindow />
    </Suspense>
  );
}
