"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ElyraPanelProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export default function ElyraPanel({ title, children, className }: ElyraPanelProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-[color:var(--elyra-border)] bg-[color:var(--elyra-panel)] p-3",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--elyra-muted)]">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

