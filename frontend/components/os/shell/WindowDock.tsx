"use client";

import { useEffect, useMemo, useState, type ComponentType, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  CalendarDays,
  CheckSquare,
  CircleAlert,
  Cloud,
  CloudAlert,
  Code2,
  FileText,
  GripVertical,
  Loader2,
  Mail,
  Network,
  ShieldAlert,
  Settings,
  Wand2,
  X,
  Workflow,
} from "lucide-react";
import type { AppId, WindowRecord } from "@/components/os/kernel/types";
import { SHELL_LAYERS } from "@/components/os/shell/layers";
import {
  loadEdgeRailOrder,
  reorderEdgeRailIds,
  saveEdgeRailOrder,
} from "@/lib/os/edgeRail";

const APP_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  mail: Mail,
  calendar: CalendarDays,
  tasks: CheckSquare,
  files: FileText,
  graph: Network,
  builder: Workflow,
  slides: AppWindow,
  studio: Wand2,
  code: Code2,
  weather: Cloud,
  settings_ai: Settings,
  settings_os: Settings,
  settings_admin: Settings,
};

type WindowDockProps = {
  workspaceId: string;
  windows: WindowRecord[];
  badgeByAppId: Partial<Record<AppId, Array<"run" | "approval" | "error" | "auth">>>;
  focusedWindowId: string | null;
  accent: string;
  onFocusWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
};

function DockItem({
  item,
  focused,
  badges,
  accent,
  onClose,
  onDragStart,
  onDrop,
  onDragOver,
  onClick,
}: {
  item: { id: string; appId: AppId; title: string; minimized?: boolean };
  focused: boolean;
  badges: Array<"run" | "approval" | "error" | "auth">;
  accent: string;
  onClose?: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  const Icon = APP_ICONS[item.appId] ?? AppWindow;

  return (
    <button
      type="button"
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDrop={onDrop}
      onDragOver={onDragOver}
      title={item.title}
      className={`group relative grid h-10 w-10 place-items-center rounded-xl border transition ${
        item.minimized ? "opacity-50" : "opacity-100"
      } ${
        focused
          ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface)]"
          : "border-transparent hover:border-[color:var(--os-border-soft)] hover:bg-[color:var(--bg-surface-soft)]"
      }`}
    >
      <Icon size={18} className="text-[color:var(--text-secondary)]" />
      <GripVertical size={10} className="pointer-events-none absolute -left-0.5 top-0.5 text-[color:var(--text-muted)] opacity-45" />
      {focused && (
        <span
          className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full"
          style={{ backgroundColor: accent }}
        />
      )}
      {badges.includes("run") ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-sky-500/85 p-0.5 text-white">
          <Loader2 size={8} className="animate-spin" />
        </span>
      ) : null}
      {badges.includes("approval") ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-500/90 p-0.5 text-white">
          <ShieldAlert size={8} />
        </span>
      ) : null}
      {badges.includes("error") ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-500/90 p-0.5 text-white">
          <CircleAlert size={8} />
        </span>
      ) : null}
      {badges.includes("auth") ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-orange-500/90 p-0.5 text-white">
          <CloudAlert size={8} />
        </span>
      ) : null}
      {onClose ? (
        <span
          role="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${item.title}`}
          className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] opacity-0 transition group-hover:opacity-100"
        >
          <X size={9} />
        </span>
      ) : null}
    </button>
  );
}

export default function WindowDock({
  workspaceId,
  windows,
  badgeByAppId,
  focusedWindowId,
  accent,
  onFocusWindow,
  onCloseWindow,
}: WindowDockProps) {
  const searchParams = useSearchParams();
  const [dockVisible, setDockVisible] = useState(false);
  const [orderedWindowIds, setOrderedWindowIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const forceVisible = process.env.NEXT_PUBLIC_E2E === "1" || searchParams.get("rail") === "1";
  const openWindowIds = useMemo(() => windows.map((window) => window.id), [windows]);

  useEffect(() => {
    const stored = loadEdgeRailOrder(workspaceId);
    setOrderedWindowIds(stored);
  }, [workspaceId]);

  useEffect(() => {
    setOrderedWindowIds((previous) => {
      const known = previous.filter((id) => openWindowIds.includes(id));
      const appended = openWindowIds.filter((id) => !known.includes(id));
      const next = [...known, ...appended];
      saveEdgeRailOrder(workspaceId, next);
      return next;
    });
  }, [openWindowIds, workspaceId]);

  const dockItems = useMemo(() => {
    const windowById = new Map(windows.map((window) => [window.id, window]));
    return orderedWindowIds
      .map((windowId) => windowById.get(windowId))
      .filter((window): window is WindowRecord => Boolean(window))
      .map((window) => ({
        id: window.id,
        appId: window.appId,
        title: window.title,
        minimized: window.minimized,
      }));
  }, [orderedWindowIds, windows]);

  const handleDropOn = (targetId: string) => {
    if (!draggingId) return;
    setOrderedWindowIds((previous) => {
      const next = reorderEdgeRailIds(previous, draggingId, targetId);
      saveEdgeRailOrder(workspaceId, next);
      return next;
    });
    setDraggingId(null);
  };

  return (
    <>
      {/* Invisible hot zone — always in DOM for deterministic hover/e2e */}
      <div
        data-testid="edge-rail-hover-zone"
        aria-hidden="true"
        className="fixed left-0 bottom-[96px]"
        style={{
          top: "56px", // below header (h-14)
          width: "6px",
          zIndex: SHELL_LAYERS.dock,
        }}
        onMouseEnter={() => setDockVisible(true)}
      />

      {/* Dock panel */}
      <AnimatePresence>
        {(dockVisible || forceVisible) && (
          <motion.aside
            data-testid="edge-rail"
            aria-label="Ely rail"
            initial={{ x: -60 }}
            animate={{ x: 0 }}
            exit={{ x: -60 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed left-0 bottom-[96px] w-[56px] border-r border-white/[0.08] py-3 px-1.5"
            style={{
              top: "56px",
              zIndex: SHELL_LAYERS.dock,
              background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)",
              backdropFilter: "blur(10px) saturate(1.08)",
              WebkitBackdropFilter: "blur(10px) saturate(1.08)",
            }}
            onMouseEnter={() => setDockVisible(true)}
            onMouseLeave={() => setDockVisible(false)}
          >
            <div className="flex flex-col items-center gap-2">
              {dockItems.length === 0 ? (
                <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-1.5 py-2 text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                  No windows
                </div>
              ) : null}
              {dockItems.map((item) => (
                <DockItem
                  key={item.id}
                  item={item}
                  focused={item.id === focusedWindowId}
                  badges={badgeByAppId[item.appId] ?? []}
                  accent={accent}
                  onClose={() => onCloseWindow(item.id)}
                  onDragStart={() => setDraggingId(item.id)}
                  onDrop={() => handleDropOn(item.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => onFocusWindow(item.id)}
                />
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
