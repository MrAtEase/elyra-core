import type { AppManifest, InstalledApp, IntegrationStatus, ToolRegistryItem, UiBootstrapContract } from "./types";
import { getAppStatus, toLaunchpadStatus } from "@/lib/orb-os/apps/status";

export type SurfaceId = "dashboard" | "assistant" | "goals" | "apps" | "settings" | "builder" | "marketplace";

export type RenderContext = {
  role: string;
};

export type ResolvedQuickAction = {
  app_id: string;
  app_name: string;
  action_id: string;
  label: string;
  intent: string;
  tool_ref: string;
  requires_auth: boolean;
  requires_approval: boolean;
  state: "ready" | "needs_auth" | "policy_blocked" | "disabled";
  badges: Array<"connected" | "needs_auth" | "degraded" | "policy_blocked" | "disabled">;
};

export type ResolvedUiModel = {
  visible_surfaces: SurfaceId[];
  orb_quick_actions: ResolvedQuickAction[];
  edge_rail_apps: AppManifest[];
  apps_surface_apps: AppManifest[];
  dashboard_widgets: AppManifest[];
};

export type ResolvedAppsSurfaceEntry = {
  app_id: string;
  source_app_id: string;
  name: string;
  category: string;
  icon_name: string;
  launch_hint: "mail" | "calendar" | "tasks" | "files" | "slides" | "builder" | null;
  status: "connected" | "needs_auth" | "needs_scope" | "degraded" | "policy_blocked";
  scope_hints: string[];
};

type ResolveAppsSurfaceInput = {
  workspaceId: string;
  manifests: AppManifest[];
  installedApps: InstalledApp[];
  toolRegistry: ToolRegistryItem[];
  integrationStatus: IntegrationStatus[];
  googleConnectionState?: "connected" | "needs_auth" | "needs_scope" | "degraded" | "disconnected";
};

function isAdminRole(role: string): boolean {
  const normalized = role.toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "system_owner";
}

function surfaceAllowed(level: "enabled" | "hidden" | "read_only" | "admin_only", role: string): boolean {
  if (level === "hidden") return false;
  if (level === "admin_only") return isAdminRole(role);
  return true;
}

function getIntegrationState(integration: IntegrationStatus[] | undefined, integrationId: string): IntegrationStatus["state"] {
  if (!integration) return "disconnected";
  const found = integration.find((entry) => entry.integration_id === integrationId);
  return found?.state || "disconnected";
}

function toolStatus(toolRegistry: ToolRegistryItem[], toolRef: string): ToolRegistryItem["status"] {
  return toolRegistry.find((entry) => entry.tool_name === toolRef)?.status || "disabled";
}

function isInstalled(contract: UiBootstrapContract, appId: string): boolean {
  return contract.installed_apps.some((app) => app.app_id === appId && app.installed && app.enabled);
}

function isInstalledInList(installedApps: InstalledApp[], appId: string): boolean {
  return installedApps.some((app) => app.app_id === appId && app.installed && app.enabled);
}

function hasToolFamily(toolRegistry: ToolRegistryItem[], families: string[]): boolean {
  return toolRegistry.some((tool) => families.some((family) => tool.tool_name.startsWith(family)));
}

function toolFamilyBlocked(toolRegistry: ToolRegistryItem[], families: string[]): boolean {
  const familyTools = toolRegistry.filter((tool) => families.some((family) => tool.tool_name.startsWith(family)));
  if (familyTools.length === 0) return false;
  return familyTools.every((tool) => tool.status === "policy_blocked");
}

