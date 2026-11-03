import type { AppManifest, AppId, WorkspaceKind } from "@/components/os/kernel/types";

const REGISTRY: AppManifest[] = [
  { id: "mail", name: "Mail", icon: "✉", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "calendar", name: "Calendar", icon: "◷", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "tasks", name: "Tasks", icon: "✓", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "files", name: "Files", icon: "▣", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "graph", name: "Graph", icon: "◌", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "builder", name: "Builder", icon: "◧", category: "build", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "slides", name: "Slides", icon: "▤", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "studio", name: "Studio", icon: "✦", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "code", name: "Code", icon: "⌥", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "weather", name: "Weather", icon: "◈", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_ai", name: "AI Settings", icon: "◎", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_os", name: "OS Settings", icon: "⚙", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_admin", name: "Admin Settings", icon: "◫", category: "settings", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "approvals", name: "Approvals", icon: "✓", category: "build", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "audit", name: "Audit Log", icon: "◉", category: "build", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "runs", name: "AI Runs", icon: "◈", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
];

export const APP_REGISTRY: AppManifest[] = REGISTRY;

export function listAppsForWorkspace(kind: WorkspaceKind): AppManifest[] {
  return APP_REGISTRY.filter((app) => app.availableIn.includes(kind));
}

export function getApp(appId: AppId): AppManifest | undefined {
  return APP_REGISTRY.find((app) => app.id === appId);
}
