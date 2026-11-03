import type { Permission, Role, VisibilityRule } from "./types";

export type VisibilityContext = {
  role?: Role | null;
  permissions?: Permission[] | Record<string, boolean> | null;
  features?: string[] | Record<string, boolean> | null;
};

const normalizeList = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key.trim())
      .filter(Boolean);
  }
  return [];
};

export const isVisible = (rule: VisibilityRule | undefined, context: VisibilityContext): boolean => {
  if (!rule) return true;

  const role = typeof context.role === "string" ? context.role.toLowerCase() : "";
  const roleMatches =
    !rule.roles || rule.roles.length === 0
      ? true
      : rule.roles.map((entry) => entry.toLowerCase()).includes(role);

  const permissionList = normalizeList(context.permissions);
  const permissionsMatch =
    !rule.permissions || rule.permissions.length === 0
      ? true
      : rule.permissions.some((permission) => permissionList.includes(permission));

  const featureList = normalizeList(context.features);
  const featuresMatch =
    !rule.features || rule.features.length === 0
      ? true
      : rule.features.some((flag) => featureList.includes(flag));

  return roleMatches && permissionsMatch && featuresMatch;
};
