"use client";

/**
 * App-Leiste am linken Rand: zeigt alle geöffneten Apps mit Symbol und Namen.
 * Öffnen: Maus an den linken Rand bzw. auf den Griff, oder Griff anklicken (bleibt dann offen).
 * Klick auf eine App wechselt dorthin; ziehen ändert die Reihenfolge; × schließt.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  BarChart3,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudAlert,
  Code2,
  FileText,
  GitMerge,
  Image as ImageIcon,
  Loader2,
  Mail,
  Network,
  Newspaper,
  Pin,
  PinOff,
  Radar,
  ScanSearch,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Target,
  Users,
  Wand2,
  Workflow,
  Wrench,
  X,
  History,
  Presentation,
  Store
} from "lucide-react";
import type { AppId, WindowRecord } from "@/components/os/kernel/types";
import { SHELL_LAYERS } from "@/components/os/shell/layers";
import { loadEdgeRailOrder, reorderEdgeRailIds, saveEdgeRailOrder } from "@/lib/os/edgeRail";
import { PERSONAL_ICONS } from "@/components/os/personal/personalWindows";

const APP_ICONS: Partial<Record<string, ComponentType<{ size?: number; className?: string }>>> = {
  mail: Mail,
  calendar: CalendarDays,
  tasks: CheckSquare,
  files: FileText,
  graph: Network,
  builder: Wrench,
  slides: Presentation,
  studio: Wand2,
  image_studio: ImageIcon,
  code: Code2,
  weather: Cloud,
  reporting: BarChart3,
  leads: Target,
  ads_audit: ScanSearch,
  toolbox: Wrench,
  visibility: Radar,
  synergy: GitMerge,
  feed: ShoppingBag,
  insights: Newspaper,
  automations: Workflow,
  marketplace: Store,
  mini_apps: Wand2,
  agent_team: Users,
  ...PERSONAL_ICONS,
  approvals: ShieldCheck,
  audit: History,
  runs: History,
  settings_ai: Settings,
  settings_os: Settings,
  settings_admin: Settings,
};

type Badge = "run" | "approval" | "error" | "auth";

type WindowDockProps = {
  workspaceId: string;
  windows: WindowRecord[];
  badgeByAppId: Partial<Record<AppId, Badge[]>>;
  focusedWindowId: string | null;
  /** App shown as a full page right now (routed apps); takes precedence for the highlight. */
  activeAppId?: AppId | null;
  accent: string;
  onFocusWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
  /** Called when the pin state changes, so the shell can make room for the rail. */
  onPinnedChange?: (pinned: boolean) => void;
};

const PIN_KEY = "elyra.rail.pinned";

function BadgeDot({ badges }: { badges: Badge[] }) {
  if (badges.includes("error")) return <span className="grid h-4 w-4 place-items-center rounded-full bg-rose-500/90 text-white"><CircleAlert size={9} /></span>;
  if (badges.includes("approval")) return <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-500/90 text-white"><ShieldAlert size={9} /></span>;
  if (badges.includes("auth")) return <span className="grid h-4 w-4 place-items-center rounded-full bg-orange-500/90 text-white"><CloudAlert size={9} /></span>;
  if (badges.includes("run")) return <span className="grid h-4 w-4 place-items-center rounded-full bg-sky-500/85 text-white"><Loader2 size={9} className="animate-spin" /></span>;
  return null;
}

