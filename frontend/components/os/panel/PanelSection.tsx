"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type PanelSectionProps = {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  headerActions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export default function PanelSection({
  id,
  title,
  open,
  onToggle,
  headerActions,
  children,
  className,
}: PanelSectionProps) {
  return (
    <section id={id} className={cn("rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] p-2", className)}>
      <div className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"
          aria-expanded={open}
          aria-controls={`${id}-content`}
        >
          {title}
        </button>
        <div className="inline-flex items-center gap-1">
          {headerActions}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-[var(--border)] bg-[var(--panel2)] p-0.5 text-[var(--muted)]"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          >
            <ChevronDown size={14} className={cn("transition", open ? "rotate-180" : "")} />
          </button>
        </div>
      </div>
      {open ? (
        <div id={`${id}-content`} className="mt-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}
