"use client";

import { useEffect, useState } from "react";
import {
  Palette, Keyboard, Monitor, Zap, Globe, Bell,
  Moon, Sun, Contrast, Eye, Volume2, VolumeX, Check,
  ChevronRight, LayoutGrid, Maximize2, MousePointer2,
} from "lucide-react";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/themeRegistry";

const THEME_STORAGE_KEY = "elyra_theme";

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
  window.localStorage.setItem(THEME_STORAGE_KEY, key);
}

function getStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return "cyber";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && (THEME_KEYS as readonly string[]).includes(stored)) return stored as ThemeKey;
  return "cyber";
}

const ACCENTS = [
  { value: "#6C9CFC", label: "Blue" },
  { value: "#4ECDC4", label: "Teal" },
  { value: "#A78BFA", label: "Violet" },
  { value: "#34d399", label: "Emerald" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#f472b6", label: "Pink" },
];

const SHORTCUTS = [
  { key: "⌘ K", action: "Focus intent line" },
  { key: "⌘ ,", action: "Open settings" },
  { key: "⌘ W", action: "Close active window" },
  { key: "⌘ Tab", action: "App switcher" },
  { key: "⌘ ↵", action: "Submit intent" },
  { key: "Esc", action: "Close overlay / panel" },
  { key: "⌘ 1–4", action: "Switch to Mail, Calendar, Tasks, Files" },
  { key: "← →", action: "Navigate slides (Slides app)" },
];

const LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "ja", label: "日本語" },
];

const THEME_LABELS: Partial<Record<ThemeKey, string>> = {
  "cyber": "Cyber",
  "dark-midnight": "Dark Midnight",
  "dark-graphite": "Dark Graphite",
  "light-crisp": "Light Crisp",
  "light-classic": "Light Classic",
  "violet": "Violet",
  "ocean": "Ocean",
};

type Section = "appearance" | "shortcuts" | "language" | "notifications" | "accessibility";

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "shortcuts", label: "Keyboard", icon: Keyboard },
  { id: "language", label: "Language & Region", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "accessibility", label: "Accessibility", icon: Eye },
];

