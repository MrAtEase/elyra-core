import type { AppId, WindowRecord } from "@/components/os/kernel/types";
import { getApp } from "@/components/os/kernel/appRegistry";

// ── Per-app size/position preference (persisted to localStorage) ────────────

type AppSizePref = { x: number; y: number; width: number; height: number };

function appSizePrefKey(workspaceId: string, appId: AppId): string {
  return `elyra_os_win_pref:${workspaceId}:${appId}`;
}

export function loadAppSizePref(workspaceId: string, appId: AppId): AppSizePref | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(appSizePrefKey(workspaceId, appId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSizePref;
    if (
      typeof parsed?.x === "number" &&
      typeof parsed?.y === "number" &&
      typeof parsed?.width === "number" &&
      typeof parsed?.height === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAppSizePref(workspaceId: string, appId: AppId, rect: AppSizePref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(appSizePrefKey(workspaceId, appId), JSON.stringify(rect));
  } catch {
    // ignore quota failures
  }
}

// Debounce timers for saveAppSizePref calls (keyed by workspaceId:appId)
const _sizeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedSaveAppSizePref(workspaceId: string, appId: AppId, rect: AppSizePref, delayMs = 500): void {
  const key = `${workspaceId}:${appId}`;
  const existing = _sizeSaveTimers.get(key);
  if (existing !== undefined) clearTimeout(existing);
  const timer = setTimeout(() => {
    _sizeSaveTimers.delete(key);
    saveAppSizePref(workspaceId, appId, rect);
  }, delayMs);
  _sizeSaveTimers.set(key, timer);
}

// ────────────────────────────────────────────────────────────────────────────

const APP_DEFAULTS: Record<AppId, { width: number; height: number; x: number; y: number }> = {
  mail: { width: 1200, height: 720, x: 72, y: 92 },
  calendar: { width: 1400, height: 800, x: 84, y: 82 },
  tasks: { width: 1000, height: 700, x: 136, y: 108 },
  files: { width: 600, height: 400, x: 236, y: 122 },
  graph: { width: 1100, height: 720, x: 120, y: 92 },
  builder: { width: 640, height: 440, x: 110, y: 120 },
  slides: { width: 1180, height: 740, x: 96, y: 92 },
  studio: { width: 1100, height: 720, x: 104, y: 92 },
  code:   { width: 1280, height: 800, x: 64,  y: 72  },
  weather: { width: 1320, height: 760, x: 64, y: 84 },
  settings_ai: { width: 600, height: 400, x: 214, y: 146 },
  settings_os: { width: 600, height: 400, x: 244, y: 164 },
  settings_admin: { width: 640, height: 440, x: 158, y: 138 },
  approvals: { width: 680, height: 460, x: 168, y: 138 },
  audit: { width: 820, height: 540, x: 148, y: 118 },
  runs: { width: 940, height: 600, x: 128, y: 108 },
  image_studio: { width: 780, height: 560, x: 140, y: 100 },
};

const DESKTOP_PAD_X = 24;
const DESKTOP_MIN_Y = 74;
const DESKTOP_BOTTOM_RESERVED = 280;
const DESKTOP_FULLSCREEN_BOTTOM_PAD = 160;
const DEFAULT_VIEWPORT_RIGHT_INSET = 40;
const DEFAULT_VIEWPORT_BOTTOM_INSET = 0;
const MIN_WINDOW_WIDTH = 380;
const MIN_WINDOW_HEIGHT = 260;
const WINDOW_Z_MIN = 50;
const WINDOW_Z_MAX = 79;
let viewportRightInset = DEFAULT_VIEWPORT_RIGHT_INSET;
let viewportBottomInset = DEFAULT_VIEWPORT_BOTTOM_INSET;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function viewportLimits(bottomReserved = DESKTOP_BOTTOM_RESERVED) {
  if (typeof window === "undefined") return null;

  const maxWidth = Math.max(320, window.innerWidth - DESKTOP_PAD_X * 2 - viewportRightInset);
  const effectiveBottomReserved = Math.max(0, Math.max(bottomReserved, viewportBottomInset));
  const maxHeight = Math.max(220, window.innerHeight - DESKTOP_MIN_Y - effectiveBottomReserved);
  const minWidth = Math.min(MIN_WINDOW_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, maxHeight);

  return {
    xMin: DESKTOP_PAD_X,
    yMin: DESKTOP_MIN_Y,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  };
}

export function setWorkspaceViewportRightInset(inset: number): void {
  viewportRightInset = Math.max(0, Math.round(inset));
}

export function setWorkspaceViewportBottomInset(inset: number): void {
  viewportBottomInset = Math.max(0, Math.round(inset));
}

function getMaximizedRect() {
  const limits = viewportLimits(DESKTOP_FULLSCREEN_BOTTOM_PAD);
  if (!limits) return null;
  return {
    x: limits.xMin,
    y: limits.yMin,
    width: limits.maxWidth,
    height: limits.maxHeight,
  };
}

function withWindowFlags(windowRecord: WindowRecord): WindowRecord {
  return {
    ...windowRecord,
    maximized: windowRecord.maximized ?? false,
    restoreRect: windowRecord.restoreRect ?? null,
  };
}

function normalizeWindow(windowRecord: WindowRecord): WindowRecord {
  const normalized = withWindowFlags(windowRecord);
  const limits = viewportLimits();
  if (!limits) return normalized;

  if (normalized.maximized) {
    const maximizedRect = getMaximizedRect();
    if (!maximizedRect) return normalized;
    return {
      ...normalized,
      ...maximizedRect,
    };
  }

  const width = clamp(normalized.width, limits.minWidth, limits.maxWidth);
  const height = clamp(normalized.height, limits.minHeight, limits.maxHeight);
  const maxX = limits.xMin + (limits.maxWidth - width);
  const maxY = limits.yMin + (limits.maxHeight - height);

  return {
    ...normalized,
    width,
    height,
    x: clamp(normalized.x, limits.xMin, maxX),
    y: clamp(normalized.y, limits.yMin, maxY),
  };
}

export function normalizeWindowsForViewport(windows: WindowRecord[]): WindowRecord[] {
  return windows.map((windowRecord) => normalizeWindow(windowRecord));
}

export function hasWindowGeometryChanges(before: WindowRecord[], after: WindowRecord[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((windowRecord, index) => {
    const next = after[index];
    if (!next) return true;
    return (
      windowRecord.id !== next.id ||
      windowRecord.x !== next.x ||
      windowRecord.y !== next.y ||
      windowRecord.width !== next.width ||
      windowRecord.height !== next.height ||
      windowRecord.maximized !== next.maximized
    );
  });
}

export function layoutStorageKey(workspaceId: string): string {
  return `elyra_os_layout:${workspaceId}`;
}

export function safeLoadWorkspaceLayout(workspaceId: string): WindowRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WindowRecord[];
    if (!Array.isArray(parsed)) return [];
    const normalizedForFullscreen = parsed.map((windowRecord) => ({
      ...windowRecord,
      maximized: true,
      minimized: Boolean(windowRecord.minimized),
      restoreRect:
        windowRecord.restoreRect ?? {
          x: windowRecord.x,
          y: windowRecord.y,
          width: windowRecord.width,
          height: windowRecord.height,
        },
    }));
    return normalizeWindowsForViewport(normalizedForFullscreen);
  } catch {
    return [];
  }
}

export function saveWorkspaceLayout(workspaceId: string, windows: WindowRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(layoutStorageKey(workspaceId), JSON.stringify(windows));
  } catch {
    // ignore quota/storage failures
  }
}

