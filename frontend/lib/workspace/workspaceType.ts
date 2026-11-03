export type WorkspaceType = "personal" | "team" | "system";

const read = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function normalizeWorkspaceType(rawType: unknown): WorkspaceType {
  const value = read(rawType);

  if (
    value === "system" ||
    value === "system_platform" ||
    value === "platform" ||
    value === "elyra_core"
  ) {
    return "system";
  }

  if (
    value === "team" ||
    value === "company" ||
    value === "business" ||
    value === "organization" ||
    value === "org"
  ) {
    return "team";
  }

  return "personal";
}

export function isSystemWorkspaceType(rawType: unknown): boolean {
  return normalizeWorkspaceType(rawType) === "system";
}

export function workspaceTypeLabel(type: WorkspaceType): string {
  if (type === "system") return "System";
  if (type === "team") return "Team";
  return "Personal";
}
