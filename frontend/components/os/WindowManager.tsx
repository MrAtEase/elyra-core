"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDebouncedSave,
  loadLayout,
  saveLayout,
  serializeLayout,
} from "@/lib/os/layoutStore";
import {
  createDefaultLayout,
  type LayoutV1,
  type OSWindow,
  type WindowType,
} from "@/lib/os/layoutTypes";

const WINDOW_TITLES: Record<WindowType, string> = {
  runs: "Runs",
  approvals: "Approvals",
  files: "Files",
  admin: "Admin",
  settings: "Settings",
};

const WINDOW_DEFAULTS: Record<WindowType, { w: number; h: number }> = {
  runs: { w: 920, h: 560 },
  approvals: { w: 720, h: 460 },
  files: { w: 760, h: 500 },
  admin: { w: 680, h: 460 },
  settings: { w: 620, h: 440 },
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 220;

type WindowManagerState = {
  windows: OSWindow[];
  activeWindowId: string | null;
};

type WindowManagerActions = {
  open: (type: WindowType) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
};

type WindowManagerProps = {
  workspaceSlug: string;
  workspaceId?: string | null;
  allowedWindowTypes?: WindowType[];
  children: (state: WindowManagerState & WindowManagerActions) => React.ReactNode;
};

function maxZ(windows: OSWindow[]): number {
  return windows.reduce((max, item) => Math.max(max, item.z), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampWindowPosition(item: OSWindow, nextX: number, nextY: number): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return {
    x: clamp(nextX, 0, Math.max(0, viewportWidth - 80)),
    y: clamp(nextY, 0, Math.max(0, viewportHeight - 80)),
  };
}

function clampWindowSize(item: OSWindow, nextW: number, nextH: number): { w: number; h: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  return {
    w: clamp(nextW, MIN_WIDTH, Math.max(MIN_WIDTH, viewportWidth - item.x)),
    h: clamp(nextH, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - item.y)),
  };
}

export default function WindowManager({
  workspaceSlug,
  workspaceId,
  allowedWindowTypes,
  children,
}: WindowManagerProps) {
  const [windows, setWindows] = useState<OSWindow[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const lastSavedSerializedRef = useRef("");
  const debouncedSaveRef = useRef<ReturnType<typeof createDebouncedSave> | null>(null);
  const allowedTypeSet = useMemo(
    () => new Set(allowedWindowTypes && allowedWindowTypes.length > 0 ? allowedWindowTypes : Object.keys(WINDOW_TITLES)),
    [allowedWindowTypes]
  );

  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = createDebouncedSave((layout) => saveLayout(layout, workspaceId), 750);
  }

  useEffect(() => {
    debouncedSaveRef.current = createDebouncedSave((layout) => saveLayout(layout, workspaceId), 750);
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    const hydrate = async () => {
      const layout = await loadLayout(viewport, workspaceId);
      if (cancelled) return;

      const filteredWindows = layout.windows.filter((item) => allowedTypeSet.has(item.type));
      const loaded =
        filteredWindows.length > 0
          ? { ...layout, windows: filteredWindows }
          : createDefaultLayout(viewport);
      setWindows(loaded.windows);
      const active = loaded.windows.filter((item) => !item.minimized).sort((a, b) => b.z - a.z)[0];
      setActiveWindowId(active?.id ?? null);
      lastSavedSerializedRef.current = serializeLayout({ version: 1, windows: loaded.windows });
      hasLoadedRef.current = true;
    };

    void hydrate();

    return () => {
      cancelled = true;
      debouncedSaveRef.current?.cancel();
    };
  }, [workspaceSlug, workspaceId, allowedTypeSet]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const layout: LayoutV1 = { version: 1, windows };
    const serialized = serializeLayout(layout);
    if (serialized === lastSavedSerializedRef.current) return;
    lastSavedSerializedRef.current = serialized;
    debouncedSaveRef.current?.schedule(layout);
  }, [windows]);

  const focus = useCallback((id: string) => {
    setWindows((prev) => {
      const nextZ = maxZ(prev) + 1;
      return prev.map((item) =>
        item.id === id ? { ...item, minimized: false, z: nextZ } : item
      );
    });
    setActiveWindowId(id);
  }, []);

  const open = useCallback((type: WindowType) => {
    if (!allowedTypeSet.has(type)) {
      return;
    }
    setWindows((prev) => {
      const existing = prev.find((item) => item.type === type);
      if (existing) {
        const nextZ = maxZ(prev) + 1;
        setActiveWindowId(existing.id);
        return prev.map((item) =>
          item.id === existing.id ? { ...item, minimized: false, z: nextZ } : item
        );
      }

      const defaults = WINDOW_DEFAULTS[type];
      const nextZ = maxZ(prev) + 1;
      const newWindow: OSWindow = {
        id: type,
        type,
        title: WINDOW_TITLES[type],
        x: Math.max(24, Math.round((window.innerWidth - defaults.w) / 2)),
        y: Math.max(72, Math.round((window.innerHeight - defaults.h) / 2) - 14),
        w: defaults.w,
        h: defaults.h,
        z: nextZ,
        minimized: false,
      };
      setActiveWindowId(newWindow.id);
      return [...prev, newWindow];
    });
  }, [allowedTypeSet]);

  const close = useCallback((id: string) => {
    setWindows((prev) => prev.filter((item) => item.id !== id));
    setActiveWindowId((prev) => (prev === id ? null : prev));
  }, []);

  const minimize = useCallback((id: string) => {
    setWindows((prev) => prev.map((item) => (item.id === id ? { ...item, minimized: true } : item)));
    setActiveWindowId((prev) => (prev === id ? null : prev));
  }, []);

  const restore = useCallback((id: string) => {
    focus(id);
  }, [focus]);

  const move = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const clamped = clampWindowPosition(item, x, y);
        return { ...item, x: clamped.x, y: clamped.y };
      })
    );
  }, []);

  const resize = useCallback((id: string, w: number, h: number) => {
    setWindows((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const clamped = clampWindowSize(item, w, h);
        return { ...item, w: clamped.w, h: clamped.h };
      })
    );
  }, []);

  const value = useMemo(
    () => ({
      windows,
      activeWindowId,
      open,
      close,
      minimize,
      restore,
      focus,
      move,
      resize,
    }),
    [activeWindowId, close, focus, minimize, move, open, resize, restore, windows]
  );

  useEffect(() => {
    setWindows((prev) => prev.filter((item) => allowedTypeSet.has(item.type)));
  }, [allowedTypeSet]);

  return <>{children(value)}</>;
}
