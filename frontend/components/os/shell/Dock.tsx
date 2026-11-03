"use client";

import type { ComponentType } from "react";
import {
  AppWindow,
  CalendarDays,
  CheckSquare,
  Cloud,
  Code2,
  FileText,
  Mail,
  Network,
  Settings,
  Shield,
  Sparkles,
  Wand2,
  Wrench,
} from "lucide-react";
import type { AppId, AppManifest } from "@/components/os/kernel/types";

type DockProps = {
  apps: AppManifest[];
  activeAppIds: AppId[];
  accent: string;
  rightInset?: number;
  onOpenApp: (appId: AppId) => void;
};

export default function Dock({ apps, activeAppIds, accent, rightInset = 0, onOpenApp }: DockProps) {
  const activeSet = new Set(activeAppIds);
  const appColor: Record<AppId, string> = {
    mail: "color-mix(in srgb, #3b82f6 18%, var(--bg-surface))",
    calendar: "color-mix(in srgb, #ec4899 16%, var(--bg-surface))",
    tasks: "color-mix(in srgb, #8b5cf6 16%, var(--bg-surface))",
    files: "color-mix(in srgb, #22c55e 16%, var(--bg-surface))",
    graph: "color-mix(in srgb, #14b8a6 18%, var(--bg-surface))",
    builder: "color-mix(in srgb, #d97706 16%, var(--bg-surface))",
    slides: "color-mix(in srgb, #0ea5e9 16%, var(--bg-surface))",
    studio: "color-mix(in srgb, #a78bfa 18%, var(--bg-surface))",
    code:   "color-mix(in srgb, #f97316 16%, var(--bg-surface))",
    weather: "color-mix(in srgb, #0284c7 16%, var(--bg-surface))",
    settings_ai: "color-mix(in srgb, #94a3b8 14%, var(--bg-surface))",
    settings_os: "color-mix(in srgb, #94a3b8 14%, var(--bg-surface))",
    settings_admin: "color-mix(in srgb, #94a3b8 14%, var(--bg-surface))",
    approvals: "color-mix(in srgb, #22c55e 16%, var(--bg-surface))",
    audit: "color-mix(in srgb, #94a3b8 14%, var(--bg-surface))",
    runs: "color-mix(in srgb, #8b5cf6 16%, var(--bg-surface))",
    image_studio: "color-mix(in srgb, #d946ef 18%, var(--bg-surface))",
  };
  const appIcon: Record<AppId, ComponentType<{ size?: number; className?: string }>> = {
    mail: Mail,
    calendar: CalendarDays,
    tasks: CheckSquare,
    files: FileText,
    graph: Network,
    builder: Wrench,
    slides: AppWindow,
    studio: Wand2,
    code:   Code2,
    weather: Cloud,
    settings_ai: Sparkles,
    settings_os: Settings,
    settings_admin: Shield,
    approvals: CheckSquare,
    audit: FileText,
    runs: Sparkles,
    image_studio: Wand2,
  };

  return (
    <div
      className="pointer-events-none fixed bottom-[96px] left-0 z-[112] px-4 sm:px-6"
      style={{ right: `${rightInset}px` }}
    >
      <nav
        className="pointer-events-auto mx-auto w-full max-w-[960px] overflow-x-auto rounded-[var(--radius-pill,9999px)] border px-3 py-2 shadow-[0_20px_64px_rgba(5,8,18,0.48)] backdrop-blur-xl"
        style={{
          background: "var(--glass-bg, var(--bg-surface))",
          borderColor: "var(--border-subtle, var(--os-border-soft))",
        }}
        aria-label="Application dock"
      >
        <ul className="flex w-full items-center justify-center gap-1.5">
          {apps.slice(0, 8).map((app) => {
            const active = activeSet.has(app.id);
            const Icon = appIcon[app.id];
            return (
              <li key={app.id}>
                <button
                  type="button"
                  onClick={() => onOpenApp(app.id)}
                  className="group relative flex min-w-0 items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-2 text-sm text-[color:var(--text-secondary)] transition duration-200 hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: active
                      ? appColor[app.id]
                      : "var(--bg-surface-soft, var(--bg-surface))",
                  }}
                  aria-label={`Open ${app.name}`}
                >
                  <span className="grid h-5 w-5 place-items-center text-base leading-none text-[color:var(--text-primary)]">
                    <Icon size={15} />
                  </span>
                  <span
                    className="hidden max-w-[7.5rem] truncate pr-0.5 text-xs font-medium tracking-wide sm:inline"
                    title={app.name}
                  >
                    {app.name}
                  </span>
                  <span
                    className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full transition-opacity"
                    style={{
                      opacity: active ? 1 : 0,
                      backgroundColor: accent,
                      boxShadow: active ? `0 0 10px color-mix(in srgb, ${accent} 42%, transparent)` : "none",
                    }}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