function nextZIndex(windows: WindowRecord[]): number {
  const max = windows.reduce(
    (running, item) => Math.max(running, Math.min(WINDOW_Z_MAX, Math.max(WINDOW_Z_MIN, item.zIndex))),
    WINDOW_Z_MIN - 1
  );
  if (max >= WINDOW_Z_MAX) return WINDOW_Z_MAX;
  return max + 1;
}

export function openWindow(windows: WindowRecord[], appId: AppId, workspaceId?: string): WindowRecord[] {
  const existing = windows.find((window) => window.appId === appId);
  const z = nextZIndex(windows);

  if (existing) {
    const nextWindows = windows.map((window) =>
      window.id === existing.id
        ? { ...window, minimized: false, zIndex: z }
        : window
    );
    return normalizeWindowsForViewport(nextWindows);
  }

  const manifest = getApp(appId);
  const defaults = APP_DEFAULTS[appId];
  const index = windows.filter((window) => window.appId === appId).length;

  // Use saved size pref if available (restores user's last-used size)
  const savedPref = workspaceId ? loadAppSizePref(workspaceId, appId) : null;
  const restoreX = savedPref?.x ?? (defaults.x + index * 18);
  const restoreY = savedPref?.y ?? (defaults.y + index * 14);
  const restoreW = savedPref?.width ?? defaults.width;
  const restoreH = savedPref?.height ?? defaults.height;

  const nextWindows: WindowRecord[] = [
    ...windows,
    {
      id: `${appId}-${Date.now()}`,
      appId,
      title: manifest?.name ?? appId,
      zIndex: z,
      x: restoreX,
      y: restoreY,
      width: restoreW,
      height: restoreH,
      minimized: false,
      maximized: true,
      restoreRect: {
        x: restoreX,
        y: restoreY,
        width: restoreW,
        height: restoreH,
      },
    },
  ];

  return normalizeWindowsForViewport(nextWindows);
}

export function closeWindow(windows: WindowRecord[], windowId: string): WindowRecord[] {
  return windows.filter((window) => window.id !== windowId);
}

