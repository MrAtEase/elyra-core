import type { AIDockSurfaceId, DockPanelId } from "@/components/agent/aidock/types";

export type DockPanelDefinition = {
  id: DockPanelId;
  title: string;
  defaultCollapsed: boolean;
  isVisible: (surface: AIDockSurfaceId) => boolean;
};

function isAppSurface(surface: AIDockSurfaceId) {
  return ["mail", "calendar", "tasks", "drive", "slides", "docs", "research", "weather", "translate"].includes(surface);
}

export const panelRegistry: DockPanelDefinition[] = [
  {
    id: "actions",
    title: "AI Actions",
    defaultCollapsed: false,
    isVisible: (surface) => surface === "agent" || isAppSurface(surface),
  },
  {
    id: "runs",
    title: "Processes / Runs",
    defaultCollapsed: false,
    isVisible: (surface) => surface !== "apps" && surface !== "system",
  },
  {
    id: "intents",
    title: "Intents",
    defaultCollapsed: false,
    isVisible: (surface) => surface !== "apps" && surface !== "system",
  },
  {
    id: "artifacts",
    title: "Artifacts",
    defaultCollapsed: false,
    isVisible: (surface) => surface !== "apps" && surface !== "system",
  },
  {
    id: "project",
    title: "Project",
    defaultCollapsed: false,
    isVisible: () => true,
  },
  {
    id: "chat",
    title: "Chat",
    defaultCollapsed: true,
    isVisible: (surface) => surface !== "home",
  },
];
