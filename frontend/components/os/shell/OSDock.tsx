"use client";

import { useWindows } from "@/components/os/windowing/useWindows";
import { DOCK_APPS } from "@/components/os/apps/registry";

export default function OSDock() {
  const { windows, openApp, restoreWindow } = useWindows();
  const minimized = windows.filter((w) => w.minimized);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-14 z-[170] flex justify-center sm:bottom-16">
      <nav className="pointer-events-auto flex items-end gap-2 rounded-2xl border border-white/12 bg-[#080b14]/85 px-3 py-2.5 shadow-[0_16px_48px_rgba(2,4,10,0.6)] backdrop-blur-xl">
        {DOCK_APPS.map((app) => {
          const isOpen = windows.some((w) => w.appId === app.id && !w.minimized);
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => openApp(app.id)}
              aria-label={`Open ${app.label}`}
              className="group relative flex flex-col items-center gap-1"
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-semibold transition-transform group-hover:scale-110 ${
                  isOpen
                    ? "border-white/20 bg-white/[0.1]"
                    : "border-white/10 bg-white/[0.04] group-hover:bg-white/[0.08]"
                }`}
                style={{ color: app.color }}
              >
                {app.monogram}
              </div>
              <span className="hidden text-[9px] text-white/40 sm:block">{app.label}</span>
              {isOpen ? (
                <div className="absolute -bottom-0.5 h-[3px] w-[3px] rounded-full bg-white/50 sm:-bottom-1" />
              ) : null}
            </button>
          );
        })}

        {minimized.length > 0 ? (
          <>
            <div className="mx-1 h-8 w-px bg-white/12" aria-hidden="true" />
            {minimized.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => restoreWindow(w.id)}
                className="flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-white/50 hover:bg-white/[0.08]"
              >
                {w.title}
              </button>
            ))}
          </>
        ) : null}
      </nav>
    </div>
  );
}
