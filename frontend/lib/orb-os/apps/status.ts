import type { AppManifest, InstalledApp, IntegrationStatus, ToolRegistryItem } from "@/lib/orb-os/contracts/types";
import { hasRequiredScopes } from "@/lib/google/scopes";

export type AppConnectionStatus =
  | "connected_ok"
  | "needs_auth"
  | "missing_scopes"
  | "error"
  | "not_connected"
  | "disabled";

export type LaunchpadStatus = "connected" | "needs_auth" | "needs_scope" | "degraded" | "policy_blocked";

export type AppStatusResolution = {
  status: AppConnectionStatus;
  missingScopes: string[];
  provider: string | null;
};

type GetAppStatusInput = {
  workspaceId: string;
  appId: string;
  manifests: AppManifest[];
  installedApps: InstalledApp[];
  integrationStatus: IntegrationStatus[];
  toolRegistry: ToolRegistryItem[];
  requiredProvider?: string | null;
  requiredScopes?: readonly string[];
};

const GOOGLE_SUBAPP_RULES: Record<string, { provider: string; scopes: string[]; tools: string[] }> = {
  mail: {
    provider: "google",
    scopes: ["gmail.readonly"],
    tools: ["google_mail.", "gmail."],
  },
  calendar: {
    provider: "google",
    scopes: ["calendar.readonly"],
    tools: ["google_calendar.", "calendar."],
  },
  tasks: {
    provider: "google",
    scopes: ["tasks.readonly"],
    tools: ["google_tasks.", "tasks."],
  },
  drive: {
    provider: "google",
    scopes: ["drive.readonly"],
    tools: ["google_drive.", "drive."],
  },
  slides: {
    provider: "google",
    scopes: ["presentations"],
    tools: ["google_slides.", "slides."],
  },
  docs: {
    provider: "google",
    scopes: ["documents"],
    tools: ["google_docs.", "docs."],
  },
};

const APP_PROVIDER_CANDIDATES: Record<string, Array<{ provider: string; scopes: string[] }>> = {
  mail: [
    { provider: "google", scopes: ["gmail.readonly"] },
    { provider: "imap", scopes: [] },
    { provider: "icloud_imap", scopes: [] },
  ],
  calendar: [
    { provider: "google", scopes: ["calendar.readonly"] },
    { provider: "icloud_caldav", scopes: [] },
  ],
};

function isEnabledInWorkspace(installedApps: InstalledApp[], workspaceId: string, appId: string): boolean {
  const row = installedApps.find((item) => item.workspace_id === workspaceId && item.app_id === appId);
  return Boolean(row?.installed && row?.enabled);
}

function providerToIntegrationId(provider: string): string {
  if (provider === "google") return "google_oauth";
  if (provider === "imap") return "imap";
  return provider;
}

function integrationForProvider(integrationStatus: IntegrationStatus[], provider: string): IntegrationStatus | null {
  const integrationId = providerToIntegrationId(provider);
  const direct = integrationStatus.find((entry) => entry.integration_id === integrationId) ?? null;
  if (direct) return direct;
  if (provider === "imap") {
    return integrationStatus.find((entry) => entry.integration_id === "icloud_imap") ?? null;
  }
  return null;
}

function computeMissingScopes(grantedScopes: readonly string[], requiredScopes: readonly string[]): string[] {
  if (requiredScopes.length === 0) return [];
  return requiredScopes.filter((scope) => !hasRequiredScopes(grantedScopes, [scope]).ok);
}

function familyToolsBlocked(toolRegistry: ToolRegistryItem[], families: readonly string[]): boolean {
  const familyTools = toolRegistry.filter((tool) => families.some((family) => tool.tool_name.startsWith(family)));
  if (familyTools.length === 0) return false;
  return familyTools.every((tool) => tool.status === "policy_blocked");
}

export function getAppStatus(input: GetAppStatusInput): AppStatusResolution {
  const manifest = input.manifests.find((item) => item.app_id === input.appId) ?? null;
  if (manifest && !isEnabledInWorkspace(input.installedApps, input.workspaceId, manifest.app_id)) {
    return { status: "disabled", missingScopes: [], provider: null };
  }

  const subAppRule = GOOGLE_SUBAPP_RULES[input.appId];
  const requiredProvider = input.requiredProvider ?? subAppRule?.provider ?? null;
  const requiredScopes = input.requiredScopes ?? subAppRule?.scopes ?? [];

  if (!input.requiredProvider && APP_PROVIDER_CANDIDATES[input.appId]) {
    const candidates = APP_PROVIDER_CANDIDATES[input.appId]!;
    const statuses = candidates.map((candidate) =>
      getAppStatus({
        ...input,
        requiredProvider: candidate.provider,
        requiredScopes: candidate.scopes,
      })
    );
    const connected = statuses.find((status) => status.status === "connected_ok");
    if (connected) return connected;
    const degraded = statuses.find((status) => status.status === "error");
    if (degraded) return degraded;
    const missingScopes = statuses.find((status) => status.status === "missing_scopes");
    if (missingScopes) return missingScopes;
    const needsAuth = statuses.find((status) => status.status === "needs_auth");
    if (needsAuth) return needsAuth;
    return statuses[0] ?? { status: "not_connected", missingScopes: [], provider: null };
  }

  if (subAppRule && familyToolsBlocked(input.toolRegistry, subAppRule.tools)) {
    return { status: "error", missingScopes: [], provider: requiredProvider };
  }

  if (!requiredProvider) {
    if (manifest?.auth_requirements?.length) {
      for (const requirement of manifest.auth_requirements) {
        if (requirement.mode !== "required") continue;
        const integration = input.integrationStatus.find((entry) => entry.integration_id === requirement.integration_id) ?? null;
        if (!integration || !integration.connected || integration.state === "needs_auth" || integration.state === "disconnected") {
          return { status: "needs_auth", missingScopes: requirement.required_scopes, provider: requirement.integration_id };
        }
        const missing = computeMissingScopes(integration.scopes, requirement.required_scopes);
        if (missing.length > 0) {
          return { status: "missing_scopes", missingScopes: missing, provider: requirement.integration_id };
        }
        if (integration.state === "degraded") {
          return { status: "error", missingScopes: [], provider: requirement.integration_id };
        }
      }
    }
    return { status: "connected_ok", missingScopes: [], provider: null };
  }

  const integration = integrationForProvider(input.integrationStatus, requiredProvider);
  if (!integration) {
    return { status: "not_connected", missingScopes: requiredScopes.slice(), provider: requiredProvider };
  }
  if (integration.state === "degraded") {
    return { status: "error", missingScopes: [], provider: requiredProvider };
  }
  if (!integration.connected || integration.state === "needs_auth" || integration.state === "disconnected") {
    return { status: "needs_auth", missingScopes: requiredScopes.slice(), provider: requiredProvider };
  }

  const missingScopes = computeMissingScopes(integration.scopes, requiredScopes);
  if (missingScopes.length > 0) {
    return { status: "missing_scopes", missingScopes, provider: requiredProvider };
  }

  return { status: "connected_ok", missingScopes: [], provider: requiredProvider };
}

export function toLaunchpadStatus(status: AppConnectionStatus): LaunchpadStatus {
  switch (status) {
    case "connected_ok":
      return "connected";
    case "missing_scopes":
      return "needs_scope";
    case "needs_auth":
    case "not_connected":
    case "disabled":
      return "needs_auth";
    case "error":
      return "degraded";
    default:
      return "needs_auth";
  }
}
