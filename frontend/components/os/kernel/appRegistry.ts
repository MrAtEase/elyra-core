import type { AppManifest, AppId, WorkspaceKind } from "@/components/os/kernel/types";

const REGISTRY: AppManifest[] = [
  { id: "mail", name: "Mail", icon: "✉", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "calendar", name: "Kalender", icon: "◷", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "tasks", name: "Aufgaben", icon: "✓", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "files", name: "Dateien", icon: "▣", category: "productivity", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "graph", name: "Wissensgraph", icon: "◌", category: "governance", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "builder", name: "Builder", icon: "◧", category: "develop", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "slides", name: "Folien", icon: "▤", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "image_studio", name: "Bilder", icon: "◐", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "studio", name: "Studio", icon: "✦", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "reporting", name: "Reporting", icon: "▥", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "leads", name: "Leads", icon: "◎", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "toolbox", name: "Werkzeuge", icon: "⚒", category: "insights", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "visibility", name: "KI-Sichtbarkeit", icon: "◉", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "synergy", name: "Paid × Organic", icon: "◆", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "feed", name: "Feed-Optimierer", icon: "◆", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "insights", name: "Newsletter-Digest", icon: "◆", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "automations", name: "Automationen", icon: "◆", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "ads_audit", name: "Ads-Audit", icon: "⌕", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "agent_team", name: "Agenten-Team", icon: "⚇", category: "marketing", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "guitar", name: "Gitarre", icon: "♫", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "languages", name: "Sprachen", icon: "文", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "magic", name: "Kartenmagie", icon: "♠", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "marketplace", name: "Marktplatz", icon: "▦", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "mini_apps", name: "Meine Apps", icon: "✦", category: "create", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "weather", name: "Wetter", icon: "◈", category: "utility", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_ai", name: "KI-Einstellungen", icon: "◎", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_os", name: "Einstellungen", icon: "⚙", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "settings_admin", name: "Team & Rechte", icon: "◫", category: "governance", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  { id: "approvals", name: "Freigaben", icon: "✓", category: "governance", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "audit", name: "Audit-Log", icon: "◉", category: "governance", availableIn: ["organization", "platform"], openAs: "window" },
  { id: "runs", name: "KI-Läufe", icon: "◈", category: "governance", availableIn: ["individual", "organization", "platform"], openAs: "window" },
];

export const APP_REGISTRY: AppManifest[] = REGISTRY;

/** Display order and German labels of app categories (launchpad grouping). */
export const APP_CATEGORY_ORDER: Array<{ id: AppManifest["category"]; label: string }> = [
  { id: "productivity", label: "Organisation" },
  { id: "create", label: "Erstellen" },
  { id: "marketing", label: "Marketing" },
  { id: "insights", label: "Wissen & Recherche" },
  { id: "utility", label: "Alltag & Freizeit" },
  { id: "develop", label: "Entwicklung" },
  { id: "governance", label: "Verwaltung" },
];

export function appCategoryLabel(category: AppManifest["category"]): string {
  return APP_CATEGORY_ORDER.find((entry) => entry.id === category)?.label ?? category;
}

export function listAppsForWorkspace(kind: WorkspaceKind): AppManifest[] {
  return APP_REGISTRY.filter((app) => app.availableIn.includes(kind));
}

/** Apps shown in the launcher and the Apps tab (one shared list). */
export function listLauncherApps(kind: WorkspaceKind, options: { platformOwner: boolean }): AppManifest[] {
  return listAppsForWorkspace(kind).filter((app) => {
    if (app.category === "settings") return false;
    if (app.id === "marketplace" || app.id === "mini_apps") return false; // own entry points
    if (app.category === "develop" && !options.platformOwner) return false; // code changes: owner only
    return true;
  });
}

export function getApp(appId: AppId): AppManifest | undefined {
  return APP_REGISTRY.find((app) => app.id === appId);
}
