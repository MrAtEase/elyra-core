import type { WhoamiWorkspace } from "@/types/whoami";
import {
  IDENTITY_ALLOWED_WORKSPACES,
  IDENTITY_DEFAULT_WORKSPACE,
  WORKSPACE_LABELS,
  matchesWorkspaceKey,
  normalizePolicyKey,
} from "@/lib/workspace/workspaceAccessMap";

export type WorkspaceIdentity = {
  email: string | null;
  domain: string | null;
  isFishIdentity: boolean;
  isPaulIdentity: boolean;
  isMagicsurferIdentity: boolean;
};

export type WorkspacePolicyInput = {
  identityEmail: string | null | undefined;
  workspaces: WhoamiWorkspace[];
  activeWorkspaceId: string | null | undefined;
  storedWorkspaceId?: string | null | undefined;
};

export type WorkspacePolicyResult = {
  identity: WorkspaceIdentity;
  visibleWorkspaces: WhoamiWorkspace[];
  filteredWorkspaces: WhoamiWorkspace[];
  defaultWorkspaceId: string | null;
  activeWorkspace: WhoamiWorkspace | null;
  displayNameById: Record<string, string>;
  shouldSwitchActiveWorkspace: boolean;
  storedWorkspaceId: string | null;
  preferredWorkspaceId: string | null;
  nextWorkspaceId: string | null;
  allowedWorkspaceKeys: string[];
};

const resolveIdentity = (email?: string | null): WorkspaceIdentity => {
  const normalizedEmail = normalizePolicyKey(email ?? null);
  const domain = normalizedEmail.includes("@")
    ? normalizePolicyKey(normalizedEmail.split("@")[1] ?? "")
    : "";
  const normalizedDomain = domain || null;
  return {
    email: normalizedEmail || null,
    domain: normalizedDomain,
    isFishIdentity:
      Boolean(normalizedEmail && normalizedEmail.endsWith("@fish-delish.pt")) ||
      normalizedDomain === "fish-delish.pt",
    isPaulIdentity:
      normalizedEmail === "paul.odak@icloud.com" ||
      normalizedEmail === "paul.odak@elyra-core.app",
    isMagicsurferIdentity: normalizedEmail === "magicsurfer2020@gmail.com",
  };
};

const resolveWorkspaceByKey = (workspaces: WhoamiWorkspace[], key?: string | null) =>
  workspaces.find((workspace) => matchesWorkspaceKey(workspace, key)) ?? null;

const buildDisplayNameMap = (workspaces: WhoamiWorkspace[]) => {
  const map: Record<string, string> = {};
  workspaces.forEach((workspace) => {
    const label =
      WORKSPACE_LABELS[workspace.id] ??
      (workspace.slug ? WORKSPACE_LABELS[workspace.slug] : undefined) ??
      workspace.name ??
      workspace.slug ??
      "Workspace";
    map[workspace.id] = label;
  });
  return map;
};

const resolvePolicyKey = (value?: string | null) => {
  const normalized = normalizePolicyKey(value ?? null);
  return normalized || null;
};

const resolvePolicyConfig = (identity: WorkspaceIdentity) => {
  const emailKey = resolvePolicyKey(identity.email);
  const domainKey = resolvePolicyKey(identity.domain);
  const allowedByEmail = emailKey ? IDENTITY_ALLOWED_WORKSPACES[emailKey] : undefined;
  const allowedByDomain = domainKey ? IDENTITY_ALLOWED_WORKSPACES[domainKey] : undefined;
  const defaultByEmail = emailKey ? IDENTITY_DEFAULT_WORKSPACE[emailKey] : undefined;
  const defaultByDomain = domainKey ? IDENTITY_DEFAULT_WORKSPACE[domainKey] : undefined;
  const allowedWorkspaceKeys = allowedByEmail ?? allowedByDomain ?? null;
  const defaultWorkspaceKey = defaultByEmail ?? defaultByDomain ?? null;
  return {
    allowedWorkspaceKeys,
    defaultWorkspaceKey,
    hasPolicy: Boolean(allowedWorkspaceKeys || defaultWorkspaceKey),
  };
};

