import type { WindowType } from "@/lib/os/layoutTypes";
import { normalizeWorkspaceType, type WorkspaceType } from "@/lib/workspace/workspaceType";

type PolicyProfile = {
  auditLogs: "minimal" | "standard" | "strict";
  confirmationMode: "relaxed" | "standard" | "strict";
  autonomy: "high" | "medium" | "low";
};

export type WorkspaceRuntime = {
  workspaceType: WorkspaceType;
  dockApps: WindowType[];
  quickRoutes: string[];
  policy: PolicyProfile;
};

const PERSONAL_DOCK: WindowType[] = ["runs", "files", "settings"];
const TEAM_DOCK: WindowType[] = ["runs", "approvals", "files", "settings"];
const SYSTEM_DOCK: WindowType[] = ["runs", "approvals", "files", "admin", "settings"];

const PERSONAL_ROUTES = ["mail", "calendar", "planner", "docs"];
const TEAM_ROUTES = ["mail", "calendar", "planner", "docs", "marketplace"];
const SYSTEM_ROUTES = ["mail", "calendar", "build", "marketplace", "settings"];

export function resolveWorkspaceRuntime(input: {
  workspaceType?: string | null;
  membershipRole?: string | null;
  capabilities?: string[] | null;
}): WorkspaceRuntime {
  const normalizedType = normalizeWorkspaceType(input.workspaceType);
  const normalizedRole = (input.membershipRole ?? "").toLowerCase().trim();
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const hasAdminCapability = capabilities.some((item) => item.startsWith("workspace.admin."));
  const isAdminLike =
    hasAdminCapability ||
    ["owner", "admin", "founder", "workspace_owner", "workspace_admin", "system_owner"].includes(
      normalizedRole
    );

  if (normalizedType === "system") {
    return {
      workspaceType: normalizedType,
      dockApps: SYSTEM_DOCK,
      quickRoutes: SYSTEM_ROUTES,
      policy: {
        auditLogs: "strict",
        confirmationMode: "strict",
        autonomy: "low",
      },
    };
  }

  if (normalizedType === "team") {
    return {
      workspaceType: normalizedType,
      dockApps: isAdminLike ? TEAM_DOCK : PERSONAL_DOCK,
      quickRoutes: TEAM_ROUTES,
      policy: {
        auditLogs: "standard",
        confirmationMode: "strict",
        autonomy: isAdminLike ? "medium" : "low",
      },
    };
  }

  return {
    workspaceType: normalizedType,
    dockApps: PERSONAL_DOCK,
    quickRoutes: PERSONAL_ROUTES,
    policy: {
      auditLogs: "minimal",
      confirmationMode: "relaxed",
      autonomy: "high",
    },
  };
}
