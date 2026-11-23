"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PanelTabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

type PanelTabsProps = {
  items: PanelTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
};

export default function PanelTabs({ items, activeId, onSelect, className }: PanelTabsProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-soft)] p-1", className)}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition",
              active
                ? "border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-secondary)] hover:bg-[var(--panel)]",
            )}
            aria-pressed={active}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