export default function OsSettingsWindow() {
  const [section, setSection] = useState<Section>("appearance");
  const [theme, setTheme] = useState<ThemeKey>("cyber");
  const [accent, setAccent] = useState(ACCENTS[0]!.value);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [language, setLanguage] = useState("de");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [emailDigest, setEmailDigest] = useState(false);
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">("default");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function handleThemeChange(key: ThemeKey) {
    setTheme(key);
    applyTheme(key);
  }

  const isLight = theme.startsWith("light-");

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-48 flex-shrink-0 flex-col border-r py-2" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className="flex w-full items-center gap-2.5 rounded-lg mx-2 px-3 py-2.5 text-left transition"
            style={{
              width: "calc(100% - 16px)",
              background: section === id ? "var(--os-accent-faint, rgba(108,156,252,0.12))" : "transparent",
              color: section === id ? "var(--os-accent)" : "var(--text-secondary)",
            }}
          >
            <Icon size={14} />
            <span className="text-sm">{label}</span>
            {section === id && <ChevronRight size={12} className="ml-auto opacity-50" />}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {section === "appearance" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Theme</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Choose how elyra looks on your device</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {(THEME_KEYS as readonly ThemeKey[]).map((key) => {
                  const isActive = theme === key;
                  const label = THEME_LABELS[key] ?? key;
                  const isDark = !key.startsWith("light-");
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleThemeChange(key)}
                      className="group relative overflow-hidden rounded-xl border transition-all"
                      style={{
                        borderColor: isActive ? "var(--os-accent)" : "var(--os-border-faint)",
                        boxShadow: isActive ? "0 0 0 1px var(--os-accent)" : undefined,
                      }}
                    >
                      {/* Preview swatch */}
                      <div
                        className="h-14 flex items-center justify-center"
                        style={{
                          background: isDark
                            ? key === "cyber" ? "linear-gradient(135deg,#080e1a,#0d1528)" : key === "violet" ? "linear-gradient(135deg,#1a0533,#2d1b69)" : key === "ocean" ? "linear-gradient(135deg,#062233,#0c3a5a)" : key === "dark-midnight" ? "#0a0f1a" : "#1a1f2e"
                            : key === "light-crisp" ? "#f8fafc" : "#f0f4f8",
                        }}
                      >
                        <div className="flex gap-1">
                          {[...Array(3)].map((_, i) => <div key={i} className="h-1.5 rounded-full" style={{ width: [20, 14, 10][i], background: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }} />)}
                        </div>
                      </div>
                      {/* Label */}
                      <div className="border-t px-2 py-1.5 text-center" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                        <div className="flex items-center justify-center gap-1">
                          {isDark ? <Moon size={9} style={{ color: "var(--text-tertiary)" }} /> : <Sun size={9} style={{ color: "var(--text-tertiary)" }} />}
                          <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
                        </div>
                      </div>
                      {/* Active check */}
                      {isActive && (
                        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "var(--os-accent)" }}>
                          <Check size={10} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accent color */}
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Accent Color</h3>
              <p className="mb-3 text-xs" style={{ color: "var(--text-tertiary)" }}>Used for highlights and active states</p>
              <div className="flex gap-2.5 flex-wrap">
                {ACCENTS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAccent(value)}
                    title={label}
                    className="relative h-8 w-8 rounded-full border-2 transition hover:scale-110"
                    style={{
                      backgroundColor: value,
                      borderColor: accent === value ? "var(--text-primary)" : "transparent",
                      boxShadow: accent === value ? `0 0 0 2px ${value}55` : undefined,
                    }}
                  >
                    {accent === value && <Check size={12} className="absolute inset-0 m-auto text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Density */}
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Interface Density</h3>
              <p className="mb-3 text-xs" style={{ color: "var(--text-tertiary)" }}>Adjust spacing and element sizes</p>
              <div className="grid grid-cols-3 gap-2">
                {(["compact", "default", "comfortable"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDensity(d)}
                    className="rounded-xl border py-3 text-center text-xs font-medium transition"
                    style={{
                      borderColor: density === d ? "var(--os-accent)" : "var(--os-border-faint)",
                      background: density === d ? "var(--os-accent-faint, rgba(108,156,252,0.1))" : "var(--bg-elevated)",
                      color: density === d ? "var(--os-accent)" : "var(--text-secondary)",
                    }}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              {[
                { label: "Reduce motion", desc: "Minimize animations throughout the interface", value: reduceMotion, onChange: setReduceMotion },
                { label: "Sound effects", desc: "Play subtle sounds for notifications and actions", value: soundEffects, onChange: setSoundEffects },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(!value)}
                    className="relative h-6 w-10 rounded-full transition-colors"
                    style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}
                  >
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "shortcuts" && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Keyboard Shortcuts</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Global shortcuts available throughout elyra</p>
            </div>
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--os-border-faint)" }}>
              {SHORTCUTS.map(({ key, action }, i) => (
                <div
                  key={action}
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    borderBottom: i < SHORTCUTS.length - 1 ? `1px solid var(--os-border-faint)` : undefined,
                    background: i % 2 === 0 ? "var(--bg-elevated)" : "transparent",
                  }}
                >
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{action}</span>
                  <kbd className="rounded-lg border px-2 py-1 font-mono text-xs" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "language" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Language</h3>
              <p className="mb-3 text-xs" style={{ color: "var(--text-tertiary)" }}>Choose the interface language</p>
              <div className="grid grid-cols-1 gap-2">
                {LANGUAGES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLanguage(value)}
                    className="flex items-center justify-between rounded-xl border px-4 py-3 transition"
                    style={{
                      borderColor: language === value ? "var(--os-accent)" : "var(--os-border-faint)",
                      background: language === value ? "var(--os-accent-faint, rgba(108,156,252,0.08))" : "var(--bg-elevated)",
                    }}
                  >
                    <span className="text-sm" style={{ color: language === value ? "var(--os-accent)" : "var(--text-secondary)" }}>{label}</span>
                    {language === value && <Check size={14} style={{ color: "var(--os-accent)" }} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === "notifications" && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Notification Settings</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Control when and how you receive alerts</p>
            </div>
            <div className="space-y-2">
              {[
                { label: "Desktop notifications", desc: "Show system notifications for important events", value: desktopNotifications, onChange: setDesktopNotifications },
                { label: "Daily email digest", desc: "Receive a summary of activity each morning", value: emailDigest, onChange: setEmailDigest },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(!value)}
                    className="relative h-6 w-10 rounded-full transition-colors"
                    style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}
                  >
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "accessibility" && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Accessibility</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Adjust settings to improve usability</p>
            </div>
            <div className="space-y-2">
              {[
                { label: "High contrast", desc: "Increase contrast for better visibility", value: highContrast, onChange: setHighContrast },
                { label: "Reduce motion", desc: "Minimize animations and transitions", value: reduceMotion, onChange: setReduceMotion },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(!value)}
                    className="relative h-6 w-10 rounded-full transition-colors"
                    style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}
                  >
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
