"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ElyraListRowProps = {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
};

export default function ElyraListRow({
  leading,
  title,
  meta,
  trailing,
  onClick,
  className,
}: ElyraListRowProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border border-[color:var(--elyra-border)] bg-[color:var(--elyra-panel)] px-3 py-2 text-left",
        onClick ? "transition hover:bg-[color:var(--elyra-panel-hover)]" : "",
        className,
      )}
    >
      {leading ? <div className="mt-0.5 shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-[color:var(--elyra-text)]">{title}</div>
        {meta ? <div className="mt-0.5 truncate text-[12px] text-[color:var(--elyra-muted)]">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0 text-[12px] text-[color:var(--elyra-muted)]">{trailing}</div> : null}
    </Comp>
  );
}

