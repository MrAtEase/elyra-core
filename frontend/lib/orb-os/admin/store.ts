import type { UiBootstrapContract } from "@/lib/orb-os/contracts/types";

export type CapabilityLevel = "enabled" | "hidden" | "read_only" | "admin_only";

type WorkspaceAdminOverride = {
  surfaces: Record<string, CapabilityLevel>;
  capabilities: Record<string, CapabilityLevel>;
  installedApps: Record<string, { installed: boolean; enabled: boolean }>;
};

const workspaceOverrides = new Map<string, WorkspaceAdminOverride>();

function getOrCreateOverride(workspaceId: string): WorkspaceAdminOverride {
  const existing = workspaceOverrides.get(workspaceId);
  if (existing) return existing;
  const next: WorkspaceAdminOverride = { surfaces: {}, capabilities: {}, installedApps: {} };
  workspaceOverrides.set(workspaceId, next);
  return next;
}

export function updateCapabilityOverride(input: {
  workspaceId: string;
  kind: "surface" | "capability";
  id: string;
  status: CapabilityLevel;
}) {
  const override = getOrCreateOverride(input.workspaceId);
  if (input.kind === "surface") override.surfaces[input.id] = input.status;
  else override.capabilities[input.id] = input.status;
}

export function updateAppOverride(input: {
  workspaceId: string;
  appId: string;
  action: "install" | "enable" | "disable" | "uninstall";
}) {
  const override = getOrCreateOverride(input.workspaceId);
  const current = override.installedApps[input.appId] ?? { installed: false, enabled: false };
  if (input.action === "install") override.installedApps[input.appId] = { installed: true, enabled: true };
  if (input.action === "enable") override.installedApps[input.appId] = { ...current, installed: true, enabled: true };
  if (input.action === "disable") override.installedApps[input.appId] = { ...current, installed: true, enabled: false };
  if (input.action === "uninstall") override.installedApps[input.appId] = { installed: false, enabled: false };
}

export function applyAdminOverrides(contract: UiBootstrapContract): UiBootstrapContract {
  const override = workspaceOverrides.get(contract.workspace_id);
  if (!override) return contract;

  const nextContract: UiBootstrapContract = {
    ...contract,
    workspace_capabilities: {
      ...contract.workspace_capabilities,
      surfaces: {
        ...contract.workspace_capabilities.surfaces,
        ...override.surfaces,
      },
      capabilities: {
        ...contract.workspace_capabilities.capabilities,
        ...override.capabilities,
      },
    },
    installed_apps: contract.installed_apps.map((entry) => {
      const appOverride = override.installedApps[entry.app_id];
      if (!appOverride) return entry;
      return {
        ...entry,
        installed: appOverride.installed,
        enabled: appOverride.enabled,
      };
    }),
  };

  return nextContract;
}
