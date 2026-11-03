"use client";

import { useEffect, useState } from "react";
import {
  Palette, Bot, Shield, User, Link2, CreditCard,
  ChevronRight, Check, Moon, Sun,
} from "lucide-react";
import { THEME_REGISTRY, type ThemeKey, isThemeKey } from "@/lib/theme/themeRegistry";

const ELYRA_THEME_KEY = "elyra_theme";

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
  window.localStorage.setItem(ELYRA_THEME_KEY, key);
}

function getStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return "cyber";
  const stored = window.localStorage.getItem(ELYRA_THEME_KEY);
  if (stored && isThemeKey(stored)) return stored;
  return "cyber";
}

const QUICK_LINKS = [
  { label: "Profile & Account", icon: User, section: "profile" },
  { label: "AI Settings",       icon: Bot, section: "ai" },
  { label: "Integrations",      icon: Link2, section: "integrations" },
  { label: "Billing & Usage",   icon: CreditCard, section: "billing" },
  { label: "Admin",             icon: Shield, section: "members" },
];

export default function SettingsWindow() {
  const [activeTheme, setActiveTheme] = useState<ThemeKey>("cyber");

  useEffect(() => {
    setActiveTheme(getStoredTheme());
  }, []);

  function handleThemeChange(key: ThemeKey) {
    setActiveTheme(key);
    applyTheme(key);
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--bg-canvas)" }}>
      <div className="mx-auto max-w-xl space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--text-tertiary)" }}>System</p>
          <h2 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Settings</h2>
        </div>

        {/* Theme section */}
        <div className="rounded-2xl border p-5" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
          <div className="mb-4 flex items-center gap-2">
            <Palette size={14} style={{ color: "var(--os-accent)" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Appearance</h3>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {THEME_REGISTRY.map((descriptor) => {
              const isActive = activeTheme === descriptor.key;
              const isLight = descriptor.group === "light";
              return (
                <button
                  key={descriptor.key}
                  type="button"
                  onClick={() => handleThemeChange(descriptor.key)}
                  title={descriptor.name}
                  className="group relative overflow-hidden rounded-xl border-2 transition-all hover:scale-105"
                  style={{
                    borderColor: isActive ? descriptor.preview.accentHint : "rgba(255,255,255,0.06)",
                    boxShadow: isActive ? `0 0 0 1px ${descriptor.preview.accentHint}55` : undefined,
                  }}
                >
                  <div
                    className="flex h-10 flex-col items-start justify-end p-1.5"
                    style={{ background: descriptor.preview.bg }}
                  >
                    <div className="flex gap-0.5">
                      <div className="h-1.5 rounded-full" style={{ width: 12, background: descriptor.preview.accentHint, opacity: 0.9 }} />
                      <div className="h-1.5 rounded-full" style={{ width: 8, background: descriptor.preview.text, opacity: 0.3 }} />
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-center gap-0.5 py-1"
                    style={{ background: descriptor.preview.panel + "dd", borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {isLight ? <Sun size={8} style={{ color: descriptor.preview.text + "88" }} /> : <Moon size={8} style={{ color: descriptor.preview.text + "88" }} />}
                    <span className="text-[8px] truncate" style={{ color: descriptor.preview.text + "99" }}>
                      {descriptor.name.split(" ")[0]}
                    </span>
                  </div>
                  {isActive && (
                    <div className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: descriptor.preview.accentHint }}>
                      <Check size={7} className="text-black" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            Active: {THEME_REGISTRY.find((t) => t.key === activeTheme)?.name ?? activeTheme}
          </p>
        </div>

        {/* Quick links */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--os-border-faint)" }}>
          {QUICK_LINKS.map(({ label, icon: Icon, section }, i) => (
            <a
              key={section}
              href={`/os/settings/${section}`}
              className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-white/[0.03]"
              style={{ borderBottom: i < QUICK_LINKS.length - 1 ? "1px solid var(--os-border-faint)" : undefined }}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--bg-surface)" }}>
                <Icon size={13} style={{ color: "var(--os-accent)" }} />
              </div>
              <span className="flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              <ChevronRight size={13} style={{ color: "var(--text-tertiary)" }} />
            </a>
          ))}
        </div>

      </div>
    </div>
  );
}
