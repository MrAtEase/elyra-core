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

// Display labels for the built-in workspace slots (override workspace.name from DB).
export const WORKSPACE_LABELS: Record<string, string> = {
  "ws-personal": "Persönlich",
  "ws-elyra-core": "Elyra Core",
};

// Optional per-identity defaults. Intentionally empty: which workspaces a user sees
// is decided by the server (memberships), never by hard-coded email addresses.
export const IDENTITY_DEFAULT_WORKSPACE: Record<string, string> = {};

// Optional per-identity restrictions. Empty means: all workspaces the server returned.
export const IDENTITY_ALLOWED_WORKSPACES: Record<string, string[]> = {};

// Linked workspace groups (switching between them shows a combined view)
export const LINKED_WORKSPACES_GROUPS: string[][] = [];
