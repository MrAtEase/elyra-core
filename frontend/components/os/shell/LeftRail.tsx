"use client";

import type { ComponentType } from "react";
import {
  Mail,
  CalendarDays,
  ListChecks,
  FolderOpen,
  Monitor,
  BookOpen,
  Settings2,
} from "lucide-react";
import { APP_ORDER, APP_TITLES, type AppId } from "@/components/os/wm/windowTypes";

type LeftRailProps = {
  activeApp: AppId | null;
  onOpenApp: (appId: AppId) => void;
};

const ICONS: Record<AppId, ComponentType<{ size?: number }>> = {
  mail:     Mail,
  calendar: CalendarDays,
  tasks:    ListChecks,
  files:    FolderOpen,
  slides:   Monitor,
  docs:     BookOpen,
  settings: Settings2,
};

const ICON_COLORS: Record<AppId, string> = {
  mail:     "rgba(59,130,246,1)",
  calendar: "rgba(236,72,153,1)",
  tasks:    "rgba(168,85,247,1)",
  files:    "rgba(34,197,94,1)",
  slides:   "rgba(56,189,248,1)",
  docs:     "rgba(251,191,36,1)",
  settings: "rgba(148,163,184,1)",
};

const ICON_GLOW: Record<AppId, string> = {
  mail:     "rgba(59,130,246,0.25)",
  calendar: "rgba(236,72,153,0.25)",
  tasks:    "rgba(168,85,247,0.25)",
  files:    "rgba(34,197,94,0.25)",
  slides:   "rgba(56,189,248,0.25)",
  docs:     "rgba(251,191,36,0.25)",
  settings: "rgba(148,163,184,0.25)",
};

export default function LeftRail({ activeApp, onOpenApp }: LeftRailProps) {
  return (
    <>
      {/* Desktop: vertical left rail */}
      <nav
        className="fixed inset-y-0 left-0 z-[85] hidden w-[72px] flex-col items-center border-r border-white/8 pt-14 backdrop-blur-2xl sm:flex"
        style={{ background: "var(--os-panel-strong)" }}
      >
        <ul className="mt-4 flex flex-col items-center gap-1.5 px-2">
          {APP_ORDER.map((appId) => {
            const active = appId === activeApp;
            const Icon = ICONS[appId];
            const color = ICON_COLORS[appId];
            const glow = ICON_GLOW[appId];
            return (
              <li key={appId}>
                <button
                  type="button"
                  onClick={() => onOpenApp(appId)}
                  className="group flex w-full flex-col items-center gap-0.5"
                  aria-label={`Open ${APP_TITLES[appId]}`}
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200"
                    style={
                      active
                        ? {
                            background: `${color}18`,
                            border: `1px solid ${color}50`,
                            boxShadow: `0 0 16px ${glow}, inset 0 0 8px ${color}10`,
                            color,
                          }
                        : {
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid transparent",
                            color: "rgba(255,255,255,0.50)",
                          }
                    }
                  >
                    <Icon size={17} />
                  </span>
                  <span
                    className="text-[9px] tracking-wide transition-colors duration-200"
                    style={{ color: active ? "rgba(255,255,255,0.80)" : "rgba(255,255,255,0.38)" }}
                  >
                    {APP_TITLES[appId]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Bottom accent line for active app */}
        <div className="flex-1" />
        <div
          className="mb-4 h-0.5 w-8 rounded-full opacity-30 transition-all duration-300"
          style={{ background: activeApp ? ICON_COLORS[activeApp] : "transparent" }}
        />
      </nav>

      {/* Mobile: bottom app bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-[95] sm:hidden">
        <nav
          className="pointer-events-auto mx-3 rounded-2xl border border-white/10 p-2 backdrop-blur-2xl"
          style={{ background: "var(--os-panel-strong)" }}
        >
          <ul className="grid grid-cols-7 gap-1">
            {APP_ORDER.map((appId) => {
              const active = appId === activeApp;
              const Icon = ICONS[appId];
              const color = ICON_COLORS[appId];
              return (
                <li key={appId}>
                  <button
                    type="button"
                    onClick={() => onOpenApp(appId)}
                    className="flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition"
                    style={{
                      background: active ? `${color}1a` : "rgba(255,255,255,0.04)",
                    }}
                    aria-label={APP_TITLES[appId]}
                  >
                    <span style={{ color: active ? color : "rgba(255,255,255,0.55)" }}>
                      <Icon size={15} />
                    </span>
                    <span
                      className="text-[8px] tracking-wide"
                      style={{ color: active ? "rgba(255,255,255,0.80)" : "rgba(255,255,255,0.40)" }}
                    >
                      {APP_TITLES[appId]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
