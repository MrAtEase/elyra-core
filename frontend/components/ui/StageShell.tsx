"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { STAGE_SHELL } from "@/lib/ui/surfaces";

type StageShellProps = {
  children: ReactNode;
  className?: string;
};

export default function StageShell({ children, className }: StageShellProps) {
  return (
    <div
      className={cn(
        STAGE_SHELL,
        "transition duration-200 dark:border-white/5 dark:bg-slate-900/40",
        "p-6 sm:p-8",
        className
      )}
    >
      {children}
    </div>
  );
}
