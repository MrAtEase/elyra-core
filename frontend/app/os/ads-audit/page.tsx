import { Suspense } from "react";
import AdsAuditWindow from "@/components/os/apps/ads-audit/AdsAuditWindow";

export default function OsAdsAuditPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Ads Audit…</div>}>
      <AdsAuditWindow />
    </Suspense>
  );
}
