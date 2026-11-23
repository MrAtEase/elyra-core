import type { Permission } from "./types";
import privateDefault from "./manifests/privateDefault";
import fishDelishCore from "./manifests/fishDelishCore";
import companyTemplate from "./manifests/companyTemplate";
import { normalizeWorkspaceType } from "@/lib/workspace/workspaceType";

export type ActiveManifestInput = {
  activeWorkspace: {
    id?: string;
    slug?: string;
    name?: string;
    type?: string;
  } | null;
  membership?: { role?: string | null } | null;
  permissions?: Permission[] | Record<string, boolean> | null;
};

const readWorkspaceField = (workspace: Record<string, unknown> | null, key: string) => {
  const value = workspace?.[key];
  return typeof value === "string" ? value.trim() : "";
};

const normalizeWorkspaceTokens = (workspace: ActiveManifestInput["activeWorkspace"]) => {
  if (!workspace) return "";
  const workspaceRecord = workspace as Record<string, unknown>;
  return [
    workspace.type,
    workspace.slug,
    workspace.name,
    readWorkspaceField(workspaceRecord, "kind"),
    readWorkspaceField(workspaceRecord, "template"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const isPrivateWorkspace = (workspace: ActiveManifestInput["activeWorkspace"]) => {
  // Heuristic: treat workspaces with type/slug/name containing "personal" or "private" as private.
  const tokens = normalizeWorkspaceTokens(workspace);
  return tokens.includes("personal") || tokens.includes("private");
};

const isFishDelishWorkspace = (workspace: ActiveManifestInput["activeWorkspace"]) => {
  // Heuristic: match slug/name/kind/template containing "fish-delish" (dash/space/compact variants).
  const tokens = normalizeWorkspaceTokens(workspace);
  return (
    tokens.includes("fish-delish") ||
    tokens.includes("fish delish") ||
    tokens.includes("fishdelish")
  );
};

export const getActiveManifest = ({ activeWorkspace }: ActiveManifestInput) => {
  if (!activeWorkspace) {
    return privateDefault;
  }

  const workspaceType = normalizeWorkspaceType(activeWorkspace.type);
  if (workspaceType === "personal" || isPrivateWorkspace(activeWorkspace)) {
    return privateDefault;
  }

  if (isFishDelishWorkspace(activeWorkspace)) {
    return fishDelishCore;
  }

  return companyTemplate;
};

export default getActiveManifest;
