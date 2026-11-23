/**
 * Team management for a workspace: members, roles and invitations.
 *
 * Rules
 * - Personal workspaces are private: they never get other members.
 * - Owners and admins manage the team. Only owners can grant or change the owner role.
 * - A workspace always keeps at least one owner.
 * - Invitations are bound to one email address. The link token is shown once and
 *   only its SHA-256 hash is stored. Accepting requires a session with that email.
 * - Only owners can delete a company workspace, after typing its name. Personal and
 *   system workspaces cannot be deleted.
 * - Every change is written to the audit log (domain "team").
 */

export type TeamRole = "owner" | "admin" | "member" | "viewer";

const ROLES: readonly TeamRole[] = ["owner", "admin", "member", "viewer"];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPEN_INVITES = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Minimal structural view of the D1 binding, so this module type-checks on its own.
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface Db {
  prepare(query: string): Stmt;
}

export interface TeamUser {
  id: string;
  email: string | null;
}

export interface TeamDeps {
  db: Db;
  user: TeamUser;
  isFounder: (email: string | null | undefined) => boolean;
}

interface WorkspaceRow {
  id: string;
  name: string;
  type: string;
}

type Result = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = {}): Result => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, message: string): Result => ({
  status,
  body: { ok: false, error, message },
});

let schemaReady = false;

/** Creates the invitation table on first use (mirrors migrations/0007_team_invites.sql). */
export async function ensureTeamSchema(db: Db): Promise<void> {
  if (schemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS team_invites (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        accepted_at INTEGER,
        accepted_by_user_id TEXT,
        revoked_at INTEGER
      )`
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_team_invites_workspace ON team_invites(workspace_id)`)
    .run();
  schemaReady = true;
}

function normalizeRole(raw: string | null | undefined): TeamRole {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "system_owner" || value === "workspace_owner") return "owner";
  if (value === "workspace_admin") return "admin";
  if (value === "workspace_member") return "member";
  if (value === "workspace_viewer") return "viewer";
  return (ROLES as readonly string[]).includes(value) ? (value as TeamRole) : "viewer";
}

function parseRole(raw: unknown): TeamRole | null {
  return typeof raw === "string" && (ROLES as readonly string[]).includes(raw) ? (raw as TeamRole) : null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function audit(
  db: Db,
  workspaceId: string,
  userId: string,
  action: string,
  resourceId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, 'team', ?5, NULL, ?6, ?7)`
      )
      .bind(crypto.randomUUID(), workspaceId, userId, action, resourceId, JSON.stringify(metadata), Date.now())
      .run();
  } catch {
    // Audit must never break the action itself.
  }
}

async function loadWorkspace(db: Db, workspaceId: string): Promise<WorkspaceRow | null> {
  return db
    .prepare(`SELECT id, name, type FROM workspaces WHERE id = ?1`)
    .bind(workspaceId)
    .first<WorkspaceRow>();
}

async function roleOf(db: Db, workspaceId: string, userId: string): Promise<TeamRole | null> {
  const row = await db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ?1 AND user_id = ?2`)
    .bind(workspaceId, userId)
    .first<{ role: string }>();
  return row ? normalizeRole(row.role) : null;
}