function DockItem({
  item, active, badges, accent, onClose, onDragStart, onDrop, onDragOver, onClick,
}: {
  item: { id: string; appId: AppId; title: string; minimized?: boolean };
  active: boolean;
  badges: Badge[];
  accent: string;
  onClose: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
}) {
  const Icon = APP_ICONS[item.appId] ?? AppWindow;
  const label = item.title.includes("·") ? item.title.split("·").pop()!.trim() : item.title;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onDragOver={onDragOver}
      title={item.title}
      className={`group relative flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 text-left transition ${
        active
          ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface)]"
          : "border-transparent hover:border-[color:var(--os-border-soft)] hover:bg-[color:var(--bg-surface-soft)]"
      } ${item.minimized ? "opacity-60" : ""}`}
    >
      {active ? <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full" style={{ backgroundColor: accent }} /> : null}
      <Icon size={17} className={active ? "shrink-0 text-[color:var(--text-primary)]" : "shrink-0 text-[color:var(--text-secondary)]"} />
      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? "font-semibold text-[color:var(--text-primary)]" : "text-[color:var(--text-secondary)]"}`}>{label}</span>
      <BadgeDot badges={badges} />
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onClose(); }}
        aria-label={`${label} schließen`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] opacity-0 transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default function WindowDock({
  workspaceId, windows, badgeByAppId, focusedWindowId, activeAppId, accent, onFocusWindow, onCloseWindow, onPinnedChange,
}: WindowDockProps) {
  const searchParams = useSearchParams();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [orderedWindowIds, setOrderedWindowIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceVisible = process.env.NEXT_PUBLIC_E2E === "1" || searchParams.get("rail") === "1";
  const openWindowIds = useMemo(() => windows.map((w) => w.id), [windows]);
  const visible = hovered || pinned || forceVisible;

  useEffect(() => {
    try { setPinned(localStorage.getItem(PIN_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    onPinnedChange?.(pinned);
  }, [pinned, onPinnedChange]);

  useEffect(() => {
    setOrderedWindowIds(loadEdgeRailOrder(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    setOrderedWindowIds((previous) => {
      const known = previous.filter((id) => openWindowIds.includes(id));
      const next = [...known, ...openWindowIds.filter((id) => !known.includes(id))];
      saveEdgeRailOrder(workspaceId, next);
      return next;
    });
  }, [openWindowIds, workspaceId]);

  const dockItems = useMemo(() => {
    const byId = new Map(windows.map((w) => [w.id, w]));
    return orderedWindowIds
      .map((id) => byId.get(id))
      .filter((w): w is WindowRecord => Boolean(w))
      .map((w) => ({ id: w.id, appId: w.appId, title: w.title, minimized: w.minimized }));
  }, [orderedWindowIds, windows]);

  const isActive = (item: { id: string; appId: AppId }) => (activeAppId ? item.appId === activeAppId : item.id === focusedWindowId);

  const show = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setHovered(true); };
  // Short delay so moving the mouse from the handle to the panel does not close it.
  const hideSoon = () => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setHovered(false), 250); };

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem(PIN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (!next) setHovered(false);
      return next;
    });
  };

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
      {/* Hover zone along the whole left edge (wider than before, easier to hit) */}
      <div
        data-testid="edge-rail-hover-zone"
        aria-hidden="true"
        className="fixed left-0 bottom-[96px]"
        style={{ top: "56px", width: "10px", zIndex: SHELL_LAYERS.dock }}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
      />

      {/* Visible handle: shows how many apps are open; click pins the rail open */}
      {!visible ? (
        <button
          type="button"
          onClick={togglePin}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          aria-label="Geöffnete Apps anzeigen"
          title="Geöffnete Apps"
          className="fixed left-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-xl border border-l-0 border-[color:var(--os-border-soft)] px-1 py-2.5 text-[color:var(--text-secondary)] shadow-sm transition hover:text-[color:var(--text-primary)]"
          style={{ zIndex: SHELL_LAYERS.dock, background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}
        >
          <ChevronRight size={13} />
          <span className="text-[10.5px] font-semibold tabular-nums">{dockItems.length}</span>
        </button>
      ) : null}

      <AnimatePresence>
        {visible ? (
          <motion.aside
            data-testid="edge-rail"
            aria-label="Geöffnete Apps"
            initial={{ x: -230 }}
            animate={{ x: 0 }}
            exit={{ x: -230 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="fixed left-0 bottom-[96px] flex w-[220px] flex-col border-r border-[color:var(--os-border-soft)] shadow-xl"
            style={{
              top: "56px",
              zIndex: SHELL_LAYERS.dock,
              background: "color-mix(in srgb, var(--bg-elevated) 96%, transparent)",
              backdropFilter: "blur(12px) saturate(1.08)",
              WebkitBackdropFilter: "blur(12px) saturate(1.08)",
            }}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Geöffnet · {dockItems.length}</span>
              <span className="flex gap-0.5">
                <button type="button" onClick={togglePin} title={pinned ? "Nicht mehr anheften" : "Leiste anheften"} className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]">
                  {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                {pinned ? (
                  <button type="button" onClick={togglePin} title="Leiste schließen" className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]">
                    <ChevronLeft size={14} />
                  </button>
                ) : null}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
              {dockItems.length === 0 ? (
                <p className="px-2 py-3 text-[12px] leading-relaxed text-[color:var(--text-muted)]">Keine App geöffnet. Öffne Apps über „Apps“ oben rechts oder das Dock.</p>
              ) : null}
              {dockItems.map((item) => (
                <DockItem
                  key={item.id}
                  item={item}
                  active={isActive(item)}
                  badges={badgeByAppId[item.appId] ?? []}
                  accent={accent}
                  onClose={() => onCloseWindow(item.id)}
                  onDragStart={() => setDraggingId(item.id)}
                  onDrop={() => handleDropOn(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onClick={() => onFocusWindow(item.id)}
                />
              ))}
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
