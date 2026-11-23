"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelListItemProps = {
  active?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
  tabIndex?: number;
  currentAria?: "page" | "step" | "location" | "date" | "time" | boolean;
  selected?: boolean;
};

export default function PanelListItem({
  active = false,
  disabled = false,
  leading,
  title,
  meta,
  trailing,
  children,
  onClick,
  className,
  tabIndex,
  currentAria,
  selected,
}: PanelListItemProps) {
  const isInteractive = !disabled && (!!onClick || tabIndex !== undefined);
  // Use a semantic <button> for every interactive item so Enter/Space work
  // natively — no manual onKeyDown wiring needed.
  const Comp = isInteractive ? "button" : "div";
  const ariaCurrent = active ? (currentAria === true ? "page" : currentAria ?? undefined) : undefined;

  return (
    <Comp
      type={isInteractive ? "button" : undefined}
      onClick={disabled ? undefined : onClick}
      tabIndex={disabled ? -1 : tabIndex}
      aria-current={ariaCurrent}
      aria-disabled={disabled || undefined}
      aria-selected={selected}
      disabled={isInteractive ? disabled : undefined}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left",
        isInteractive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-offset-1 hover:bg-[var(--panel-soft)]",
        active && "border border-[var(--border)] bg-[var(--panel)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading ? <span className="shrink-0">{leading}</span> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center truncate text-xs text-[var(--text)]">{title}</span>
          {children ? <div className="min-w-0 text-[11px] text-[var(--muted)]">{children}</div> : null}
        </div>
        {meta ? <span className="truncate text-[11px] text-[var(--muted)]">{meta}</span> : null}
      </div>
      {trailing ? <span className="shrink-0 text-[10px] text-[var(--muted)]">{trailing}</span> : null}
    </Comp>
  );
}
