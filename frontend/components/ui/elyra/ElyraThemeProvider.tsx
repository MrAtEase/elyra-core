"use client";

import { useEffect, type ReactNode } from "react";
import { THEME_REGISTRY, isThemeKey, type ThemeKey } from "@/lib/theme/themeRegistry";

type ElyraThemeProviderProps = {
  children: ReactNode;
};

type ThemeMode = "system" | "dark" | "light";

const USER_PREF_KEY = "elyra-os/user-prefs";
const LEGACY_THEME_KEY = "elyra_theme";
const THEME_MODE_STORAGE_KEY = "elyra_theme_mode";
const THEME_SYNC_EVENT = "elyra:theme-mode";
/** Dispatched when the user picks a specific theme key from the library. */
const THEME_KEY_EVENT = "elyra:theme-key";
const LIGHT_THEME_KEY: ThemeKey = "elli-light";
const DARK_THEME_KEY: ThemeKey = "orb-cosmos";

/** Looks up the theme group from the registry — handles keys that don't use a "light-" prefix. */
function isLightThemeKey(key: ThemeKey): boolean {
  const entry = THEME_REGISTRY.find((t) => t.key === key);
  if (entry) return entry.group === "light";
  return key.startsWith("light-"); // fallback for any unregistered key
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === "light" || value === "dark") return value;
  return "system";
}

function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";

  try {
    const userPrefsRaw = window.localStorage.getItem(USER_PREF_KEY);
    if (userPrefsRaw) {
      const parsed = JSON.parse(userPrefsRaw) as { theme?: string } | null;
      if (parsed?.theme) {
        return normalizeThemeMode(parsed.theme === "auto" ? "system" : parsed.theme);
      }
    }
  } catch {
    // ignore malformed local storage and continue with fallbacks
  }

  const explicitMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (explicitMode) {
    return normalizeThemeMode(explicitMode);
  }

  const legacyTheme = window.localStorage.getItem(LEGACY_THEME_KEY);
  if (isThemeKey(legacyTheme)) {
    return isLightThemeKey(legacyTheme as ThemeKey) ? "light" : "dark";
  }

  return "system";
}

function resolveThemeKey(mode: ThemeMode, prefersDark: boolean): ThemeKey {
  if (mode === "light") return LIGHT_THEME_KEY;
  if (mode === "dark") return DARK_THEME_KEY;
  return prefersDark ? DARK_THEME_KEY : LIGHT_THEME_KEY;
}

/** Returns a user-selected specific ThemeKey from user-prefs, or null to use mode resolution. */
function readStoredSpecificThemeKey(): ThemeKey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { themeKey?: string } | null;
      if (parsed?.themeKey && isThemeKey(parsed.themeKey)) return parsed.themeKey as ThemeKey;
    }
  } catch { /* ignore */ }
  return null;
}

function applyTheme(mode: ThemeMode, prefersDark: boolean) {
  if (typeof document === "undefined") return;
  // A user-selected specific theme key takes priority over mode-resolved defaults.
  const specificKey = readStoredSpecificThemeKey();
  const themeKey = specificKey ?? resolveThemeKey(mode, prefersDark);
  const root = document.documentElement;
  root.dataset.elyraUi = "1";
  root.dataset.themeMode = mode;
  root.setAttribute("data-theme", themeKey);
  root.classList.toggle("dark", !isLightThemeKey(themeKey));
}

function applySpecificThemeKey(themeKey: ThemeKey) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", themeKey);
  root.classList.toggle("dark", !isLightThemeKey(themeKey));
}

export default function ElyraThemeProvider({ children }: ElyraThemeProviderProps) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = (nextMode?: ThemeMode) => {
      applyTheme(nextMode ?? readStoredThemeMode(), mediaQuery.matches);
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || [USER_PREF_KEY, LEGACY_THEME_KEY, THEME_MODE_STORAGE_KEY].includes(event.key)) {
        syncTheme();
      }
    };

    const handleMediaChange = () => {
      if (readStoredThemeMode() === "system") {
        syncTheme("system");
      }
    };

    const handleThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: ThemeMode }>).detail;
      syncTheme(normalizeThemeMode(detail?.theme));
    };

    const handleThemeKeyEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ themeKey?: string }>).detail;
      if (detail?.themeKey && isThemeKey(detail.themeKey)) {
        applySpecificThemeKey(detail.themeKey as ThemeKey);
      }
    };

    syncTheme();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_SYNC_EVENT, handleThemeEvent as EventListener);
    window.addEventListener(THEME_KEY_EVENT, handleThemeKeyEvent as EventListener);
    mediaQuery.addEventListener("change", handleMediaChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_SYNC_EVENT, handleThemeEvent as EventListener);
      window.removeEventListener(THEME_KEY_EVENT, handleThemeKeyEvent as EventListener);
      mediaQuery.removeEventListener("change", handleMediaChange);
    };
  }, []);

  return <>{children}</>;
}
