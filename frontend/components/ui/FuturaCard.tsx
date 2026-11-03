"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type FuturaTone = "default" | "focus" | "warn" | "error";

export type FuturaCardStatus = {
  level: "ok" | "attention" | "critical" | "info";
  label: string;
  icon?: ReactNode;
};

export type FuturaCardProps = {
  title: string;
  kicker?: string;
  tone?: FuturaTone;
  status?: FuturaCardStatus;
  hideHeader?: boolean;
  isExpandable?: boolean;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  hasOverlayContent?: boolean;
  className?: string;
  children: ReactNode;
};

export function FuturaCard({
  title,
  kicker,
  tone = "default",
  status,
  hideHeader = false,
  isExpandable = false,
  isExpanded = false,
  onExpandToggle,
  hasOverlayContent = false,
  className = "",
  children,
}: FuturaCardProps) {
  const wrapperClass = cn(
    "futura-card",
    className,
    hasOverlayContent ? "relative overflow-hidden" : ""
  );

  return (
    <div className={wrapperClass} data-tone={tone}>
      {!hideHeader && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {kicker && (
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-muted-foreground">
                {kicker}
              </p>
            )}
            <p className="text-lg font-semibold text-foreground">{title}</p>
          </div>
          {status && (
            <div className="flex flex-col items-end text-xs uppercase tracking-wider text-muted-foreground">
              <span>{status.label}</span>
              {status.icon && (
                <span className="mt-1 text-foreground">{status.icon}</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {children}
      </div>

      {isExpandable && onExpandToggle && (
        <button
          type="button"
          className="mt-4 w-full rounded-md border border-border bg-background/70 py-2 text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground transition hover:border-foreground hover:text-foreground"
          onClick={onExpandToggle}
        >
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}
