"use client";

import dynamic from "next/dynamic";

type MailWindowProps = {
  windowId?: string;
};

const MailApp = dynamic(() => import("@/components/os/apps/mail/MailApp"), {
  loading: () => (
    <div className="flex h-full flex-col gap-3 rounded-[12px] border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
      <div className="grid h-full gap-3 lg:grid-cols-[210px_360px_minmax(0,1fr)]">
        <div className="hidden rounded-2xl bg-[color:var(--bg-surface)] lg:block" />
        <div className="rounded-2xl bg-[color:var(--bg-surface)]" />
        <div className="rounded-2xl bg-[color:var(--bg-surface)]" />
      </div>
    </div>
  ),
});

export default function MailWindow(_props: MailWindowProps) {
  return <MailApp />;
}
