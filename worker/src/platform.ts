/**
 * Platform view for the operator of an Elyra instance ("Kunden").
 *
 * Rules
 * - Only the platform owner (exact email in SYSTEM_FOUNDER_ALLOWLIST) may call these routes.
 * - Metadata only: names, owners, member counts, activity and usage numbers.
 *   No mails, events, documents, chats or app data are ever read here.
 * - Company workspaces can be suspended. A suspended workspace disappears from its members'
 *   workspace list and every membership check fails until it is reactivated.
 * - Every suspension and reactivation is written to the audit log (domain "platform").
 */

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface Db {
  prepare(query: string): Stmt;
}

export interface PlatformDeps {
  db: Db;
  user: { id: string; email: string | null };
  isFounder: (email: string | null | undefined) => boolean;
}

type Result = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = {}): Result => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, message: string): Result => ({
  status,
  body: { ok: false, error, message },
});

const DAY_MS = 24 * 60 * 60 * 1000;

let schemaReady = false;

/** Creates the suspension table on first use (mirrors migrations/0008_platform_suspensions.sql). */
export async function ensurePlatformSchema(db: Db): Promise<void> {
  if (schemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS workspace_suspensions (
        workspace_id TEXT PRIMARY KEY,
        reason TEXT,
        suspended_by_user_id TEXT NOT NULL,
        suspended_at INTEGER NOT NULL
      )`
    )
    .run();
  schemaReady = true;
}

async function audit(db: Db, workspaceId: string, userId: string, action: string, metadata: Record<string, unknown>) {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, 'platform', ?2, NULL, ?5, ?6)`
      )
      .bind(crypto.randomUUID(), workspaceId, userId, action, JSON.stringify(metadata), Date.now())
      .run();
  } catch {
    // Audit must never break the action itself.
  }
}

function guard(deps: PlatformDeps): Result | null {
  if (!deps.isFounder(deps.user.email)) return fail(403, "forbidden", "Nur für den Plattform-Owner.");
  return null;
}

async function listCustomers(deps: PlatformDeps): Promise<Result> {
  const denied = guard(deps);
  if (denied) return denied;
  await ensurePlatformSchema(deps.db);
  const since = Date.now() - 30 * DAY_MS;
  const sinceDay = new Date(since).toISOString().slice(0, 10);

  const rows = await deps.db
    .prepare(
      `SELECT w.id, w.name, w.type, w.created_at,
              (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) AS members,
              (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
                 WHERE m.workspace_id = w.id AND m.role IN ('owner','workspace_owner','system_owner')
                 ORDER BY m.created_at ASC LIMIT 1) AS owner_email,
              (SELECT MAX(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id
                 WHERE m.workspace_id = w.id) AS last_login_at,
              (SELECT COALESCE(SUM(d.requests_count), 0) FROM usage_daily d
                 WHERE d.workspace_id = w.id AND d.day_utc >= ?1) AS requests_30d,
              (SELECT COALESCE(SUM(d.cost_cents), 0) FROM usage_daily d
                 WHERE d.workspace_id = w.id AND d.day_utc >= ?1) AS cost_cents_30d,
              s.suspended_at, s.reason AS suspended_reason
       FROM workspaces w
       LEFT JOIN workspace_suspensions s ON s.workspace_id = w.id
       WHERE w.type <> 'system_platform'
       ORDER BY w.created_at DESC`
    )
    .bind(sinceDay)
    .all<{
      id: string;
      name: string;
      type: string;
      created_at: number | null;
      members: number;
      owner_email: string | null;
      last_login_at: number | null;
      requests_30d: number;
      cost_cents_30d: number;
      suspended_at: number | null;
      suspended_reason: string | null;
    }>();

  const customers = (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.type === "personal" || r.type === "individual" ? "individual" : "company",
    createdAt: r.created_at,
    members: Number(r.members ?? 0),
    ownerEmail: r.owner_email,
    lastActiveAt: r.last_login_at,
    requests30d: Number(r.requests_30d ?? 0),
    costCents30d: Number(r.cost_cents_30d ?? 0),
    suspendedAt: r.suspended_at,
    suspendedReason: r.suspended_reason,
  }));

  const companies = customers.filter((c) => c.kind === "company");
  const activeSince = Date.now() - 7 * DAY_MS;
  return ok({
    summary: {
      companies: companies.length,
      individuals: customers.length - companies.length,
      users: Number(
        (await deps.db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>())?.n ?? 0
      ),
      active7d: customers.filter((c) => (c.lastActiveAt ?? 0) >= activeSince).length,
      suspended: customers.filter((c) => c.suspendedAt).length,
      requests30d: customers.reduce((sum, c) => sum + c.requests30d, 0),
    },
    customers,
  });
}

async function setSuspended(deps: PlatformDeps, workspaceId: string, body: Record<string, unknown>): Promise<Result> {
  const denied = guard(deps);
  if (denied) return denied;
  await ensurePlatformSchema(deps.db);
  const ws = await deps.db
    .prepare(`SELECT id, name, type FROM workspaces WHERE id = ?1`)
    .bind(workspaceId)
    .first<{ id: string; name: string; type: string }>();
  if (!ws) return fail(404, "not_found", "Workspace nicht gefunden.");
  if (ws.type !== "company" && ws.type !== "business") {
    return fail(400, "not_suspendable", "Nur Firmen-Workspaces können gesperrt werden.");
  }

  const suspend = body.suspended === true;
  if (suspend) {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    await deps.db
      .prepare(
        `INSERT INTO workspace_suspensions (workspace_id, reason, suspended_by_user_id, suspended_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(workspace_id) DO UPDATE SET reason = excluded.reason, suspended_at = excluded.suspended_at`
      )
      .bind(workspaceId, reason || null, deps.user.id, Date.now())
      .run();
    // Members currently inside the workspace fall back to their own workspace.
    await deps.db
      .prepare(`UPDATE sessions SET active_workspace_id = NULL WHERE active_workspace_id = ?1`)
      .bind(workspaceId)
      .run();
    await audit(deps.db, workspaceId, deps.user.id, "workspace_suspended", { name: ws.name, reason: reason || null });
  } else {
    await deps.db.prepare(`DELETE FROM workspace_suspensions WHERE workspace_id = ?1`).bind(workspaceId).run();
    await audit(deps.db, workspaceId, deps.user.id, "workspace_reactivated", { name: ws.name });
  }
  return ok({ suspended: suspend });
}

/** Handles /assistant/platform/… Returns null when the path is not a platform route. */
export async function routePlatform(
  deps: PlatformDeps,
  path: string,
  method: string,
  readBody: () => Promise<Record<string, unknown>>
): Promise<Result | null> {
  if (path === "/assistant/platform/customers" && method === "GET") return listCustomers(deps);
  const match = path.match(/^\/assistant\/platform\/customers\/([a-f0-9-]{36})\/suspension$/);
  if (match && method === "PUT") return setSuspended(deps, match[1]!, await readBody());
  return null;
}
