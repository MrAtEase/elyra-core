"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ElyraCardProps = {
  children: ReactNode;
  variant?: "default" | "subtle" | "interactive";
  className?: string;
  onClick?: () => void;
};

export default function ElyraCard({
  children,
  variant = "default",
  className,
  onClick,
}: ElyraCardProps) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border border-[color:var(--elyra-border)] p-4 text-left",
        variant === "default" ? "bg-[color:var(--elyra-panel)]" : "",
        variant === "subtle" ? "bg-[color:var(--elyra-panel-2)]" : "",
        variant === "interactive"
          ? "bg-[color:var(--elyra-panel)] transition hover:bg-[color:var(--elyra-panel-hover)]"
          : "",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

