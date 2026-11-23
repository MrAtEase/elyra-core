"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Use the optional variant so LocaleProvider mounts safely in the OS shell
// (where WorkspaceProvider is not in the tree). When workspace context is
// absent, language persistence is skipped and the browser locale is used.
import { useWorkspaceDataOptional } from "@/components/workspace/WorkspaceContext";
import {
  AppLanguage,
  AppLanguageCode,
  DEFAULT_LANGUAGE_CODE,
  detectBrowserLanguageCode,
  resolveAppLanguage,
  resolveAppLanguageFromString,
} from "@/lib/i18n";

type LocaleContextValue = {
  language: AppLanguage;
  resolvedLanguage: ReturnType<typeof resolveAppLanguage>;
  setLanguage: (next: AppLanguage) => Promise<boolean>;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // workspaceCtx is null when LocaleProvider is mounted outside WorkspaceProvider
  // (e.g. in the OS shell layout). In that case we fall back to browser locale
  // and skip server-side persistence.
  const workspaceCtx = useWorkspaceDataOptional();
  const storedSelection = resolveAppLanguageFromString(workspaceCtx?.data?.userSettings?.language ?? null);
  const [language, setLanguageState] = useState<AppLanguage>(storedSelection);
  const [detectedBrowserCode, setDetectedBrowserCode] = useState<AppLanguageCode | null>(null);

  useEffect(() => {
    const next = resolveAppLanguageFromString(workspaceCtx?.data?.userSettings?.language ?? null);
    setLanguageState((current) => (current === next ? current : next));
  }, [workspaceCtx?.data?.userSettings?.language]);

  const resolvedLanguage = useMemo(() => {
    if (language === "auto") {
      return detectedBrowserCode ?? DEFAULT_LANGUAGE_CODE;
    }
    return language;
  }, [language, detectedBrowserCode]);

  useEffect(() => {
    if (language !== "auto") {
      return;
    }
    if (detectedBrowserCode) {
      return;
    }
    const code = detectBrowserLanguageCode();
    setDetectedBrowserCode(code);
  }, [language, detectedBrowserCode]);

  const setLanguage = useCallback(
    async (next: AppLanguage) => {
      if (next === language) {
        return true;
      }
      const previous = language;
      setLanguageState(next);
      if (workspaceCtx?.setLanguage) {
        const ok = await workspaceCtx.setLanguage(next);
        if (!ok) {
          setLanguageState(previous);
        }
        return ok;
      }
      // No workspace context — persist via the event bridge only (SettingsView picks it up)
      return true;
    },
    [language, workspaceCtx]
  );

  // Bridge: listen for language changes dispatched from SettingsView (which runs outside LocaleProvider)
  useEffect(() => {
    const handleLanguageEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ language?: string }>).detail;
      if (detail?.language && detail.language !== language) {
        const next = resolveAppLanguageFromString(detail.language);
        setLanguageState(next);
        if (workspaceCtx?.setLanguage) {
          void workspaceCtx.setLanguage(next);
        }
      }
    };
    window.addEventListener("elyra:language", handleLanguageEvent);
    return () => window.removeEventListener("elyra:language", handleLanguageEvent);
  }, [language, workspaceCtx]);

  const value = useMemo(
    () => ({ language, resolvedLanguage, setLanguage }),
    [language, resolvedLanguage, setLanguage]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