export function resolveAppsSurfaceEntries(input: ResolveAppsSurfaceInput): ResolvedAppsSurfaceEntry[] {
  const installedManifests = input.manifests.filter(
    (manifest) => manifest.surfaces.includes("apps_surface") && isInstalledInList(input.installedApps, manifest.app_id),
  );

  const entries: ResolvedAppsSurfaceEntry[] = [];
  for (const manifest of installedManifests) {
    if (manifest.app_id !== "google_workspace") {
      const resolvedStatus = getAppStatus({
        workspaceId: input.workspaceId,
        appId: manifest.app_id,
        manifests: input.manifests,
        installedApps: input.installedApps,
        integrationStatus: input.integrationStatus,
        toolRegistry: input.toolRegistry,
      });
      entries.push({
        app_id: manifest.app_id,
        source_app_id: manifest.app_id,
        name: manifest.name,
        category: manifest.category,
        icon_name: manifest.icon.name,
        launch_hint:
          manifest.app_id === "mail" || manifest.app_id === "calendar" || manifest.app_id === "tasks" || manifest.app_id === "files" || manifest.app_id === "slides" || manifest.app_id === "builder"
            ? manifest.app_id
            : null,
        status: toLaunchpadStatus(resolvedStatus.status),
        scope_hints: [],
      });
      continue;
    }

    const subApps = [
      { id: "mail", label: "Mail", icon: "mail", category: "communication", launch: "mail" as const, tools: ["google_mail.", "gmail."], scopes: ["gmail.readonly", "gmail.send"] },
      { id: "calendar", label: "Calendar", icon: "calendar", category: "productivity", launch: "calendar" as const, tools: ["google_calendar.", "calendar."], scopes: ["calendar.readonly", "calendar.events"] },
      { id: "tasks", label: "Tasks", icon: "tasks", category: "productivity", launch: "tasks" as const, tools: ["google_tasks.", "tasks."], scopes: ["tasks"] },
      { id: "drive", label: "Drive", icon: "files", category: "productivity", launch: "files" as const, tools: ["google_drive.", "drive."], scopes: ["drive.readonly", "drive.file"] },
      { id: "slides", label: "Slides", icon: "slides", category: "productivity", launch: "slides" as const, tools: ["google_slides.", "slides."], scopes: ["presentations"] },
      { id: "docs", label: "Docs", icon: "files", category: "productivity", launch: "files" as const, tools: ["google_docs.", "docs."], scopes: ["documents"] },
      { id: "research", label: "Research", icon: "globe", category: "research", launch: "builder" as const, tools: ["research.", "web.", "search."], scopes: [] },
      { id: "weather", label: "Weather", icon: "cloud-sun", category: "utility", launch: "builder" as const, tools: ["weather."], scopes: [] },
    ];

    for (const sub of subApps) {
      if (!hasToolFamily(input.toolRegistry, sub.tools)) continue;
      const blocked = toolFamilyBlocked(input.toolRegistry, sub.tools);
      const forceGoogleProvider =
        sub.id !== "mail" && sub.id !== "calendar";
      const resolvedStatus = getAppStatus({
        workspaceId: input.workspaceId,
        appId: sub.id,
        manifests: input.manifests,
        installedApps: input.installedApps,
        integrationStatus: input.integrationStatus,
        toolRegistry: input.toolRegistry,
        ...(forceGoogleProvider ? { requiredProvider: "google" as const } : {}),
        requiredScopes: sub.scopes,
      });
      const status: ResolvedAppsSurfaceEntry["status"] = blocked
        ? "policy_blocked"
        : toLaunchpadStatus(resolvedStatus.status);

      entries.push({
        app_id: sub.id,
        source_app_id: manifest.app_id,
        name: sub.label,
        category: sub.category,
        icon_name: sub.icon,
        launch_hint: sub.launch,
        status,
        scope_hints: sub.scopes,
      });
    }
  }

  const deduped: ResolvedAppsSurfaceEntry[] = [];
  const seenIndex = new Map<string, number>();
  for (const entry of entries) {
    const existingIndex = seenIndex.get(entry.app_id);
    if (typeof existingIndex === "number") {
      const existing = deduped[existingIndex];
      if (existing && existing.source_app_id === "google_workspace" && entry.source_app_id !== "google_workspace") {
        deduped[existingIndex] = entry;
      }
      continue;
    }
    seenIndex.set(entry.app_id, deduped.length);
    deduped.push(entry);
  }

  return deduped;
}

function resolveQuickActionState(
  manifest: AppManifest,
  toolRegistry: ToolRegistryItem[],
  integration: IntegrationStatus[]
): ResolvedQuickAction[] {
  return manifest.quick_actions.map((action) => {
    const tool = toolStatus(toolRegistry, action.tool_ref);
    if (tool === "disabled") {
      return {
        app_id: manifest.app_id,
        app_name: manifest.name,
        action_id: action.id,
        label: action.label,
        intent: action.intent,
        tool_ref: action.tool_ref,
        requires_auth: action.requires_auth,
        requires_approval: action.requires_approval,
        state: "disabled",
        badges: ["disabled"],
      };
    }
    if (tool === "policy_blocked") {
      return {
        app_id: manifest.app_id,
        app_name: manifest.name,
        action_id: action.id,
        label: action.label,
        intent: action.intent,
        tool_ref: action.tool_ref,
        requires_auth: action.requires_auth,
        requires_approval: action.requires_approval,
        state: "policy_blocked",
        badges: ["policy_blocked"],
      };
    }

    const needsAuth = manifest.auth_requirements.some((requirement) => {
      if (requirement.mode !== "required") return false;
      return getIntegrationState(integration, requirement.integration_id) !== "connected";
    });

    return {
      app_id: manifest.app_id,
      app_name: manifest.name,
      action_id: action.id,
      label: action.label,
      intent: action.intent,
      tool_ref: action.tool_ref,
      requires_auth: action.requires_auth,
      requires_approval: action.requires_approval,
      state: needsAuth ? "needs_auth" : "ready",
      badges: needsAuth ? ["needs_auth"] : ["connected"],
    };
  });
}

export function resolveUiModel(contract: UiBootstrapContract, context: RenderContext): ResolvedUiModel {
  const surfaces: SurfaceId[] = ["dashboard", "assistant", "goals", "apps", "settings", "builder", "marketplace"];
  const visibleSurfaces = surfaces.filter((surface) => surfaceAllowed(contract.workspace_capabilities.surfaces[surface], context.role));

  const installedManifests = contract.app_manifest.filter((manifest) => isInstalled(contract, manifest.app_id));

  const orbQuickActions = installedManifests
    .filter((manifest) => manifest.surfaces.includes("orb"))
    .flatMap((manifest) => resolveQuickActionState(manifest, contract.tool_registry, contract.integration_status));

  const edgeRailApps = installedManifests.filter((manifest) => manifest.surfaces.includes("edge_rail"));
  const appsSurfaceApps = installedManifests.filter((manifest) => manifest.surfaces.includes("apps_surface"));
  const dashboardWidgets = installedManifests.filter((manifest) => manifest.surfaces.includes("dashboard_widget"));

  return {
    visible_surfaces: visibleSurfaces,
    orb_quick_actions: orbQuickActions,
    edge_rail_apps: edgeRailApps,
    apps_surface_apps: appsSurfaceApps,
    dashboard_widgets: dashboardWidgets,
  };
}
