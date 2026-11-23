"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ElyraPageShellProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  variant?: "surface" | "system" | "modal";
  dense?: boolean;
  scroll?: "content" | "page";
  className?: string;
};

export default function ElyraPageShell({
  title,
  subtitle,
  actions,
  children,
  variant = "surface",
  dense = false,
  scroll = "content",
  className,
}: ElyraPageShellProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[color:var(--elyra-border)] bg-[color:var(--elyra-panel)]",
        variant === "system" ? "bg-[color:var(--elyra-panel-2)]" : "",
        dense ? "p-4" : "p-6",
        scroll === "content" ? "min-h-0 overflow-hidden" : "",
        className,
      )}
      data-elyra-page-shell="true"
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-semibold leading-[1.3] text-[color:var(--elyra-text)]">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-[13px] leading-[1.5] text-[color:var(--elyra-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className={cn(scroll === "content" ? "min-h-0 overflow-auto" : "")}>{children}</div>
    </section>
  );
}

