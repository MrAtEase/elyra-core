type AccessPayload = Record<string, any> | null;

const readStringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeRoleValue = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized === "administrator") return "admin";
  if (normalized === "workspace_owner") return "owner";
  if (normalized === "workspace_admin") return "admin";
  if (normalized === "workspace_member") return "member";
  if (normalized === "workspace_viewer") return "viewer";
  if (normalized === "member") return "staff";
  return normalized;
};

export type CapabilityReason = {
  grantedBy: "role" | "connection";
  connection?: {
    domain?: string | null;
    provider?: string | null;
    access?: string | null;
    connectionId?: string | null;
  };
  missing?: boolean;
};

export type WorkspaceAccess = {
  rawRole: string;
  normalizedRole: string;
  isAdminFlag: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isAdminOrOwner: boolean;
  capabilities: string[];
  capabilityReasons: Record<string, CapabilityReason>;
  canManageMembers: boolean;
  canManageIdentity: boolean;
  canManageAccess: boolean;
  canManageConnections: boolean;
};

export const CAPABILITY_LABELS: Record<string, string> = {
  "work.tasks.view": "View tasks",
  "work.tasks.write": "Edit tasks",
  "work.tasks.assign": "Assign tasks",
  "work.mail.view": "Read workspace mail",
  "work.mail.send": "Send workspace mail",
  "work.calendar.view": "View calendar",
  "work.calendar.write": "Edit calendar",
  "mail.read": "Mail read (provider)",
  "mail.write": "Mail send (provider)",
  "calendar.read": "Calendar read (provider)",
  "calendar.write": "Calendar write (provider)",
  "docs.read": "Docs read",
  "docs.write": "Docs write",
  "commerce.read": "Commerce read",
  "commerce.write": "Commerce write",
  "infra.read": "Infrastructure read",
  "infra.write": "Infrastructure write",
  "workspace.identity.manage": "Manage workspace identity",
  "workspace.members.manage": "Manage members & roles",
  "workspace.access.manage": "Manage access requests",
  "workspace.connections.manage": "Manage connections",
};

export function getCapabilityLabel(capability: string) {
  return CAPABILITY_LABELS[capability] ?? capability;
}

export function getWorkspaceAccess(data: AccessPayload): WorkspaceAccess {
  const rawRole =
    readStringValue(data?.membership?.role) ||
    readStringValue(data?.role) ||
    readStringValue(data?.user?.role) ||
    readStringValue(data?.permissions?.role ?? data?.permissions?.accessLevel);
  const normalizedRole = normalizeRoleValue(rawRole);
  const isAdminFlag = Boolean(data?.user?.isAdmin) || Boolean(data?.isAdmin) || Boolean(data?.permissions?.isAdmin);
  const isOwner = normalizedRole === "owner" || normalizedRole === "system_owner";
  const isAdmin = normalizedRole === "admin";
  const capabilities = Array.isArray(data?.capabilities)
    ? data.capabilities.filter((cap: unknown): cap is string => typeof cap === "string")
    : [];
  const capabilityReasons =
    data?.capabilityReasons && typeof data.capabilityReasons === "object"
      ? (data.capabilityReasons as Record<string, CapabilityReason>)
      : {};
  const isAdminOrOwner = isAdminFlag || isOwner || isAdmin || normalizedRole === "system_owner";
  const canManageIdentity = capabilities.includes("workspace.identity.manage") || isAdminOrOwner;
  const canManageMembers = capabilities.includes("workspace.members.manage") || isAdminOrOwner;
  const canManageAccess = capabilities.includes("workspace.access.manage") || isAdminOrOwner;
  const canManageConnections =
    capabilities.includes("workspace.connections.manage") || isAdminOrOwner;
  return {
    rawRole,
    normalizedRole,
    isAdminFlag,
    isOwner,
    isAdmin,
    isAdminOrOwner,
    capabilities,
    capabilityReasons,
    canManageIdentity,
    canManageMembers,
    canManageAccess,
    canManageConnections,
  };
}

export function hasCapability(access: WorkspaceAccess, capability: string) {
  return access.capabilities.includes(capability);
}

export function getCapabilityReason(access: WorkspaceAccess, capability: string) {
  return access.capabilityReasons?.[capability] ?? null;
}

export function getMissingCapabilities(access: WorkspaceAccess, required: string[]) {
  return required.filter((cap) => !hasCapability(access, cap));
}