export function applyWorkspacePolicy(input: WorkspacePolicyInput): WorkspacePolicyResult {
  const rawWorkspaces = Array.isArray(input.workspaces) ? input.workspaces : [];
  const identity = resolveIdentity(input.identityEmail);
  const activeWorkspaceId = resolvePolicyKey(input.activeWorkspaceId ?? null);
  const storedWorkspaceId = resolvePolicyKey(input.storedWorkspaceId ?? null);

  const { allowedWorkspaceKeys, defaultWorkspaceKey, hasPolicy } = resolvePolicyConfig(identity);
  const normalizedAllowedKeys = (allowedWorkspaceKeys ?? [])
    .map((key) => resolvePolicyKey(key))
    .filter((key): key is string => Boolean(key));

  let visibleWorkspaces: WhoamiWorkspace[] = rawWorkspaces;
  if (normalizedAllowedKeys.length > 0) {
    visibleWorkspaces = rawWorkspaces.filter((workspace) =>
      normalizedAllowedKeys.some((key) => matchesWorkspaceKey(workspace, key))
    );
  }

  const defaultWorkspace = defaultWorkspaceKey
    ? resolveWorkspaceByKey(rawWorkspaces, defaultWorkspaceKey)
    : null;
  const defaultWorkspaceId = defaultWorkspace?.id ?? null;

  const activeWorkspace = resolveWorkspaceByKey(rawWorkspaces, activeWorkspaceId);

  if (hasPolicy && visibleWorkspaces.length === 0 && activeWorkspace) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[workspace-policy] mapping did not resolve any workspaces", {
        identity,
        allowedWorkspaceKeys,
        defaultWorkspaceKey,
        activeWorkspace: {
          id: activeWorkspace.id,
          slug: activeWorkspace.slug,
          name: activeWorkspace.name,
          type: activeWorkspace.type,
        },
        workspaceCount: rawWorkspaces.length,
      });
    }
    visibleWorkspaces = [activeWorkspace];
  }

  const visibleIds = new Set(visibleWorkspaces.map((workspace) => workspace.id));
  const filteredWorkspaces = rawWorkspaces.filter((workspace) => !visibleIds.has(workspace.id));

  const storedWorkspace = resolveWorkspaceByKey(rawWorkspaces, storedWorkspaceId);
  const activeWorkspaceResolvedId = activeWorkspace?.id ?? null;
  const storedWorkspaceResolvedId = storedWorkspace?.id ?? null;

  const isStoredVisible = storedWorkspaceResolvedId
    ? visibleIds.has(storedWorkspaceResolvedId)
    : false;
  const isActiveVisible = activeWorkspaceResolvedId
    ? visibleIds.has(activeWorkspaceResolvedId)
    : false;
  const isDefaultVisible = defaultWorkspaceId ? visibleIds.has(defaultWorkspaceId) : false;

  const preferredWorkspaceId =
    (isStoredVisible ? storedWorkspaceResolvedId : null) ||
    (isDefaultVisible ? defaultWorkspaceId : null) ||
    (isActiveVisible ? activeWorkspaceResolvedId : null) ||
    visibleWorkspaces[0]?.id ||
    null;

  let nextWorkspaceId: string | null = null;
  if (!isActiveVisible) {
    nextWorkspaceId = preferredWorkspaceId;
  } else if (isStoredVisible && storedWorkspaceResolvedId !== activeWorkspaceResolvedId) {
    nextWorkspaceId = storedWorkspaceResolvedId;
  } else if (!isStoredVisible && isDefaultVisible && defaultWorkspaceId !== activeWorkspaceResolvedId) {
    nextWorkspaceId = defaultWorkspaceId;
  }

  const effectiveActiveWorkspace =
    (isActiveVisible ? activeWorkspace : null) ||
    (preferredWorkspaceId
      ? visibleWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId)
      : null) ||
    null;

  const shouldSwitchActiveWorkspace =
    Boolean(nextWorkspaceId) && activeWorkspaceResolvedId !== nextWorkspaceId;

  return {
    identity,
    visibleWorkspaces,
    filteredWorkspaces,
    defaultWorkspaceId,
    activeWorkspace: effectiveActiveWorkspace,
    displayNameById: buildDisplayNameMap(visibleWorkspaces),
    shouldSwitchActiveWorkspace,
    storedWorkspaceId: storedWorkspaceResolvedId,
    preferredWorkspaceId,
    nextWorkspaceId,
    allowedWorkspaceKeys: normalizedAllowedKeys,
  };
}
