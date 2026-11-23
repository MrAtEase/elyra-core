"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppDefinition, AppId, AppearanceSettings, WindowInstance, WindowRect } from "@/components/os/windowing/windowTypes";

type WindowManagerContextValue = {
  windows: WindowInstance[];
  activeWindowId: string | null;
  appearance: AppearanceSettings;
  setAppearance: (next: Partial<AppearanceSettings>) => void;
  openApp: (appId: AppId) => void;
  closeWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  restoreWindow: (windowId: string) => void;
  toggleMaximizeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  moveWindow: (windowId: string, next: Pick<WindowRect, "x" | "y">) => void;
  resizeWindow: (windowId: string, next: Pick<WindowRect, "width" | "height">) => void;
  cycleToNextWindow: () => string | null;
  replaceLayout: (nextWindows: WindowInstance[]) => void;
};

export const WindowManagerContext = createContext<WindowManagerContextValue | null>(null);

type WindowManagerProviderProps = {
  children: React.ReactNode;
  apps: Record<AppId, AppDefinition>;
  layoutStorageKey: string;
  appearanceStorageKey: string;
  initialAppearance: AppearanceSettings;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getMaximizedRect = (): WindowRect => {
  if (typeof window === "undefined") {
    return { x: 20, y: 90, width: 1200, height: 700 };
  }
  const width = Math.max(520, window.innerWidth - 40);
  const height = Math.max(420, window.innerHeight - 200);
  return { x: 20, y: 90, width, height };
};

export function WindowManagerProvider({
  children,
  apps,
  layoutStorageKey,
  appearanceStorageKey,
  initialAppearance,
}: WindowManagerProviderProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [appearance, setAppearanceState] = useState<AppearanceSettings>(initialAppearance);
  const zCounter = useRef(2);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(layoutStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as WindowInstance[];
      const filtered = parsed.filter((item) => Boolean(apps[item.appId]));
      setWindows(filtered);
      const top = filtered.reduce((max, item) => Math.max(max, item.z), 1);
      zCounter.current = top + 1;
      const focused = filtered.reduce<WindowInstance | null>((acc, item) => {
        if (item.minimized) return acc;
        if (!acc) return item;
        return item.z > acc.z ? item : acc;
      }, null);
      setActiveWindowId(focused?.id ?? null);
    } catch {
      setWindows([]);
    }
  }, [apps, layoutStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(appearanceStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
      setAppearanceState((prev) => ({ ...prev, ...parsed }));
    } catch {
      setAppearanceState(initialAppearance);
    }
  }, [appearanceStorageKey, initialAppearance]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(windows));
  }, [layoutStorageKey, windows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance));
  }, [appearance, appearanceStorageKey]);

  const setAppearance = useCallback((next: Partial<AppearanceSettings>) => {
    setAppearanceState((prev) => ({ ...prev, ...next }));
  }, []);

  const focusWindow = useCallback((windowId: string) => {
    setWindows((prev) =>
      prev.map((item) =>
        item.id === windowId
          ? {
              ...item,
              minimized: false,
              z: zCounter.current++,
            }
          : item
      )
    );
    setActiveWindowId(windowId);
  }, []);

  const openApp = useCallback(
    (appId: AppId) => {
      const app = apps[appId];
      if (!app) return;
      setWindows((prev) => {
        if (app.singleton) {
          const existing = prev.find((item) => item.appId === appId);
          if (existing) {
            const next = prev.map((item) =>
              item.id === existing.id
                ? {
                    ...item,
                    minimized: false,
                    z: zCounter.current++,
                  }
                : item
            );
            setActiveWindowId(existing.id);
            return next;
          }
        }

        const windowId = `${appId}-${Date.now()}`;
        const win: WindowInstance = {
          id: windowId,
          appId,
          title: app.title,
          rect: app.defaultRect,
          minWidth: app.minWidth,
          minHeight: app.minHeight,
          minimized: false,
          maximized: false,
          z: zCounter.current++,
        };
        setActiveWindowId(windowId);
        return [...prev, win];
      });
    },
    [apps]
  );

  const closeWindow = useCallback((windowId: string) => {
    setWindows((prev) => prev.filter((item) => item.id !== windowId));
    setActiveWindowId((prev) => (prev === windowId ? null : prev));
  }, []);

  const minimizeWindow = useCallback((windowId: string) => {
    setWindows((prev) => prev.map((item) => (item.id === windowId ? { ...item, minimized: true } : item)));
    setActiveWindowId((prev) => (prev === windowId ? null : prev));
  }, []);

  const restoreWindow = useCallback((windowId: string) => {
    focusWindow(windowId);
  }, [focusWindow]);

  const toggleMaximizeWindow = useCallback((windowId: string) => {
    setWindows((prev) =>
      prev.map((item) => {
        if (item.id !== windowId) return item;
        if (item.maximized) {
          return {
            ...item,
            maximized: false,
            rect: item.lastRectBeforeMaximize ?? item.rect,
            z: zCounter.current++,
          };
        }
        return {
          ...item,
          maximized: true,
          lastRectBeforeMaximize: item.rect,
          rect: getMaximizedRect(),
          minimized: false,
          z: zCounter.current++,
        };
      })
    );
    setActiveWindowId(windowId);
  }, []);

  const moveWindow = useCallback((windowId: string, next: Pick<WindowRect, "x" | "y">) => {
    setWindows((prev) =>
      prev.map((item) => {
        if (item.id !== windowId || item.maximized) return item;
        const maxX = typeof window === "undefined" ? 2500 : Math.max(40, window.innerWidth - item.rect.width - 20);
        const maxY = typeof window === "undefined" ? 1400 : Math.max(120, window.innerHeight - 180);
        return {
          ...item,
          rect: {
            ...item.rect,
            x: clamp(next.x, 8, maxX),
            y: clamp(next.y, 64, maxY),
          },
        };
      })
    );
  }, []);

  const resizeWindow = useCallback((windowId: string, next: Pick<WindowRect, "width" | "height">) => {
    setWindows((prev) =>
      prev.map((item) => {
        if (item.id !== windowId || item.maximized) return item;
        const maxWidth = typeof window === "undefined" ? 2400 : window.innerWidth - item.rect.x - 20;
        const maxHeight = typeof window === "undefined" ? 1600 : window.innerHeight - item.rect.y - 110;
        return {
          ...item,
          rect: {
            ...item.rect,
            width: clamp(next.width, item.minWidth, Math.max(item.minWidth, maxWidth)),
            height: clamp(next.height, item.minHeight, Math.max(item.minHeight, maxHeight)),
          },
        };
      })
    );
  }, []);

  const cycleToNextWindow = useCallback(() => {
    const visible = windows.filter((item) => !item.minimized).sort((a, b) => b.z - a.z);
    if (visible.length === 0) return null;
    const currentIndex = activeWindowId ? visible.findIndex((item) => item.id === activeWindowId) : -1;
    const next = visible[(currentIndex + 1 + visible.length) % visible.length];
    if (!next) return null;
    focusWindow(next.id);
    return next.id;
  }, [activeWindowId, focusWindow, windows]);

  const replaceLayout = useCallback((nextWindows: WindowInstance[]) => {
    const filtered = nextWindows.filter((item) => Boolean(apps[item.appId]));
    const top = filtered.reduce((max, item) => Math.max(max, item.z), 1);
    zCounter.current = top + 1;
    setWindows(filtered);
    const focused = filtered
      .filter((item) => !item.minimized)
      .sort((a, b) => b.z - a.z)[0];
    setActiveWindowId(focused?.id ?? null);
  }, [apps]);

  const value = useMemo<WindowManagerContextValue>(
    () => ({
      windows,
      activeWindowId,
      appearance,
      setAppearance,
      openApp,
      closeWindow,
      minimizeWindow,
      restoreWindow,
      toggleMaximizeWindow,
      focusWindow,
      moveWindow,
      resizeWindow,
      cycleToNextWindow,
      replaceLayout,
    }),
    [
      windows,
      activeWindowId,
      appearance,
      setAppearance,
      openApp,
      closeWindow,
      minimizeWindow,
      restoreWindow,
      toggleMaximizeWindow,
      focusWindow,
      moveWindow,
      resizeWindow,
      cycleToNextWindow,
      replaceLayout,
    ]
  );

  return <WindowManagerContext.Provider value={value}>{children}</WindowManagerContext.Provider>;
}
