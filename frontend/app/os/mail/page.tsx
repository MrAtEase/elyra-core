import { Suspense } from "react";
import MailWindow from "@/components/os/apps/mail/MailWindow";

export default function OsMailPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Mail…</div>}>
      <MailWindow />
    </Suspense>
  );
}