export function focusWindow(windows: WindowRecord[], windowId: string): WindowRecord[] {
  const z = nextZIndex(windows);
  return windows.map((window) =>
    window.id === windowId
      ? { ...window, zIndex: z, minimized: false }
      : window
  );
}

export function minimizeWindow(windows: WindowRecord[], windowId: string): WindowRecord[] {
  return windows.map((window) =>
    window.id === windowId
      ? { ...window, minimized: true }
      : window
  );
}

export function toggleWindowMaximized(windows: WindowRecord[], windowId: string): WindowRecord[] {
  const z = nextZIndex(windows);
  const nextWindows = windows.map((window) => {
    if (window.id !== windowId) return window;

    if (window.maximized) {
      return {
        ...window,
        ...(window.restoreRect ?? {}),
        minimized: false,
        maximized: false,
        restoreRect: null,
        zIndex: z,
      };
    }

    return {
      ...window,
      minimized: false,
      maximized: true,
      restoreRect: {
        x: window.x,
        y: window.y,
        width: window.width,
        height: window.height,
      },
      zIndex: z,
    };
  });

  return normalizeWindowsForViewport(nextWindows);
}

export function moveWindow(
  windows: WindowRecord[],
  windowId: string,
  next: { x: number; y: number },
  workspaceId?: string
): WindowRecord[] {
  const nextWindows = windows.map((window) =>
    window.id === windowId
      ? window.maximized
        ? window
        : { ...window, x: next.x, y: next.y }
      : window
  );

  const normalized = normalizeWindowsForViewport(nextWindows);

  // Save per-app position pref (debounced)
  if (workspaceId) {
    const updated = normalized.find((w) => w.id === windowId);
    if (updated && !updated.maximized) {
      debouncedSaveAppSizePref(workspaceId, updated.appId, {
        x: updated.x,
        y: updated.y,
        width: updated.width,
        height: updated.height,
      });
    }
  }

  return normalized;
}

export function resizeWindow(
  windows: WindowRecord[],
  windowId: string,
  next: { width: number; height: number },
  workspaceId?: string
): WindowRecord[] {
  const nextWindows = windows.map((window) =>
    window.id === windowId
      ? window.maximized
        ? window
        : {
            ...window,
            width: Math.round(next.width),
            height: Math.round(next.height),
          }
      : window
  );
  const normalized = normalizeWindowsForViewport(nextWindows);

  // Save per-app size pref (debounced)
  if (workspaceId) {
    const updated = normalized.find((w) => w.id === windowId);
    if (updated && !updated.maximized) {
      debouncedSaveAppSizePref(workspaceId, updated.appId, {
        x: updated.x,
        y: updated.y,
        width: updated.width,
        height: updated.height,
      });
    }
  }

  return normalized;
}

// ── Split-view layout ────────────────────────────────────────────────────────
// Arranges up to two non-minimized windows side by side in the available canvas.
// If only one window exists, it fills the full area.
export function arrangeSplitView(windows: WindowRecord[]): WindowRecord[] {
  const limits = viewportLimits(DESKTOP_FULLSCREEN_BOTTOM_PAD);
  if (!limits) return windows;

  const visible = windows.filter((w) => !w.minimized);
  const minimized = windows.filter((w) => w.minimized);

  if (visible.length === 0) return windows;

  const z = nextZIndex(windows);

  if (visible.length === 1) {
    const win = visible[0]!;
    const updated: WindowRecord = {
      ...win,
      x: limits.xMin,
      y: limits.yMin,
      width: limits.maxWidth,
      height: limits.maxHeight,
      maximized: false,
      restoreRect: { x: win.x, y: win.y, width: win.width, height: win.height },
      zIndex: z,
    };
    return [...minimized, updated];
  }

  // Two or more: split the first two side by side
  const gap = 8;
  const halfWidth = Math.floor((limits.maxWidth - gap) / 2);
  const fullHeight = limits.maxHeight;

  const leftWin = visible[0]!;
  const rightWin = visible[1]!;
  const restVisible = visible.slice(2);

  const updatedLeft: WindowRecord = {
    ...leftWin,
    x: limits.xMin,
    y: limits.yMin,
    width: halfWidth,
    height: fullHeight,
    maximized: false,
    restoreRect: { x: leftWin.x, y: leftWin.y, width: leftWin.width, height: leftWin.height },
    zIndex: z,
  };

  const updatedRight: WindowRecord = {
    ...rightWin,
    x: limits.xMin + halfWidth + gap,
    y: limits.yMin,
    width: halfWidth,
    height: fullHeight,
    maximized: false,
    restoreRect: { x: rightWin.x, y: rightWin.y, width: rightWin.width, height: rightWin.height },
    zIndex: z - 1,
  };

  return [...minimized, updatedLeft, updatedRight, ...restVisible];
}
