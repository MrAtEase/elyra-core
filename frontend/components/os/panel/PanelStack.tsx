"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PanelStackProps = {
  children: ReactNode;
  className?: string;
};

export default function PanelStack({ children, className }: PanelStackProps) {
  return <div className={cn("min-h-0 flex-1 space-y-2 overflow-y-auto pr-1", className)}>{children}</div>;
}
