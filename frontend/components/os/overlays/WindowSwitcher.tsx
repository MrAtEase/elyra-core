"use client";

import type { WindowInstance } from "@/components/os/windowing/windowTypes";

type WindowSwitcherProps = {
  open: boolean;
  windows: WindowInstance[];
  activeWindowId: string | null;
};

export default function WindowSwitcher({ open, windows, activeWindowId }: WindowSwitcherProps) {
  if (!open) return null;

  const visible = windows.filter((item) => !item.minimized).sort((a, b) => b.z - a.z);

  return (
    <div className="pointer-events-none fixed inset-0 z-[180] grid place-items-center bg-black/35">
      <div className="w-[min(540px,calc(100vw-24px))] rounded-2xl border border-white/15 bg-[#0a0f19]/90 p-3 shadow-2xl backdrop-blur-xl">
        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/50">Window Switcher</p>
        <div className="grid gap-1">
          {visible.map((win) => (
            <div
              key={win.id}
              className={`rounded-lg border px-3 py-2 text-sm ${
                win.id === activeWindowId
                  ? "border-cyan-300/50 bg-cyan-300/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/75"
              }`}
            >
              {win.title}
            </div>
          ))}
          {visible.length === 0 ? <p className="text-sm text-white/60">No open windows.</p> : null}
        </div>
      </div>
    </div>
  );
}