async function ownerCount(db: Db, workspaceId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM memberships
       WHERE workspace_id = ?1 AND role IN ('owner','system_owner','workspace_owner')`
    )
    .bind(workspaceId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

const canManage = (role: TeamRole | null) => role === "owner" || role === "admin";

function isTeamWorkspace(ws: WorkspaceRow): boolean {
  const type = ws.type.toLowerCase();
  return type !== "personal" && type !== "individual";
}

interface Context {
  ws: WorkspaceRow;
  myRole: TeamRole;
}

async function context(deps: TeamDeps, workspaceId: string): Promise<Context | Result> {
  await ensureTeamSchema(deps.db);
  const ws = await loadWorkspace(deps.db, workspaceId);
  const myRole = ws ? await roleOf(deps.db, workspaceId, deps.user.id) : null;
  // Same answer for "does not exist" and "not a member": no workspace enumeration.
  if (!ws || !myRole) return fail(403, "workspace_not_accessible", "Kein Zugriff auf diesen Workspace.");
  return { ws, myRole };
}

const isResult = (value: Context | Result): value is Result => "status" in value;

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

async function getTeam(deps: TeamDeps, workspaceId: string): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  const { db } = deps;

  const members = await db
    .prepare(
      `SELECT m.user_id, m.role, m.created_at, u.email, u.display_name, u.last_login_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?1
       ORDER BY m.created_at ASC`
    )
    .bind(workspaceId)
    .all<{
      user_id: string;
      role: string;
      created_at: number | null;
      email: string | null;
      display_name: string | null;
      last_login_at: number | null;
    }>();

  const manage = canManage(ctx.myRole);
  const invites = manage
    ? await db
        .prepare(
          `SELECT id, email, role, created_at, expires_at FROM team_invites
           WHERE workspace_id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?2
           ORDER BY created_at DESC`
        )
        .bind(workspaceId, Date.now())
        .all<{ id: string; email: string; role: string; created_at: number; expires_at: number }>()
    : { results: [] };

  const activity = manage
    ? await db
        .prepare(
          `SELECT a.id, a.action, a.metadata_json, a.created_at, u.email AS actor_email
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.workspace_id = ?1 AND a.domain = 'team'
           ORDER BY a.created_at DESC LIMIT 20`
        )
        .bind(workspaceId)
        .all<{ id: string; action: string; metadata_json: string | null; created_at: number; actor_email: string | null }>()
    : { results: [] };

  return ok({
    workspace: {
      id: ctx.ws.id,
      name: ctx.ws.name,
      type: ctx.ws.type,
      teamEnabled: isTeamWorkspace(ctx.ws),
    },
    me: { userId: deps.user.id, role: ctx.myRole, canManage: manage },
    members: (members.results ?? []).map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.display_name,
      role: normalizeRole(m.role),
      joinedAt: m.created_at,
      lastLoginAt: m.last_login_at,
      isMe: m.user_id === deps.user.id,
    })),
    invites: (invites.results ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: normalizeRole(i.role),
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
    activity: (activity.results ?? []).map((a) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = a.metadata_json ? (JSON.parse(a.metadata_json) as Record<string, unknown>) : {};
      } catch {
        meta = {};
      }
      return { id: a.id, action: a.action, actor: a.actor_email, meta, at: a.created_at };
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

async function createInvite(deps: TeamDeps, workspaceId: string, body: Record<string, unknown>): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  const { db } = deps;

  if (!canManage(ctx.myRole)) return fail(403, "forbidden", "Nur Owner und Admins können einladen.");
  if (!isTeamWorkspace(ctx.ws)) {
    return fail(400, "personal_workspace", "Persönliche Workspaces bleiben privat. Lege dafür einen Firmen-Workspace an.");
  }
  if (ctx.ws.type === "system_platform" && !deps.isFounder(deps.user.email)) {
    return fail(403, "forbidden", "Nur der Plattform-Owner kann ins System-Team einladen.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = parseRole(body.role) ?? "member";
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, "invalid_email", "Bitte eine gültige E-Mail-Adresse angeben.");
  if (role === "owner" && ctx.myRole !== "owner") return fail(403, "forbidden", "Nur Owner können weitere Owner einladen.");

  const existingMember = await db
    .prepare(
      `SELECT 1 AS x FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?1 AND lower(u.email) = ?2`
    )
    .bind(workspaceId, email)
    .first();
  if (existingMember) return fail(409, "already_member", "Diese Person ist bereits Mitglied.");

  const now = Date.now();
  const open = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM team_invites
       WHERE workspace_id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?2`
    )
    .bind(workspaceId, now)
    .first<{ n: number }>();
  if (Number(open?.n ?? 0) >= MAX_OPEN_INVITES) return fail(429, "too_many_invites", "Zu viele offene Einladungen.");

  // A new invite for the same address replaces the old one.
  await db
    .prepare(
      `UPDATE team_invites SET revoked_at = ?3
       WHERE workspace_id = ?1 AND email = ?2 AND accepted_at IS NULL AND revoked_at IS NULL`
    )
    .bind(workspaceId, email, now)
    .run();

  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  const expiresAt = now + INVITE_TTL_MS;
  await db
    .prepare(
      `INSERT INTO team_invites (id, workspace_id, email, role, token_hash, created_by_user_id, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(id, workspaceId, email, role, await sha256(token), deps.user.id, now, expiresAt)
    .run();
  await audit(db, workspaceId, deps.user.id, "invite_created", id, { email, role });

  return ok({ invite: { id, email, role, createdAt: now, expiresAt }, token });
}

async function revokeInvite(deps: TeamDeps, workspaceId: string, inviteId: string): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  if (!canManage(ctx.myRole)) return fail(403, "forbidden", "Nur Owner und Admins können Einladungen zurückziehen.");

  const invite = await deps.db
    .prepare(`SELECT email, role FROM team_invites WHERE id = ?1 AND workspace_id = ?2 AND accepted_at IS NULL AND revoked_at IS NULL`)
    .bind(inviteId, workspaceId)
    .first<{ email: string; role: string }>();
  if (!invite) return fail(404, "not_found", "Einladung nicht gefunden.");

  await deps.db
    .prepare(`UPDATE team_invites SET revoked_at = ?2 WHERE id = ?1`)
    .bind(inviteId, Date.now())
    .run();
  await audit(deps.db, workspaceId, deps.user.id, "invite_revoked", inviteId, { email: invite.email });
  return ok();
}

async function findOpenInvite(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 100) return null;
  return db
    .prepare(
      `SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, w.name AS workspace_name, w.type AS workspace_type,
              u.email AS inviter_email, u.display_name AS inviter_name
       FROM team_invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.created_by_user_id
       WHERE i.token_hash = ?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL`
    )
    .bind(await sha256(token))
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: string;
      expires_at: number;
      workspace_name: string;
      workspace_type: string;
      inviter_email: string | null;
      inviter_name: string | null;
    }>();
}

/** Shows what an invite is for. Requires a session; reveals nothing for a wrong account. */
export async function previewInvite(deps: TeamDeps, token: string): Promise<Result> {
  await ensureTeamSchema(deps.db);
  const invite = await findOpenInvite(deps.db, token);
  if (!invite || invite.expires_at <= Date.now()) {
    return fail(404, "invite_invalid", "Diese Einladung ist ungültig oder abgelaufen.");
  }
  const myEmail = (deps.user.email ?? "").toLowerCase();
  if (myEmail !== invite.email.toLowerCase()) {
    return fail(403, "wrong_account", "Diese Einladung gilt für eine andere E-Mail-Adresse. Melde dich mit der eingeladenen Adresse an.");
  }
  return ok({
    invite: {
      workspaceName: invite.workspace_name,
      role: normalizeRole(invite.role),
      invitedBy: invite.inviter_name || invite.inviter_email,
      expiresAt: invite.expires_at,
    },
  });
}

export async function acceptInvite(deps: TeamDeps, token: string): Promise<Result> {
  const preview = await previewInvite(deps, token);
  if (preview.status !== 200) return preview;
  const invite = await findOpenInvite(deps.db, token);
  if (!invite) return fail(404, "invite_invalid", "Diese Einladung ist ungültig oder abgelaufen.");

  const now = Date.now();
  const role = normalizeRole(invite.role);
  // Single use: only the first request flips accepted_at.
  const claimed = await deps.db
    .prepare(
      `UPDATE team_invites SET accepted_at = ?2, accepted_by_user_id = ?3
       WHERE id = ?1 AND accepted_at IS NULL AND revoked_at IS NULL`
    )
    .bind(invite.id, now, deps.user.id)
    .run();
  if (!claimed.meta?.changes) return fail(409, "invite_used", "Diese Einladung wurde bereits verwendet.");

  await deps.db
    .prepare(
      `INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at)
       VALUES (?1, ?2, ?3, ?4, NULL, ?5)
       ON CONFLICT(user_id, workspace_id) DO NOTHING`
    )
    .bind(crypto.randomUUID(), deps.user.id, invite.workspace_id, role, now)
    .run();
  await audit(deps.db, invite.workspace_id, deps.user.id, "invite_accepted", invite.id, {
    email: invite.email,
    role,
  });
  return ok({ workspaceId: invite.workspace_id, workspaceName: invite.workspace_name, role });
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

async function changeRole(
  deps: TeamDeps,
  workspaceId: string,
  targetUserId: string,
  body: Record<string, unknown>
): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  const { db } = deps;
  if (!canManage(ctx.myRole)) return fail(403, "forbidden", "Nur Owner und Admins können Rollen ändern.");

  const nextRole = parseRole(body.role);
  if (!nextRole) return fail(400, "invalid_role", "Unbekannte Rolle.");
  const currentRole = await roleOf(db, workspaceId, targetUserId);
  if (!currentRole) return fail(404, "not_found", "Mitglied nicht gefunden.");
  if (currentRole === nextRole) return ok({ role: nextRole });

  if (ctx.myRole !== "owner" && (currentRole === "owner" || nextRole === "owner")) {
    return fail(403, "forbidden", "Nur Owner können die Owner-Rolle vergeben oder ändern.");
  }
  if (currentRole === "owner" && (await ownerCount(db, workspaceId)) <= 1) {
    return fail(409, "last_owner", "Ein Workspace braucht mindestens einen Owner.");
  }

  await db
    .prepare(`UPDATE memberships SET role = ?3 WHERE workspace_id = ?1 AND user_id = ?2`)
    .bind(workspaceId, targetUserId, nextRole)
    .run();
  await audit(db, workspaceId, deps.user.id, "role_changed", targetUserId, { from: currentRole, to: nextRole });
  return ok({ role: nextRole });
}

async function removeMember(deps: TeamDeps, workspaceId: string, targetUserId: string): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  const { db } = deps;
  const self = targetUserId === deps.user.id;
  if (!self && !canManage(ctx.myRole)) return fail(403, "forbidden", "Nur Owner und Admins können Mitglieder entfernen.");

  const targetRole = await roleOf(db, workspaceId, targetUserId);
  if (!targetRole) return fail(404, "not_found", "Mitglied nicht gefunden.");
  if (!self && targetRole === "owner" && ctx.myRole !== "owner") {
    return fail(403, "forbidden", "Nur Owner können einen Owner entfernen.");
  }
  if (targetRole === "owner" && (await ownerCount(db, workspaceId)) <= 1) {
    return fail(409, "last_owner", "Ein Workspace braucht mindestens einen Owner.");
  }

  const target = await db.prepare(`SELECT email FROM users WHERE id = ?1`).bind(targetUserId).first<{ email: string | null }>();
  await db
    .prepare(`DELETE FROM memberships WHERE workspace_id = ?1 AND user_id = ?2`)
    .bind(workspaceId, targetUserId)
    .run();
  // Sessions that still point at this workspace fall back to the user's own workspace.
  await db
    .prepare(`UPDATE sessions SET active_workspace_id = NULL WHERE user_id = ?1 AND active_workspace_id = ?2`)
    .bind(targetUserId, workspaceId)
    .run();
  await audit(db, workspaceId, deps.user.id, self ? "member_left" : "member_removed", targetUserId, {
    email: target?.email ?? null,
    role: targetRole,
  });
  return ok();
}

/* ------------------------------------------------------------------ */
/* Delete a company workspace                                          */
/* ------------------------------------------------------------------ */

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function deleteWorkspace(deps: TeamDeps, workspaceId: string, body: Record<string, unknown>): Promise<Result> {
  const ctx = await context(deps, workspaceId);
  if (isResult(ctx)) return ctx;
  const { db } = deps;

  if (ctx.myRole !== "owner") return fail(403, "forbidden", "Nur Owner können einen Workspace löschen.");
  if (!isTeamWorkspace(ctx.ws) || ctx.ws.type === "system_platform") {
    return fail(400, "not_deletable", "Persönliche und System-Workspaces können nicht gelöscht werden.");
  }
  const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
  if (confirmName !== ctx.ws.name.trim()) {
    return fail(400, "confirm_mismatch", "Bitte gib zur Bestätigung den genauen Namen des Workspace ein.");
  }

  // Remove everything that belongs to this workspace. The audit log is kept on purpose.
  const tables = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
    .all<{ name: string }>();
  const keep = new Set(["workspaces", "audit_log", "sessions", "users"]);
  const pending: string[] = [];
  for (const { name } of tables.results ?? []) {
    if (keep.has(name) || !IDENT_RE.test(name)) continue;
    const columns = await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
    const names = new Set((columns.results ?? []).map((c) => c.name));
    for (const column of ["workspace_id", "source_workspace_id", "target_workspace_id"]) {
      if (!names.has(column)) continue;
      const found = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${column} = ?1`)
        .bind(workspaceId)
        .first<{ n: number }>();
      if (Number(found?.n ?? 0) > 0) pending.push(`DELETE FROM ${name} WHERE ${column} = ?1`);
    }
  }
  // Child tables may reference each other; retry until every delete went through.
  const errors = new Map<string, string>();
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    for (const sql of [...pending]) {
      try {
        await db.prepare(sql).bind(workspaceId).run();
        pending.splice(pending.indexOf(sql), 1);
      } catch (error) {
        errors.set(sql, error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (pending.length) {
    console.error("[team] workspace delete incomplete", pending.map((sql) => `${sql} → ${errors.get(sql)}`));
    return {
      status: 500,
      body: {
        ok: false,
        error: "delete_incomplete",
        message: "Der Workspace konnte nicht vollständig gelöscht werden.",
        detail: pending.map((sql) => errors.get(sql) ?? sql).slice(0, 5),
      },
    };
  }
  await db.prepare(`UPDATE sessions SET active_workspace_id = NULL WHERE active_workspace_id = ?1`).bind(workspaceId).run();
  await db.prepare(`UPDATE users SET default_workspace_id = NULL WHERE default_workspace_id = ?1`).bind(workspaceId).run();
  await db.prepare(`DELETE FROM workspaces WHERE id = ?1`).bind(workspaceId).run();
  await audit(db, workspaceId, deps.user.id, "workspace_deleted", workspaceId, { name: ctx.ws.name });
  return ok();
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

/** Handles /assistant/workspaces/:id/team… Returns null when the path is not a team route. */
export async function routeTeam(
  deps: TeamDeps,
  workspaceId: string,
  sub: string,
  method: string,
  readBody: () => Promise<Record<string, unknown>>
): Promise<Result | null> {
  if (sub === "/team" && method === "GET") return getTeam(deps, workspaceId);
  if (sub === "/team/workspace" && method === "DELETE") return deleteWorkspace(deps, workspaceId, await readBody());
  if (sub === "/team/invites" && method === "POST") return createInvite(deps, workspaceId, await readBody());

  const inviteMatch = sub.match(/^\/team\/invites\/([a-f0-9-]{36})$/);
  if (inviteMatch && method === "DELETE") return revokeInvite(deps, workspaceId, inviteMatch[1]!);

  const memberMatch = sub.match(/^\/team\/members\/([A-Za-z0-9_-]{1,64})$/);
  if (memberMatch && method === "PATCH") return changeRole(deps, workspaceId, memberMatch[1]!, await readBody());
  if (memberMatch && method === "DELETE") return removeMember(deps, workspaceId, memberMatch[1]!);

  return null;
}
