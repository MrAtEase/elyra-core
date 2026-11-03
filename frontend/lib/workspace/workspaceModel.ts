import type { WhoamiWorkspace } from "@/types/whoami";
import { normalizeWorkspaceType } from "@/lib/workspace/workspaceType";

export type WorkspaceScope = "system_platform" | "company" | "personal";
export type AppRole =
  | "system_owner"
  | "workspace_owner"
  | "workspace_admin"
  | "workspace_member"
  | "workspace_viewer";

const read = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const DEFAULT_SYSTEM_DOMAINS = ["elyra-core.app"];
const DEFAULT_SYSTEM_EMAILS = ["paul@elyra-core.app", "paul.odak@elyra-core.app"];

export function getFounderAllowlist(): string[] {
  const envAllowlist = (process.env.NEXT_PUBLIC_SYSTEM_FOUNDER_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_SYSTEM_EMAILS, ...envAllowlist])];
}

export function isFounderIdentity(email: string | null | undefined): boolean {
  const normalized = read(email);
  if (!normalized) return false;
  if (getFounderAllowlist().includes(normalized)) return true;
  const domain = normalized.split("@")[1] ?? "";
  return DEFAULT_SYSTEM_DOMAINS.includes(domain);
}

export function classifyWorkspaceScope(
  workspace: Pick<WhoamiWorkspace, "type"> | null | undefined,
  userEmail?: string | null
): WorkspaceScope {
  const normalizedType = normalizeWorkspaceType(workspace?.type);
  if (normalizedType === "system") return "system_platform";
  if (isFounderIdentity(userEmail) && normalizedType === "team") {
    return "system_platform";
  }
  if (normalizedType === "team") return "company";
  return "personal";
}

export function normalizeAppRole(
  rawRole: string | null | undefined,
  userEmail?: string | null,
  scope?: WorkspaceScope
): AppRole {
  const role = read(rawRole);
  if (role === "system_owner") return "system_owner";
  if (isFounderIdentity(userEmail) && scope === "system_platform") return "system_owner";
  if (role === "owner" || role === "workspace_owner" || role === "founder") return "workspace_owner";
  if (role === "admin" || role === "administrator" || role === "workspace_admin") {
    return "workspace_admin";
  }
  if (role === "viewer" || role === "workspace_viewer") return "workspace_viewer";
  return "workspace_member";
}

export function canAccessSystemPlatform(role: AppRole): boolean {
  return role === "system_owner";
}

export function scopeLabel(scope: WorkspaceScope): string {
  if (scope === "system_platform") return "System Platform";
  if (scope === "company") return "Company Workspace";
  return "Personal Workspace";
}

export function roleLabel(role: AppRole): string {
  if (role === "system_owner") return "Founder / System Owner";
  if (role === "workspace_owner") return "Workspace Owner";
  if (role === "workspace_admin") return "Workspace Admin";
  if (role === "workspace_viewer") return "Workspace Viewer";
  return "Workspace Member";
}

export function workspaceTypeLabel(
  workspace: Pick<WhoamiWorkspace, "type" | "name"> | null | undefined,
  userEmail?: string | null
): string {
  const scope = classifyWorkspaceScope(workspace, userEmail);
  if (scope === "system_platform") return "Business / System";
  if (scope === "company") return "Business";
  return "Personal";
}

export function workspaceNameLabel(
  workspace: Pick<WhoamiWorkspace, "name" | "type"> | null | undefined,
  userEmail?: string | null
): string {
  if (!workspace) return "Workspace";
  const normalizedName = read(workspace.name);
  const scope = classifyWorkspaceScope(workspace, userEmail);
  if (scope === "system_platform" && isFounderIdentity(userEmail)) {
    return "Elyra Core (Company)";
  }
  return normalizedName ? workspace.name : "Workspace";
}
