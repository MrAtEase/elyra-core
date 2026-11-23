import { Suspense } from "react";
import MarketplaceWindow from "@/components/os/apps/marketplace/MarketplaceWindow";

export default function OsMarketplacePage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Marktplatz…</div>}>
      <MarketplaceWindow />
    </Suspense>
  );
}
