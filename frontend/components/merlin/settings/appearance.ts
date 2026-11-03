import { useCallback, useEffect, useState } from "react";

import { ORB_PRESETS, type OrbVariant } from "@/components/merlin/orbs/orbRegistry";

const STORAGE_KEY = "merlin.settings.appearance";

export type AppearanceState = {
  orbVariant: OrbVariant;
  themeMode: "light" | "dark";
  language: "en" | "de";
  profile: "work" | "focus" | "studio";
};

// Default matches Cosmos (dark) theme → pearl sphere
const DEFAULT_ORB_VARIANT: OrbVariant = "ribbonLoop";

const DEFAULT_APPEARANCE: AppearanceState = {
  orbVariant: DEFAULT_ORB_VARIANT,
  themeMode: "dark",
  language: "en",
  profile: "work",
};

const persistAppearance = (state: AppearanceState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export function getAppearance(): AppearanceState {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_APPEARANCE;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<AppearanceState>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function setAppearance(updates: Partial<AppearanceState>) {
  if (typeof window === "undefined") return;
  const next = { ...getAppearance(), ...updates };
  persistAppearance(next);
  return next;
}

export function useAppearance() {
  const [state, setState] = useState<AppearanceState>(DEFAULT_APPEARANCE);

  useEffect(() => {
    setState(getAppearance());
  }, []);

  // Bridge: listen for orb variant changes dispatched by SettingsView
  useEffect(() => {
    const handleOrbVariant = (event: Event) => {
      const detail = (event as CustomEvent<{ orbVariant?: OrbVariant }>).detail;
      if (detail?.orbVariant) {
        setState((prev) => {
          const next = { ...prev, orbVariant: detail.orbVariant as OrbVariant };
          persistAppearance(next);
          return next;
        });
      }
    };
    window.addEventListener("elyra:orb-variant", handleOrbVariant);
    return () => window.removeEventListener("elyra:orb-variant", handleOrbVariant);
  }, []);

  const update = useCallback((updates: Partial<AppearanceState>) => {
    setState((prev) => {
      const next = { ...prev, ...updates };
      persistAppearance(next);
      return next;
    });
  }, []);

  return [state, update] as const;
}
