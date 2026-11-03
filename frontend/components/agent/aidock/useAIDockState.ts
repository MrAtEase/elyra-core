"use client";

import { useEffect, useMemo, useState } from "react";
import { panelRegistry } from "@/components/agent/aidock/panelRegistry";
import type { DockPanelId } from "@/components/agent/aidock/types";

type PanelState = Record<DockPanelId, boolean>;
const DEFAULT_PANEL_ORDER = panelRegistry.map((panel) => panel.id);

function defaultPanelState(): PanelState {
  return panelRegistry.reduce(
    (acc, panel) => {
      acc[panel.id] = !panel.defaultCollapsed;
      return acc;
    },
    { actions: true, runs: true, intents: true, artifacts: true, project: true, chat: false } as PanelState,
  );
}

export function useAIDockState(workspaceId: string) {
  const panelStateKey = `elyra:aidock:panels:${workspaceId}`;
  const widthKey = `elyra:aidock:width:${workspaceId}`;
  const orderKey = `elyra:aidock:order:${workspaceId}`;
  const pinnedKey = `elyra:aidock:pinned:${workspaceId}`;

  const [expanded, setExpanded] = useState<boolean>(false);
  const [pinned, setPinned] = useState<boolean>(false);
  const [panelOpen, setPanelOpen] = useState<PanelState>(defaultPanelState);
  const [panelOrder, setPanelOrder] = useState<DockPanelId[]>(() => DEFAULT_PANEL_ORDER);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setExpanded(window.localStorage.getItem(widthKey) === "expanded");
    setPinned(window.localStorage.getItem(pinnedKey) === "pinned");
    try {
      const raw = window.localStorage.getItem(panelStateKey);
      if (!raw) {
        setPanelOpen(defaultPanelState());
        return;
      }
      const parsed = JSON.parse(raw) as Partial<PanelState>;
      setPanelOpen({ ...defaultPanelState(), ...parsed });
    } catch {
      setPanelOpen(defaultPanelState());
    }
    try {
      const rawOrder = window.localStorage.getItem(orderKey);
      if (!rawOrder) return;
      const parsed = JSON.parse(rawOrder) as DockPanelId[];
      const deduped = parsed.filter((value, index) => parsed.indexOf(value) === index);
      const normalized = DEFAULT_PANEL_ORDER.filter((id) => deduped.includes(id)).concat(
        DEFAULT_PANEL_ORDER.filter((id) => !deduped.includes(id)),
      );
      setPanelOrder(normalized);
    } catch {
      setPanelOrder(DEFAULT_PANEL_ORDER);
    }
  }, [orderKey, panelStateKey, pinnedKey, widthKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(widthKey, expanded ? "expanded" : "default");
  }, [expanded, widthKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(pinnedKey, pinned ? "pinned" : "auto");
  }, [pinned, pinnedKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(panelStateKey, JSON.stringify(panelOpen));
  }, [panelOpen, panelStateKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(orderKey, JSON.stringify(panelOrder));
  }, [orderKey, panelOrder]);

  const width = expanded ? 400 : 320;

  return useMemo(
    () => ({
      expanded,
      setExpanded,
      pinned,
      setPinned,
      width,
      panelOpen,
      panelOrder,
      togglePanel: (id: DockPanelId) => setPanelOpen((prev) => ({ ...prev, [id]: !prev[id] })),
      openPanel: (id: DockPanelId) => setPanelOpen((prev) => ({ ...prev, [id]: true })),
      collapsePanel: (id: DockPanelId) => setPanelOpen((prev) => ({ ...prev, [id]: false })),
      movePanel: (sourceId: DockPanelId, targetId: DockPanelId) =>
        setPanelOrder((prev) => {
          if (sourceId === targetId) return prev;
          const next = [...prev];
          const sourceIndex = next.indexOf(sourceId);
          const targetIndex = next.indexOf(targetId);
          if (sourceIndex < 0 || targetIndex < 0) return prev;
          next.splice(sourceIndex, 1);
          next.splice(targetIndex, 0, sourceId);
          return next;
        }),
      movePanelByDelta: (panelId: DockPanelId, delta: -1 | 1) =>
        setPanelOrder((prev) => {
          const index = prev.indexOf(panelId);
          if (index < 0) return prev;
          const target = index + delta;
          if (target < 0 || target >= prev.length) return prev;
          const next = [...prev];
          const [moved] = next.splice(index, 1);
          if (!moved) return prev;
          next.splice(target, 0, moved);
          return next;
        }),
      resetPanelOrder: () => setPanelOrder(DEFAULT_PANEL_ORDER),
    }),
    [expanded, panelOpen, panelOrder, pinned, width],
  );
}
