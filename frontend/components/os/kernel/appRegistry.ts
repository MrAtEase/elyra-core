import type { AppManifest, AppId, WorkspaceKind } from "@/components/os/kernel/types";

const REGISTRY: AppManifest[] = [
  { id: "mail", name: "Mail", icon: "✉", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "calendar", name: "Calendar", icon: "◷", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "tasks", name: "Tasks", icon: "✓", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "files", name: "Files", icon: "▣", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "graph", name: "Graph", icon: "◌", category: "insights", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "builder", name: "Builder", icon: "◧", category: "develop", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "slides", name: "Slides", icon: "▤", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "image_studio", name: "Bilder", icon: "◐", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "studio", name: "Studio", icon: "✦", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "code", name: "Code", icon: "⌥", category: "develop", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "reporting", name: "Reporting", icon: "▥", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "leads", name: "Leads", icon: "◎", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "weather", name: "Weather", icon: "◈", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_ai", name: "AI Settings", icon: "◎", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_os", name: "OS Settings", icon: "⚙", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_admin", name: "Admin Settings", icon: "◫", category: "settings", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "approvals", name: "Approvals", icon: "✓", category: "governance", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "audit", name: "Audit Log", icon: "◉", category: "governance", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "runs", name: "AI Runs", icon: "◈", category: "insights", availableIn: ["individual", "organization", "platform"], openAs: "window" },
];

export const APP_REGISTRY: AppManifest[] = REGISTRY;

/** Display order and German labels of app categories (launchpad grouping). */
export const APP_CATEGORY_ORDER: Array<{ id: AppManifest["category"]; label: string }> = [
  { id: "productivity", label: "Kommunikation & Organisation" },
  { id: "marketing", label: "Marketing Tools" },
  { id: "create", label: "Erstellen & Präsentieren" },
  { id: "develop", label: "Entwicklung & Automatisierung" },
  { id: "insights", label: "Wissen & KI-Aktivität" },
  { id: "governance", label: "Freigaben & Kontrolle" },
  { id: "utility", label: "Alltag & Tools" },
];

export function appCategoryLabel(category: AppManifest["category"]): string {
  return APP_CATEGORY_ORDER.find((entry) => entry.id === category)?.label ?? category;
}

export function listAppsForWorkspace(kind: WorkspaceKind): AppManifest[] {
  return APP_REGISTRY.filter((app) => app.availableIn.includes(kind));
}

export function getApp(appId: AppId): AppManifest | undefined {
  return APP_REGISTRY.find((app) => app.id === appId);
}
