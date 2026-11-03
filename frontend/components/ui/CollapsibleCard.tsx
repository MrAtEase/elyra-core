"use client";

import type { ReactNode } from "react";

type CollapsibleCardProps = {
  id: string;
  title: string;
  kicker?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export default function CollapsibleCard({
  id,
  title,
  kicker,
  badge,
  defaultOpen,
  children,
}: CollapsibleCardProps) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="space-y-3 rounded-3xl border border-border/60 bg-background/70 p-5 shadow-sm"
    >
      <summary className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
        <div className="space-y-1">
          {kicker ? (
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{kicker}</p>
          ) : null}
          <p className="text-lg font-semibold">{title}</p>
        </div>
        {badge ? (
          typeof badge === "string" ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              {badge}
            </span>
          ) : (
            badge
          )
        ) : null}
      </summary>
      <div className="space-y-4">{children}</div>
    </details>
  );
}
