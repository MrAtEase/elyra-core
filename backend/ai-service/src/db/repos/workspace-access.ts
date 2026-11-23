import { db } from "../client.js";
import { logger } from "../../lib/logger.js";

type WorkspaceMembershipRow = {
  workspace_id: string;
  role: string | null;
  created_at: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OS_ALIAS_WORKSPACES = new Set([
  "personal",
  "individual",
  "privat",
  "team",
  "organization",
  "organisation",
  "system",
  "fish-delish",
  "elyra-core",
  "platform",
  // ws- prefixed versions (frontend workspace IDs)
  "ws-personal",
  "ws-fish-delish",
  "ws-elyra-core",
]);
const AUTO_PROVISION_ALIASES = new Set([
  "elyra-core",
  "platform",
  "personal",
  "individual",
  "privat",
  "ws-personal",
  "ws-fish-delish",
  "ws-elyra-core",
]);
const ALIAS_TO_SLUG_CANDIDATES: Record<string, string[]> = {
  "ws-personal": ["ws-personal", "personal", "individual", "privat"],
  "ws-fish-delish": ["ws-fish-delish", "fish-delish"],
  "ws-elyra-core": ["ws-elyra-core", "elyra-core", "platform", "system"],
};
const WORKSPACE_WITH_INDEX_SUFFIX = /^(ws-[a-z0-9-]+):\d+$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeWorkspaceIdInput(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const withSuffix = trimmed.match(WORKSPACE_WITH_INDEX_SUFFIX);
  if (withSuffix?.[1]) return withSuffix[1].toLowerCase();
  return trimmed.toLowerCase();
}

async function hasDirectMembership(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await db()
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logger.warn(
      { err: error, userId, workspaceId },
      "Failed to validate workspace membership",
    );
    return false;
  }

  return Boolean(data?.["workspace_id"]);
}

async function resolveWorkspaceIdBySlug(
  alias: string,
): Promise<string | null> {
  const { data, error } = await db()
    .from("workspaces")
    .select("id")
    .ilike("slug", alias)
    .maybeSingle<{ id: string | null }>();

  if (error) {
    logger.warn({ err: error, alias }, "Failed to resolve workspace by slug");
    return null;
  }

  return data?.id ?? null;
}

async function resolveWorkspaceIdByAnySlug(alias: string): Promise<string | null> {
  const candidates = ALIAS_TO_SLUG_CANDIDATES[alias] ?? [alias];
  for (const candidate of candidates) {
    const id = await resolveWorkspaceIdBySlug(candidate);
    if (id) return id;
  }
  return null;
}

async function resolveWorkspaceIdByAlias(
  alias: string,
): Promise<string | null> {
  const direct = alias.trim();
  if (!direct) return null;

  const { data: byId, error: byIdError } = await db()
    .from("workspaces")
    .select("id")
    .eq("id", direct)
    .maybeSingle<{ id: string | null }>();

  if (byIdError) {
    logger.warn(
      { err: byIdError, alias: direct },
      "Failed to resolve workspace by id",
    );
  } else if (hasText(byId?.id)) {
    return byId.id;
  }

  return resolveWorkspaceIdByAnySlug(direct.toLowerCase());
}

async function autoProvisionWorkspaceAlias(
  alias: string,
  userId: string,
): Promise<string | null> {
  if (!AUTO_PROVISION_ALIASES.has(alias)) {
    return null;
  }

  const existing = await resolveWorkspaceIdByAnySlug(alias);
  if (existing) {
    const { error: existingMemberError } = await db()
      .from("workspace_members")
      .upsert(
        {
          workspace_id: existing,
          user_id: userId,
          role: "owner",
        },
        { onConflict: "workspace_id,user_id" },
      );
    if (!existingMemberError) return existing;
  }

  const workspaceId = crypto.randomUUID();
  const defaultKind = alias === "platform" || alias === "elyra-core" || alias === "ws-elyra-core" ? "platform" : "individual";
  const defaultName =
    alias === "elyra-core" || alias === "ws-elyra-core"
      ? "Elyra Core"
      : alias
          .replace(/^ws-/, "")
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
  const slug = alias.replace(/^ws-/, "");

  let workspaceError: Error | null = null;
  const workspacePayloads: Array<Record<string, unknown>> = [
    { id: workspaceId, slug, name: defaultName, kind: defaultKind },
    { id: workspaceId, slug, name: defaultName, type: defaultKind === "platform" ? "system_platform" : "personal" },
    { id: workspaceId, slug, name: defaultName },
  ];
  for (const payload of workspacePayloads) {
    const result = await db().from("workspaces").upsert(payload, { onConflict: "id" });
    if (!result.error) {
      workspaceError = null;
      break;
    }
    workspaceError = result.error as unknown as Error;
  }

  if (workspaceError) {
    logger.warn(
      { err: workspaceError, alias, slug, userId },
      "Failed to auto-provision workspace alias",
    );
    return null;
  }

  const { error: memberError } = await db()
    .from("workspace_members")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        role: "owner",
      },
      { onConflict: "workspace_id,user_id" },
    );

  if (memberError) {
    logger.warn(
      { err: memberError, workspaceId, userId },
      "Failed to auto-provision workspace membership",
    );
    return null;
  }

  return workspaceId;
}

async function resolveAliasWorkspace(
  userId: string,
): Promise<string | null> {
  const { data, error } = await db()
    .from("workspace_members")
    .select("workspace_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.warn({ err: error, userId }, "Failed to resolve alias workspace");
    return null;
  }

  const rows = ((data as WorkspaceMembershipRow[] | null) ?? []).filter(
    (row) => typeof row.workspace_id === "string" && row.workspace_id.length > 0,
  );
  if (rows.length === 0) return null;

  const managed = rows.find((row) => row.role === "owner" || row.role === "admin");
  return (managed ?? rows[0])?.workspace_id ?? null;
}

export async function resolveAuthorizedWorkspaceId(
  userId: string | null | undefined,
  requestedWorkspaceId: string | null | undefined,
): Promise<string | null> {
  const workspaceId = normalizeWorkspaceIdInput(requestedWorkspaceId);
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!workspaceId || !normalizedUserId) {
    return null;
  }

  if (isUuid(workspaceId)) {
    const hasAccess = await hasDirectMembership(normalizedUserId, workspaceId);
    return hasAccess ? workspaceId : null;
  }

  const alias = workspaceId;

  const hasDirectTextAccess = await hasDirectMembership(normalizedUserId, workspaceId);
  if (hasDirectTextAccess) {
    return workspaceId;
  }

  if (!OS_ALIAS_WORKSPACES.has(alias)) {
    return null;
  }

  const slugWorkspaceId = await resolveWorkspaceIdByAlias(alias);
  if (slugWorkspaceId) {
    const hasSlugAccess = await hasDirectMembership(normalizedUserId, slugWorkspaceId);
    if (hasSlugAccess) {
      return slugWorkspaceId;
    }
  }

  const fallbackWorkspaceId = await resolveAliasWorkspace(normalizedUserId);
  if (fallbackWorkspaceId) {
    return fallbackWorkspaceId;
  }

  return autoProvisionWorkspaceAlias(alias, normalizedUserId);
}
