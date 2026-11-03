export const normalizePolicyKey = (value?: string | null) =>
  (value ?? "").trim().toLowerCase();

export const matchesWorkspaceKey = (
  workspace: { id?: string | null; slug?: string | null } | null | undefined,
  key?: string | null
) => {
  const normalizedKey = normalizePolicyKey(key);
  if (!workspace || !normalizedKey) return false;
  return (
    normalizePolicyKey(workspace.id) === normalizedKey ||
    normalizePolicyKey(workspace.slug) === normalizedKey
  );
};

export const buildWorkspaceStorageKey = (identity?: {
  id?: string | null;
  email?: string | null;
} | null) => {
  const identityId = normalizePolicyKey(identity?.id);
  const identityEmail = normalizePolicyKey(identity?.email);
  const key = identityEmail || identityId;
  if (!key) return null;
  return `active_workspace::${key}`;
};

// Workspace display labels (override workspace.name from DB)
export const WORKSPACE_LABELS: Record<string, string> = {
  "ws-personal":   "Personal",
  "ws-elyra-core": "Elli",
  "ws-fish-delish": "Fish",
};

// Default workspace per identity (email or domain)
export const IDENTITY_DEFAULT_WORKSPACE: Record<string, string> = {
  "paul.odak@icloud.com":    "ws-personal",
  "paul.odak@fish-delish.pt": "ws-fish-delish",
  "elyra-core.app":          "ws-elyra-core",
};

// Allowed workspaces per identity — empty means all visible workspaces
export const IDENTITY_ALLOWED_WORKSPACES: Record<string, string[]> = {
  "paul.odak@icloud.com": ["ws-personal", "ws-elyra-core", "ws-fish-delish"],
  "paul.odak@fish-delish.pt": ["ws-fish-delish"],
};

// Linked workspace groups (switching between them shows a combined view)
export const LINKED_WORKSPACES_GROUPS: string[][] = [];
