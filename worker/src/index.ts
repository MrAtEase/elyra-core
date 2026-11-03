// ---------------------------------------------------------------------------
// Elyra API Worker — Auth (exchange, whoami, logout) + onboarding + health
// + Confirmation / Audit (B3-001)
// ---------------------------------------------------------------------------

import {
  buildActionProposal,
  validateActionProposal,
  classifyIntent,
  type ElliContext,
} from "./elli/system";
import {
  createConfirmationEvent,
  getConfirmationEvent,
  confirmEvent,
  cancelEvent,
  ConfirmationError,
} from "./elli/confirmation-store";
import { createClient } from "@supabase/supabase-js";
import { handleV1Request } from "./cloudOs";

// Forwarding helper for AI Service routes (intents, artifacts, google-status)
async function forwardToAIService(request: Request, env: Env): Promise<Response> {
  const aiServiceUrl = env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8080";
  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, aiServiceUrl);

  const headers = new Headers(request.headers);
  // Do NOT manually set Host header as it triggers 403 Forbidden on many platforms (e.g. Vercel/WAF)
  // unless explicitly required. Cloudflare fetch handles Host automatically for the target.
  headers.delete("Host");

  return fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "follow",
  });
}
import { googleOAuthStart, googleOAuthCallback, getAccessTokenFromKV } from "./google";
import { handleWindowLayoutRoute } from "./windowLayouts";
import { base64url } from "./rfc822";

interface Env {
  ASSISTANT_DB: D1Database;
  ASSISTANT_KV: KVNamespace;
  SUPABASE_URL: string;          // e.g. https://pvpjnljocdqpmsropybk.supabase.co
  SUPABASE_ANON_KEY: string;     // public anon key (used as apikey header)
  SESSION_COOKIE_DOMAIN: string; // ".elyra-core.app" in prod, "" locally
  ENVIRONMENT: string;
  NEXT_ALLOWED_ORIGINS?: string; // comma-separated allowlist, e.g. "https://app.elyra-core.app,http://localhost:3000"
  SYSTEM_FOUNDER_ALLOWLIST?: string; // comma-separated emails/domains with system platform defaults
  USER_ALLOWLIST?: string; // if set, only these emails/domains may exchange tokens (invite-only gate)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_SCOPES?: string;
  GOOGLE_REDIRECT_URI?: string;
  PUBLIC_APP_ORIGIN?: string;
  DEFAULT_USER_KEY?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse comma-separated allowed origins from env, trimming whitespace. */
function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseLowerAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** Fallback used when NEXT_ALLOWED_ORIGINS is unset. */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://app.elyra-core.app",
  "http://localhost:3000",
];

const DEFAULT_FOUNDER_EMAIL_ALLOWLIST = [
  "paul@elyra-core.app",
  "paul.odak@elyra-core.app",
];

const DEFAULT_FOUNDER_DOMAIN_ALLOWLIST = ["elyra-core.app"];

type WorkspaceKind = "personal" | "company" | "system_platform";

function normalizeEmailValue(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

function isFounderIdentity(email: string | null | undefined, env: Env): boolean {
  const normalizedEmail = normalizeEmailValue(email);
  if (!normalizedEmail) return false;

  const dynamicAllowlist = parseLowerAllowlist(env.SYSTEM_FOUNDER_ALLOWLIST);
  const allowedEmails = new Set(
    [...DEFAULT_FOUNDER_EMAIL_ALLOWLIST, ...dynamicAllowlist.filter((entry) => entry.includes("@"))]
  );
  if (allowedEmails.has(normalizedEmail)) {
    return true;
  }

  const domain = normalizedEmail.split("@")[1] ?? "";
  const allowedDomains = new Set([
    ...DEFAULT_FOUNDER_DOMAIN_ALLOWLIST,
    ...dynamicAllowlist.filter((entry) => !entry.includes("@")),
  ]);
  return Boolean(domain && allowedDomains.has(domain));
}

/** Check if an email is on the USER_ALLOWLIST (invite-only gate). */
function isEmailAllowed(email: string | null | undefined, allowlist: string[]): boolean {
  const normalized = normalizeEmailValue(email);
  if (!normalized) return false;
  const emailSet = new Set(allowlist.filter((e) => e.includes("@")));
  if (emailSet.has(normalized)) return true;
  const domain = normalized.split("@")[1] ?? "";
  const domainSet = new Set(allowlist.filter((e) => !e.includes("@")));
  return Boolean(domain && domainSet.has(domain));
}

function normalizeWorkspaceType(rawType: string | undefined, founder: boolean): WorkspaceKind {
  const normalized = (rawType ?? "").trim().toLowerCase();
  if (normalized === "system_platform") return "system_platform";
  if (normalized === "business") return "company";
  if (normalized === "company") return "company";
  if (normalized === "personal") {
    return founder ? "system_platform" : "personal";
  }
  return founder ? "system_platform" : "personal";
}

function normalizeMembershipRole(rawRole: string | undefined, workspaceType: WorkspaceKind, founder: boolean): string {
  if (founder && workspaceType === "system_platform") {
    return "system_owner";
  }
  const normalized = (rawRole ?? "").trim().toLowerCase();
  if (normalized === "system_owner") return "system_owner";
  if (normalized === "workspace_owner") return "owner";
  if (normalized === "workspace_admin") return "admin";
  if (normalized === "workspace_member") return "member";
  if (normalized === "workspace_viewer") return "viewer";
  if (normalized === "owner" || normalized === "admin" || normalized === "member" || normalized === "viewer") {
    return normalized;
  }
  return "owner";
}

function getAllowedOrigins(env: Env): string[] {
  const parsed = parseAllowedOrigins(env.NEXT_ALLOWED_ORIGINS);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  return getAllowedOrigins(env).includes(origin);
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

/**
 * Attach CORS headers to any response.
 * If the request Origin is not in the allowlist, the response is returned
 * unchanged (no Access-Control-Allow-Origin → browser blocks it, which is
 * correct for unknown origins). For allowed origins we mirror the origin
 * (required when credentials: true — wildcard "*" is forbidden).
 */
function withCors(req: Request, res: Response, env: Env): Response {
  const origin = req.headers.get("Origin") || "";
  const out = new Response(res.body, res);
  out.headers.set("Vary", "Origin");

  if (!origin || !isAllowedOrigin(origin, env)) {
    return out;
  }

  out.headers.set("Access-Control-Allow-Origin", origin);
  out.headers.set("Access-Control-Allow-Credentials", "true");
  out.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  out.headers.set("Access-Control-Allow-Headers", "content-type,authorization");
  out.headers.set("Access-Control-Max-Age", "86400");
  return out;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function generateSessionId(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function buildSetCookie(name: string, value: string, env: Env, clear = false): string {
  const isProd = env.ENVIRONMENT === "production";
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly"];
  if (isProd) {
    parts.push("Secure", "SameSite=None");
  } else {
    parts.push("SameSite=Lax");
  }
  if (env.SESSION_COOKIE_DOMAIN) {
    parts.push(`Domain=${env.SESSION_COOKIE_DOMAIN}`);
  }
  if (clear) {
    parts.push("Max-Age=0");
  } else {
    parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Supabase token verification (calls GoTrue /auth/v1/user)
// ---------------------------------------------------------------------------

interface SupabaseUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  user_metadata: { full_name?: string; name?: string; avatar_url?: string };
}

async function verifySupabaseToken(
  token: string,
  env: Env
): Promise<SupabaseUser | null> {
  const apiKey =
    env.SUPABASE_ANON_KEY ||
    ((env as unknown as { SUPABASE_SERVICE_ROLE_KEY?: string }).SUPABASE_SERVICE_ROLE_KEY ?? "");
  if (!env.SUPABASE_URL || !apiKey) {
    console.error("[auth] Missing SUPABASE_URL or Supabase API key in worker env");
    return null;
  }

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn("[auth] Supabase token verification failed", {
      status: res.status,
      detail: detail.slice(0, 240),
    });
    return null;
  }
  return res.json() as Promise<SupabaseUser>;
}

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

async function upsertUser(db: D1Database, su: SupabaseUser): Promise<void> {
  const now = Date.now();
  const displayName =
    su.user_metadata?.full_name || su.user_metadata?.name || su.email;

  await db
    .prepare(
      `INSERT INTO users (id, email, email_verified, display_name, status, created_at, updated_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET
         email = ?2,
         email_verified = ?3,
         display_name = COALESCE(users.display_name, ?4),
         updated_at = ?5,
         last_login_at = ?5`
    )
    .bind(su.id, su.email, su.email_confirmed_at ? 1 : 0, displayName, now)
    .run();
}

async function ensurePersonalWorkspace(
  db: D1Database,
  userId: string,
  email: string
): Promise<string> {
  // 1. Fast path: user already has a personal workspace via membership
  const existing = await db
    .prepare(
      `SELECT w.id FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ?1 AND w.type = 'personal'
       LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string }>();

  if (existing) return existing.id;

  const now = Date.now();
  const createdByUser = await db
    .prepare(`SELECT id FROM workspaces WHERE created_by_user_id = ?1 AND type = 'personal' LIMIT 1`)
    .bind(userId)
    .first<{ id: string }>();

  let workspaceId = createdByUser?.id ?? "";

  if (!workspaceId) {
    const emailLocal = normalizeEmailValue(email).split("@")[0]?.replace(/[^a-z0-9]+/g, "-") || "";
    const slugBase = (emailLocal || `personal-${userId.slice(0, 8)}`).replace(/(^-|-$)/g, "");

    let created = false;
    for (let i = 0; i < 5 && !created; i++) {
      const slug = i === 0 ? slugBase : `${slugBase}-${i + 1}`;
      workspaceId = crypto.randomUUID();
      try {
        await db
          .prepare(
            `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
             VALUES (?1, ?2, 'personal', 'Personal', ?3, ?4)`
          )
          .bind(workspaceId, slug, now, userId)
          .run();
        created = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("UNIQUE constraint failed: workspaces.slug")) throw e;
      }
    }

    if (!created) {
      const slug = `personal-${userId.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`;
      workspaceId = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
           VALUES (?1, ?2, 'personal', 'Personal', ?3, ?4)`
        )
        .bind(workspaceId, slug, now, userId)
        .run();
    }
  }

  // 4. Ensure membership exists (idempotent)
  const existingMembership = await db
    .prepare(
      `SELECT id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1`
    )
    .bind(userId, workspaceId)
    .first<{ id: string }>();

  if (!existingMembership) {
    await db
      .prepare(
        `INSERT INTO memberships (id, user_id, workspace_id, role, created_at)
         VALUES (?1, ?2, ?3, 'owner', ?4)`
      )
      .bind(crypto.randomUUID(), userId, workspaceId, now)
      .run();
  }

  // 5. Set default workspace if not already set
  await db
    .prepare(
      `UPDATE users SET default_workspace_id = ?1 WHERE id = ?2 AND default_workspace_id IS NULL`
    )
    .bind(workspaceId, userId)
    .run();

  return workspaceId;
}

async function resolvePreferredWorkspaceForUser(
  db: D1Database,
  user: UserRow,
  env: Env
): Promise<string | null> {
  if (isFounderIdentity(user.email, env)) {
    return ensureSystemPlatformWorkspace(db, user.id, user.email);
  }

  if (user.default_workspace_id) {
    const defaultMembership = await db
      .prepare(`SELECT workspace_id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1`)
      .bind(user.id, user.default_workspace_id)
      .first<{ workspace_id: string }>();
    if (defaultMembership?.workspace_id) {
      return defaultMembership.workspace_id;
    }
  }

  const memberships = await getUserWorkspaces(db, user.id);
  if (memberships.length > 0) {
    return memberships[0]?.id ?? null;
  }

  // No memberships found — create a personal workspace as fallback
  console.log("[resolvePreferredWorkspaceForUser] No memberships, creating personal workspace for", user.id);
  return ensurePersonalWorkspace(db, user.id, user.email || "");
}

async function ensureSystemPlatformWorkspace(
  db: D1Database,
  userId: string,
  email: string
): Promise<string> {
  const normalizedEmail = normalizeEmailValue(email);
  // Always use the shared ws-elyra-core platform workspace regardless of email domain
  const baseSlug = "ws-elyra-core";
  const defaultName = "Elyra Core";
  const now = Date.now();

  const existingByMembership = await db
    .prepare(
      `SELECT w.id
       FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ?1
         AND (w.type = 'system_platform' OR (w.type = 'company' AND m.role = 'system_owner'))
       LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string }>();

  let workspaceId: string | null = existingByMembership?.id ?? null;

  if (!workspaceId) {
    const existingBySlug = await db
      .prepare(`SELECT id FROM workspaces WHERE slug = ?1 LIMIT 1`)
      .bind(baseSlug)
      .first<{ id: string }>();
    workspaceId = existingBySlug?.id ?? null;
  }

  if (!workspaceId) {
    workspaceId = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
           VALUES (?1, ?2, 'system_platform', ?3, ?4, ?5)`
        )
        .bind(workspaceId, baseSlug, defaultName, now, userId)
        .run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("UNIQUE constraint failed: workspaces.slug")) throw error;
      const raced = await db
        .prepare(`SELECT id FROM workspaces WHERE slug = ?1 LIMIT 1`)
        .bind(baseSlug)
        .first<{ id: string }>();
      if (!raced) throw error;
      workspaceId = raced.id;
    }
  }

  const existingMembership = await db
    .prepare(
      `SELECT id, role FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1`
    )
    .bind(userId, workspaceId)
    .first<{ id: string; role: string }>();

  if (!existingMembership) {
    await db
      .prepare(
        `INSERT INTO memberships (id, user_id, workspace_id, role, created_at)
         VALUES (?1, ?2, ?3, 'system_owner', ?4)`
      )
      .bind(crypto.randomUUID(), userId, workspaceId, now)
      .run();
  } else if (existingMembership.role !== "system_owner") {
    await db
      .prepare(`UPDATE memberships SET role = 'system_owner' WHERE id = ?1`)
      .bind(existingMembership.id)
      .run();
  }

  await db
    .prepare(`UPDATE workspaces SET type = 'system_platform' WHERE id = ?1 AND type != 'system_platform'`)
    .bind(workspaceId)
    .run();

  await db
    .prepare(
      `UPDATE users SET default_workspace_id = ?1 WHERE id = ?2 AND default_workspace_id IS NULL`
    )
    .bind(workspaceId, userId)
    .run();

  return workspaceId;
}

async function createSession(
  db: D1Database,
  userId: string,
  workspaceId: string | null
): Promise<string> {
  const sessionId = generateSessionId();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, active_workspace_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(sessionId, userId, now, now + SESSION_TTL_MS, workspaceId)
    .run();
  return sessionId;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  active_workspace_id: string | null;
  revoked_at: number | null;
}

async function lookupSession(
  db: D1Database,
  sessionId: string
): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, expires_at, active_workspace_id, revoked_at
       FROM sessions WHERE id = ?1`
    )
    .bind(sessionId)
    .first<SessionRow>();
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  default_workspace_id: string | null;
}

async function getUser(db: D1Database, userId: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT id, email, display_name, default_workspace_id FROM users WHERE id = ?1`)
    .bind(userId)
    .first<UserRow>();
}

interface WorkspaceRow {
  id: string;
  slug: string;
  type: string;
  name: string;
  brand_json: string | null;
}

async function getUserWorkspaces(
  db: D1Database,
  userId: string
): Promise<WorkspaceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.slug, w.type, w.name, w.brand_json
       FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ?1`
    )
    .bind(userId)
    .all<WorkspaceRow>();
  return results ?? [];
}

interface MembershipRow {
  role: string;
  title: string | null;
  workspace_id: string;
}

async function getUserMembership(
  db: D1Database,
  userId: string,
  workspaceId: string
): Promise<MembershipRow | null> {
  return db
    .prepare(
      `SELECT role, title, workspace_id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2`
    )
    .bind(userId, workspaceId)
    .first<MembershipRow>();
}

interface OnboardingRow {
  state: string;
  workspace_id: string | null;
  payload_json: string | null;
  updated_at: number | null;
}

async function getOnboarding(
  db: D1Database,
  userId: string
): Promise<OnboardingRow | null> {
  return db
    .prepare(`SELECT state, workspace_id, payload_json, updated_at FROM onboarding WHERE user_id = ?1`)
    .bind(userId)
    .first<OnboardingRow>();
}

interface UserSettingsRow {
  locale: string | null;
  orb_variant: string | null;
  theme: string | null;
}

async function getUserSettings(
  db: D1Database,
  userId: string
): Promise<UserSettingsRow | null> {
  return db
    .prepare(`SELECT locale, orb_variant, theme FROM user_settings WHERE user_id = ?1`)
    .bind(userId)
    .first<UserSettingsRow>();
}

// ---------------------------------------------------------------------------
// Shared: resolve session from cookie → user + session
// ---------------------------------------------------------------------------

interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
}

async function resolveSession(
  req: Request,
  env: Env
): Promise<ResolvedSession | null> {
  // Prefer explicit bearer auth when present. This avoids stale mf-s cookies
  // shadowing the active Supabase browser session in local development.
  const auth = req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) {
    const suUser = await verifySupabaseToken(token, env);
    if (suUser) {
      await upsertUser(env.ASSISTANT_DB, suUser);
      const user = await getUser(env.ASSISTANT_DB, suUser.id);
      if (!user) return null;
      const workspaceId = await resolvePreferredWorkspaceForUser(env.ASSISTANT_DB, user, env);

      const now = Date.now();
      const syntheticSession: SessionRow = {
        id: `bearer:${suUser.id}`,
        user_id: suUser.id,
        expires_at: now + 5 * 60 * 1000,
        active_workspace_id: workspaceId,
        revoked_at: null,
      };

      return { session: syntheticSession, user };
    }
  }

  const cookies = parseCookies(req.headers.get("Cookie"));
  const sessionId = cookies["mf-s"];
  if (sessionId) {
    const session = await lookupSession(env.ASSISTANT_DB, sessionId);
    if (session && !session.revoked_at && session.expires_at >= Date.now()) {
      const user = await getUser(env.ASSISTANT_DB, session.user_id);
      if (user) {
        return { session, user };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: build WhoamiResponse-compatible workspace object
// ---------------------------------------------------------------------------

function buildWhoamiWorkspace(ws: WorkspaceRow) {
  let brand: Record<string, unknown> = {
    productName: "Elyra Core",
    assistantName: "Elyra",
    workspaceLabel: ws.name,
  };
  if (ws.brand_json) {
    try {
      brand = { ...brand, ...JSON.parse(ws.brand_json) };
    } catch { /* ignore malformed brand_json */ }
  }
  return {
    id: ws.id,
    slug: ws.slug,
    type: ws.type,
    name: ws.name,
    brand,
  };
}

async function resolveActiveWorkspaceForSession(
  db: D1Database,
  session: SessionRow,
  user: UserRow,
  env: Env
): Promise<WorkspaceRow | null> {
  let activeWorkspaceId = session.active_workspace_id;

  if (!activeWorkspaceId) {
    activeWorkspaceId = await resolvePreferredWorkspaceForUser(db, user, env);
  }

  if (activeWorkspaceId && session.active_workspace_id !== activeWorkspaceId) {
    await db
      .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
      .bind(activeWorkspaceId, session.id)
      .run();
  }

  const workspaces = await getUserWorkspaces(db, user.id);
  const explicitActive = activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null;
  if (explicitActive) {
    return explicitActive;
  }

  const fallback = workspaces[0] ?? null;
  if (!fallback) {
    // Create a personal workspace if none exist
    console.log("[resolveActiveWorkspaceForSession] No workspaces found, creating personal workspace for", user.id);
    const personalWorkspaceId = await ensurePersonalWorkspace(db, user.id, user.email || "");
    await db
      .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
      .bind(personalWorkspaceId, session.id)
      .run();
    const newWorkspaces = await getUserWorkspaces(db, user.id);
    return newWorkspaces.find(w => w.id === personalWorkspaceId) ?? null;
  }

  if (fallback.id !== session.active_workspace_id) {
    await db
      .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
      .bind(fallback.id, session.id)
      .run();
  }

  return fallback;
}

async function createWorkspaceForUser(
  db: D1Database,
  user: UserRow,
  input: { name: string; slug?: string | null; type: "personal" | "company" }
): Promise<string> {
  const now = Date.now();

  if (input.type === "personal") {
    const workspaceId = await ensurePersonalWorkspace(db, user.id, user.email);
    await db
      .prepare(`UPDATE workspaces SET name = ?1 WHERE id = ?2`)
      .bind(input.name, workspaceId)
      .run();
    return workspaceId;
  }

  const normalizedBaseSlug = ((input.slug ?? "").trim().toLowerCase() || input.name.trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || `workspace-${user.id.slice(0, 8)}`;

  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? normalizedBaseSlug : `${normalizedBaseSlug}-${i + 1}`;
    const workspaceId = crypto.randomUUID();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
             VALUES (?1, ?2, 'company', ?3, ?4, ?5)`
          )
          .bind(workspaceId, slug, input.name, now, user.id),
        db
          .prepare(
            `INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at)
             VALUES (?1, ?2, ?3, 'owner', NULL, ?4)`
          )
          .bind(crypto.randomUUID(), user.id, workspaceId, now),
      ]);
      return workspaceId;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("UNIQUE constraint failed: workspaces.slug")) {
        throw error;
      }
    }
  }

  const slug = `${normalizedBaseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  const workspaceId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
         VALUES (?1, ?2, 'company', ?3, ?4, ?5)`
      )
      .bind(workspaceId, slug, input.name, now, user.id),
    db
      .prepare(
        `INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at)
         VALUES (?1, ?2, ?3, 'owner', NULL, ?4)`
      )
      .bind(crypto.randomUUID(), user.id, workspaceId, now),
  ]);
  return workspaceId;
}

async function handleCreateWorkspace(req: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  let body: { name?: string; slug?: string | null; type?: "personal" | "company" };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body", message: "JSON body required." }, 400);
  }

  const name = (body.name ?? "").trim();
  const type = body.type === "company" ? "company" : body.type === "personal" ? "personal" : null;
  const slug = typeof body.slug === "string" ? body.slug.trim() : null;

  if (!name || !type) {
    return json({ ok: false, error: "invalid_request", message: "Workspace name and type are required." }, 400);
  }

  try {
    const workspaceId = await createWorkspaceForUser(env.ASSISTANT_DB, resolved.user, { name, slug, type });
    await env.ASSISTANT_DB
      .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
      .bind(workspaceId, resolved.session.id)
      .run();
    await env.ASSISTANT_DB
      .prepare(`UPDATE users SET default_workspace_id = ?1 WHERE id = ?2 AND default_workspace_id IS NULL`)
      .bind(workspaceId, resolved.user.id)
      .run();
    return handleWhoami(req, env);
  } catch (error) {
    return json(
      {
        ok: false,
        error: "workspace_create_failed",
        message: error instanceof Error ? error.message : "Unable to create workspace.",
      },
      500
    );
  }
}

async function handleSetActiveWorkspace(req: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  let body: { workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body", message: "JSON body required." }, 400);
  }

  const workspaceId = (body.workspaceId ?? "").trim();
  if (!workspaceId) {
    return json({ ok: false, error: "workspace_required", message: "workspaceId is required." }, 400);
  }

  const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, workspaceId);
  if (!membership) {
    return json({ ok: false, error: "workspace_not_accessible", message: "No access to this workspace." }, 403);
  }

  await env.ASSISTANT_DB
    .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
    .bind(workspaceId, resolved.session.id)
    .run();

  return handleWhoami(req, env);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleExchange(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return json({ ok: false, error: "missing_token", message: "Bearer token required." }, 401);
  }

  if (!env.SUPABASE_URL || (!env.SUPABASE_ANON_KEY && !(env as any).SUPABASE_SERVICE_ROLE_KEY)) {
    return json(
      {
        ok: false,
        error: "config_error",
        message: "Worker Supabase config missing (SUPABASE_URL + SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY).",
      },
      500
    );
  }

  const suUser = await verifySupabaseToken(token, env);
  if (!suUser) {
    return json({ ok: false, error: "invalid_token", message: "Supabase token invalid or expired." }, 401);
  }

  // Invite-only gate: if USER_ALLOWLIST is configured, only listed emails/domains may get sessions.
  if (env.USER_ALLOWLIST) {
    const allowed = parseLowerAllowlist(env.USER_ALLOWLIST);
    if (!isEmailAllowed(suUser.email, allowed)) {
      return json(
        { ok: false, error: "not_authorized", message: "Access by invitation only. Contact team@elyra-core.app." },
        403
      );
    }
  }

  await upsertUser(env.ASSISTANT_DB, suUser);

  const user = await getUser(env.ASSISTANT_DB, suUser.id);
  if (!user) {
    return json({ ok: false, error: "user_not_found", message: "Unable to load user profile." }, 500);
  }
  const workspaceId = await resolvePreferredWorkspaceForUser(env.ASSISTANT_DB, user, env);

  const sessionId = await createSession(env.ASSISTANT_DB, suUser.id, workspaceId);

  const cookie = buildSetCookie("mf-s", sessionId, env);
  return json(
    { ok: true, workspaceId },
    200,
    { "Set-Cookie": cookie }
  );
}

async function handleWhoami(req: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(req, env);

  // Frontend expects 401 when unauthenticated — useWhoamiLoader checks response.ok
  if (!resolved) {
    return json(
      {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Not authenticated",
        loginUrl: "/signin",
      },
      401
    );
  }

  const { session, user } = resolved;
  const db = env.ASSISTANT_DB;
  const activeWs = await resolveActiveWorkspaceForSession(db, session, user, env);

  const [allWorkspaces, onboarding, settings] = await Promise.all([
    getUserWorkspaces(db, user.id),
    getOnboarding(db, user.id),
    getUserSettings(db, user.id),
  ]);

  const workspaces = allWorkspaces;

  const membership = activeWs
    ? await getUserMembership(db, user.id, activeWs.id)
    : null;

  const onboardingState = onboarding?.state ?? "pending";
  let onboardingPayload: Record<string, unknown> | null = null;
  if (onboarding?.payload_json) {
    try { onboardingPayload = JSON.parse(onboarding.payload_json); } catch { /* ignore */ }
  }
  const roleCapabilities = membership ? [`role:${membership.role}`] : [];
  if (membership?.role === "system_owner") {
    roleCapabilities.push(
      "workspace.identity.manage",
      "workspace.members.manage",
      "workspace.access.manage",
      "workspace.connections.manage",
      "system.platform.manage"
    );
  } else if (membership?.role === "owner" || membership?.role === "admin") {
    roleCapabilities.push(
      "workspace.identity.manage",
      "workspace.members.manage",
      "workspace.access.manage",
      "workspace.connections.manage"
    );
  }
  const activeWorkspaceScope = activeWs?.type === "system_platform"
    ? "system_platform"
    : activeWs?.type === "company"
      ? "company"
      : "personal";

  // Shape matches frontend WhoamiResponse type
  return json({
    ok: true,
    user: { id: user.id, email: user.email },
    userId: user.id,
    userKey: user.email?.split("@")[0] ?? user.id,
    workspaces: workspaces.map(buildWhoamiWorkspace),
    activeWorkspace: activeWs ? buildWhoamiWorkspace(activeWs) : null,
    membership: membership
      ? { role: membership.role, title: membership.title, workspaceId: membership.workspace_id }
      : null,
    capabilities: roleCapabilities,
    workspaceScope: activeWorkspaceScope,
    onboarding: {
      state: onboardingState,
      workspaceId: onboarding?.workspace_id ?? null,
      payload: onboardingPayload,
      updatedAt: onboarding?.updated_at ?? 0,
    },
    userSettings: {
      locale: settings?.locale ?? null,
      language: settings?.locale ?? null,
      orbVariant: settings?.orb_variant ?? null,
      theme: settings?.theme ?? null,
      defaultWorkspaceId: user.default_workspace_id,
      alwaysPersonalOnLogin: false,
    },
  });
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(req.headers.get("Cookie"));
  const sessionId = cookies["mf-s"];

  if (sessionId) {
    await env.ASSISTANT_DB
      .prepare(`UPDATE sessions SET revoked_at = ?1 WHERE id = ?2`)
      .bind(Date.now(), sessionId)
      .run();
  }

  const clearCookie = buildSetCookie("mf-s", "", env, true);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie });
}

async function handleOnboardingComplete(req: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, code: "AUTH_REQUIRED", message: "Not authenticated" }, 401);
  }

  const { session, user } = resolved;
  const db = env.ASSISTANT_DB;

  let body: {
    workspaceType?: string;
    workspaceName?: string;
    role?: string;
    title?: string;
    goal?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body", message: "JSON body required." }, 400);
  }

  const founderIdentity = isFounderIdentity(user.email, env);
  const wsType = normalizeWorkspaceType(body.workspaceType, founderIdentity);
  const wsName = (body.workspaceName || "").trim();
  const role = normalizeMembershipRole(body.role, wsType, founderIdentity);
  const title = (body.title || "").trim();
  const goal = body.goal?.trim() || null;

  if (!wsName) {
    return json({ ok: false, error: "missing_workspace_name", message: "Workspace name is required." }, 400);
  }

  try {
    let workspaceId: string;

    if (wsType === "personal") {
      // Use existing personal workspace, just update its name
      workspaceId = await ensurePersonalWorkspace(db, user.id, user.email);
      if (wsName !== "Personal") {
        await db
          .prepare(`UPDATE workspaces SET name = ?1 WHERE id = ?2`)
          .bind(wsName, workspaceId)
          .run();
      }
    } else if (wsType === "system_platform") {
      workspaceId = await ensureSystemPlatformWorkspace(db, user.id, user.email);
      await db
        .prepare(`UPDATE workspaces SET name = ?1, type = 'system_platform' WHERE id = ?2`)
        .bind(wsName, workspaceId)
        .run();
      await db
        .prepare(
          `UPDATE memberships
           SET role = 'system_owner', title = ?1
           WHERE user_id = ?2 AND workspace_id = ?3`
        )
        .bind(title || null, user.id, workspaceId)
        .run();
    } else {
      // Create a new company workspace with unique slug
      const baseSlug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const batchNow = Date.now();
      let created = false;

      for (let i = 0; i < 5 && !created; i++) {
        const slug = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
        workspaceId = crypto.randomUUID();
        try {
          await db.batch([
            db
              .prepare(
                `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
              )
                .bind(workspaceId, slug, wsType, wsName, batchNow, user.id),
            db
              .prepare(
                `INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
              )
              .bind(crypto.randomUUID(), user.id, workspaceId, role, title || null, batchNow),
          ]);
          created = true;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("UNIQUE constraint failed: workspaces.slug")) throw e;
        }
      }

      if (!created) {
        // Final fallback: random suffix
        const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
        workspaceId = crypto.randomUUID();
        await db.batch([
          db
            .prepare(
              `INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
            )
            .bind(workspaceId, slug, wsType, wsName, batchNow, user.id),
          db
            .prepare(
              `INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
            )
            .bind(crypto.randomUUID(), user.id, workspaceId, role, title || null, batchNow),
        ]);
      }
    }

    // Update membership title if provided (for personal workspace too)
    if (title) {
      await db
        .prepare(
          `UPDATE memberships SET title = ?1 WHERE user_id = ?2 AND workspace_id = ?3`
        )
        .bind(title, user.id, workspaceId)
        .run();
    }

    // Upsert onboarding state
    const now = Date.now();
    const payloadJson = JSON.stringify({ workspaceType: wsType, workspaceName: wsName, role, title, goal });
    await db
      .prepare(
        `INSERT INTO onboarding (id, user_id, workspace_id, state, payload_json, updated_at)
         VALUES (?1, ?2, ?3, 'done', ?4, ?5)
         ON CONFLICT(user_id) DO UPDATE SET
           workspace_id = ?3,
           state = 'done',
           payload_json = ?4,
           updated_at = ?5`
      )
      .bind(crypto.randomUUID(), user.id, workspaceId, payloadJson, now)
      .run();

    // Set active workspace to the onboarded one
    await db
      .prepare(`UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2`)
      .bind(workspaceId, session.id)
      .run();

    return json({ ok: true, workspaceId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[onboarding] complete failed:", detail, err);
    return json(
      {
        ok: false,
        error: "onboarding_failed",
        message: "Onboarding could not be completed.",
        detail,
      },
      500
    );
  }
}

// ---------------------------------------------------------------------------
// Action Confirmation handlers (B3-001)
// ---------------------------------------------------------------------------

function buildElliContextFromSession(
  resolved: ResolvedSession,
  connectedIntegrations: ("gmail" | "calendar" | "tasks")[] = []
): ElliContext {
  return {
    identity: {
      userId: resolved.user.id,
      locale: "en-US",
      role: "owner",
      timezone: "UTC",
    },
    workspace: {
      workspaceId: resolved.session.active_workspace_id || "",
      workspaceName: "",
      connectedIntegrations,
    },
    tool: { activeTool: "home", state: "populated" },
    conversation: { messageCount: 1, pendingActionIds: [] },
    time: { localIso: new Date().toISOString(), dayOfWeek: new Date().getDay() },
  };
}

async function handleActionPropose(req: Request, env: Env): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  let body: { input?: string };
  try {
    body = await req.json() as { input?: string };
  } catch {
    return json({ ok: false, error: "bad_request", message: "Invalid JSON body." }, 400);
  }

  const input = body?.input;
  if (!input || typeof input !== "string" || !input.trim()) {
    return json({ ok: false, error: "bad_request", message: "\"input\" is required." }, 400);
  }

  const workspaceId = resolved.session.active_workspace_id;
  if (!workspaceId) {
    return json({ ok: false, error: "no_workspace", message: "No active workspace." }, 400);
  }

  const ctx = buildElliContextFromSession(resolved);
  const proposalId = crypto.randomUUID();
  const proposal = buildActionProposal({ id: proposalId, input, ctx });
  const problems = validateActionProposal(proposal);

  if (problems.length > 0) {
    return json({ ok: false, error: "validation_failed", problems, proposal }, 422);
  }

  const { id: confirmationEventId, expiresAt } = await createConfirmationEvent(
    env.ASSISTANT_DB,
    { proposal, userId: resolved.user.id, workspaceId }
  );

  return json({
    ok: true,
    proposal,
    confirmationEventId,
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

async function handleActionConfirm(req: Request, env: Env, actionId: string): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  const workspaceId = resolved.session.active_workspace_id;
  if (!workspaceId) {
    return json({ ok: false, error: "no_workspace", message: "No active workspace." }, 400);
  }

  try {
    const event = await confirmEvent(env.ASSISTANT_DB, actionId, resolved.user.id, workspaceId);
    return json({ ok: true, state: event.state, confirmationEventId: actionId });
  } catch (err) {
    if (err instanceof ConfirmationError) {
      return json({ ok: false, error: err.code, message: err.message }, err.status);
    }
    throw err;
  }
}

async function handleActionCancel(req: Request, env: Env, actionId: string): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  const workspaceId = resolved.session.active_workspace_id;
  if (!workspaceId) {
    return json({ ok: false, error: "no_workspace", message: "No active workspace." }, 400);
  }

  try {
    const event = await cancelEvent(env.ASSISTANT_DB, actionId, resolved.user.id, workspaceId);
    return json({ ok: true, state: event.state, confirmationEventId: actionId });
  } catch (err) {
    if (err instanceof ConfirmationError) {
      return json({ ok: false, error: err.code, message: err.message }, err.status);
    }
    throw err;
  }
}

async function handleActionGet(req: Request, env: Env, actionId: string): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated." }, 401);
  }

  const event = await getConfirmationEvent(env.ASSISTANT_DB, actionId);
  if (!event) {
    return json({ ok: false, error: "not_found", message: "Confirmation event not found." }, 404);
  }

  if (event.user_id !== resolved.user.id) {
    return json({ ok: false, error: "forbidden", message: "Not your confirmation event." }, 403);
  }

  let proposal: unknown = null;
  try {
    proposal = JSON.parse(event.proposal_json);
  } catch { /* proposal stays null */ }

  return json({
    ok: true,
    confirmationEventId: event.id,
    state: event.state,
    proposal,
    createdAt: new Date(event.created_at).toISOString(),
    expiresAt: new Date(event.expires_at).toISOString(),
    confirmedAt: event.confirmed_at ? new Date(event.confirmed_at).toISOString() : null,
    executedAt: event.executed_at ? new Date(event.executed_at).toISOString() : null,
    resultState: event.result_state,
    errorMessage: event.error_message,
  });
}

// ---------------------------------------------------------------------------
// Workspace-scoped route helpers
// ---------------------------------------------------------------------------

// --- Poker ---

async function handleGetPoker(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  }
  const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, workspaceId);
  if (!membership) {
    return json({ ok: false, error: "workspace_not_accessible" }, 403);
  }
  const row = await env.ASSISTANT_DB
    .prepare(
      `SELECT json FROM poker_state WHERE user_id = ?1 AND workspace_id = ?2`
    )
    .bind(resolved.user.id, workspaceId)
    .first<{ json: string }>();

  if (!row) {
    return json({ ok: true, state: null });
  }
  try {
    return json({ ok: true, state: JSON.parse(row.json) });
  } catch {
    return json({ ok: true, state: null });
  }
}

async function handlePutPoker(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  }
  const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, workspaceId);
  if (!membership) {
    return json({ ok: false, error: "workspace_not_accessible" }, 403);
  }
  let body: { pending_action?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const stateJson = JSON.stringify({
    pending_action: body.pending_action ?? null,
  });
  const now = Date.now();

  await env.ASSISTANT_DB
    .prepare(
      `INSERT INTO poker_state (user_id, workspace_id, json, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET
         json = ?3,
         updated_at = ?4`
    )
    .bind(resolved.user.id, workspaceId, stateJson, now)
    .run();

  return json({ ok: true });
}

function resolveUserKey(resolved: ResolvedSession): string {
  const email = (resolved.user.email || "").trim().toLowerCase();
  if (email.includes("@")) {
    const localPart = email.split("@")[0];
    if (localPart) return localPart;
  }
  return resolved.user.id;
}

async function requireWorkspaceAccess(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<{ resolved: ResolvedSession; userKey: string } | Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  }

  const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, workspaceId);
  if (!membership) {
    return json({ ok: false, error: "workspace_not_accessible" }, 403);
  }

  return { resolved, userKey: resolveUserKey(resolved) };
}

async function getGoogleAccessToken(
  env: Env,
  userKey: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const data = await getAccessTokenFromKV(env as any, userKey, workspaceId);
    return data.accessToken || null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string | undefined | null): string {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
}

function extractHeader(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  if (!Array.isArray(headers)) return "";
  const found = headers.find((header) => (header?.name || "").toLowerCase() === name.toLowerCase());
  return (found?.value || "").trim();
}

function extractPartBody(
  part: any,
  mimeType: string,
): string {
  if (!part || typeof part !== "object") return "";
  const partMime = (part.mimeType || "").toLowerCase();
  if (partMime === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const result = extractPartBody(child, mimeType);
      if (result) return result;
    }
  }
  return "";
}

function normalizeThreadSummary(thread: any): Record<string, unknown> {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const latest = messages[messages.length - 1] ?? {};
  const headers = latest?.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
  const from = extractHeader(headers, "From");
  const subject = extractHeader(headers, "Subject");
  const date = extractHeader(headers, "Date");
  const unread = messages.some((message: any) => Array.isArray(message?.labelIds) && message.labelIds.includes("UNREAD"));

  return {
    id: (thread?.id || thread?.threadId || "").toString(),
    threadId: (thread?.id || thread?.threadId || "").toString(),
    from,
    subject,
    snippet: (thread?.snippet || "").toString(),
    date,
    unread,
  };
}

function normalizeThreadDetail(thread: any): Record<string, unknown> {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const normalizedMessages = messages.map((message: any) => {
    const headers = message?.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
    const bodyText = extractPartBody(message?.payload, "text/plain");
    const bodyHtml = extractPartBody(message?.payload, "text/html");
    return {
      id: (message?.id || "").toString(),
      threadId: (message?.threadId || thread?.id || "").toString(),
      from: extractHeader(headers, "From"),
      to: extractHeader(headers, "To"),
      cc: extractHeader(headers, "Cc"),
      subject: extractHeader(headers, "Subject"),
      date: extractHeader(headers, "Date"),
      snippet: (message?.snippet || "").toString(),
      textPlain: bodyText,
      textHtml: bodyHtml,
    };
  });

  const latest = normalizedMessages[normalizedMessages.length - 1];

  return {
    id: (thread?.id || "").toString(),
    subject: latest?.subject || "",
    snippet: (thread?.snippet || latest?.snippet || "").toString(),
    messages: normalizedMessages,
  };
}

function normalizeCalendarEvent(event: any): Record<string, unknown> | null {
  const id = (event?.id || "").toString();
  if (!id) return null;
  const start = event?.start?.dateTime || event?.start?.date || null;
  const end = event?.end?.dateTime || event?.end?.date || null;
  if (!start) return null;
  return {
    id,
    title: (event?.summary || "Untitled event").toString(),
    summary: (event?.summary || "Untitled event").toString(),
    description: (event?.description || "").toString(),
    location: (event?.location || "").toString(),
    start_at: start,
    end_at: end,
    source: "google",
    kind: "external",
    status: (event?.status || "confirmed").toString(),
  };
}

function normalizeDriveFile(file: any): Record<string, unknown> | null {
  const id = (file?.id || "").toString();
  if (!id) return null;
  return {
    id,
    name: (file?.name || "Untitled").toString(),
    mimeType: (file?.mimeType || "").toString(),
    modifiedTime: (file?.modifiedTime || "").toString(),
    createdTime: (file?.createdTime || "").toString(),
    webViewLink: (file?.webViewLink || "").toString(),
    webContentLink: (file?.webContentLink || "").toString(),
    iconLink: (file?.iconLink || "").toString(),
    size: file?.size ? Number(file.size) : null,
    source: "google",
    kind: "external",
  };
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function trackToolUsage(
  env: Env,
  input: {
    workspaceId: string;
    userId: string;
    domain: "drive" | "docs" | "slides";
    action: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const now = Date.now();
    await env.ASSISTANT_DB
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7)`
      )
      .bind(
        crypto.randomUUID(),
        input.workspaceId,
        input.userId,
        input.action,
        input.domain,
        JSON.stringify(input.metadata ?? {}),
        now
      )
      .run();

    const day = todayUtcDate();
    const existing = await env.ASSISTANT_DB
      .prepare(
        `SELECT requests_count, tokens_count, cost_cents
         FROM usage_daily
         WHERE workspace_id = ?1 AND user_id = ?2 AND day_utc = ?3
         LIMIT 1`
      )
      .bind(input.workspaceId, input.userId, day)
      .first<{ requests_count: number; tokens_count: number; cost_cents: number }>();

    const requests = (existing?.requests_count ?? 0) + 1;
    const tokens = existing?.tokens_count ?? 0;
    const cost = existing?.cost_cents ?? 0;

    await env.ASSISTANT_DB
      .prepare(
        `INSERT INTO usage_daily (id, workspace_id, user_id, day_utc, requests_count, tokens_count, cost_cents, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(workspace_id, user_id, day_utc) DO UPDATE SET
           requests_count = excluded.requests_count,
           tokens_count = excluded.tokens_count,
           cost_cents = excluded.cost_cents,
           updated_at = excluded.updated_at`
      )
      .bind(crypto.randomUUID(), input.workspaceId, input.userId, day, requests, tokens, cost, now)
      .run();
  } catch (error) {
    console.warn("[usage] trackToolUsage failed", {
      workspaceId: input.workspaceId,
      userId: input.userId,
      domain: input.domain,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchGoogleJson(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Google API error (${response.status})`;
    const error = new Error(message);
    (error as any).status = response.status;
    throw error;
  }
  return payload;
}

async function handleMailStatus(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, provider: null, code: "NOT_CONNECTED" });
  }

  return json({ ok: true, connected: true, provider: "google" });
}

async function handleMailLabels(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", labels: [] });
  }

  try {
    const payload = await fetchGoogleJson(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/labels");
    const labels = Array.isArray(payload?.labels)
      ? payload.labels.map((label: any) => ({
          id: (label?.id || "").toString(),
          name: (label?.name || "").toString(),
        })).filter((label: { id: string; name: string }) => Boolean(label.id))
      : [];
    return json({ ok: true, labels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Gmail labels";
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailThreads(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", threads: [] });
  }

  const url = new URL(req.url);
  const label = (url.searchParams.get("label") || "INBOX").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || "20")));

  try {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
    listUrl.searchParams.set("maxResults", String(limit));
    if (label) {
      listUrl.searchParams.set("labelIds", label);
    }

    const listed = await fetchGoogleJson(accessToken, listUrl.toString());
    const threadRefs = Array.isArray(listed?.threads) ? listed.threads : [];

    const threads = await Promise.all(
      threadRefs.map(async (threadRef: any) => {
        const threadId = (threadRef?.id || "").toString();
        if (!threadId) return null;
        const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`);
        detailUrl.searchParams.set("format", "metadata");
        detailUrl.searchParams.append("metadataHeaders", "From");
        detailUrl.searchParams.append("metadataHeaders", "Subject");
        detailUrl.searchParams.append("metadataHeaders", "Date");
        const detail = await fetchGoogleJson(accessToken, detailUrl.toString());
        return normalizeThreadSummary(detail);
      })
    );

    return json({ ok: true, threads: threads.filter(Boolean) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Gmail inbox";
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailThreadDetail(
  req: Request,
  env: Env,
  workspaceId: string,
  threadId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", thread: null });
  }

  try {
    const detail = await fetchGoogleJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`
    );
    return json({ ok: true, thread: normalizeThreadDetail(detail) });
  } catch (error) {
    const status = (error as any)?.status;
    const message = error instanceof Error ? error.message : "Unable to load Gmail thread";
    if (status === 404) {
      return json({ ok: false, error: "thread_not_found", message }, 404);
    }
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailMessageDetail(
  req: Request,
  env: Env,
  workspaceId: string,
  messageId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", message: null });
  }

  try {
    const detail = await fetchGoogleJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
    );
    const mappedThread = normalizeThreadDetail({ id: detail?.threadId || "", messages: [detail], snippet: detail?.snippet || "" });
    const first = Array.isArray((mappedThread as any).messages) ? (mappedThread as any).messages[0] : null;
    return json({ ok: true, message: first });
  } catch (error) {
    const status = (error as any)?.status;
    const message = error instanceof Error ? error.message : "Unable to load Gmail message";
    if (status === 404) {
      return json({ ok: false, error: "message_not_found", message }, 404);
    }
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailSend(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED" });
  }

  let body: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    bodyText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body", message: "Invalid JSON body." }, 400);
  }

  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim();
  const bodyText = (body.bodyText || "").trim();
  if (!to || !subject || !bodyText) {
    return json({ ok: false, error: "invalid_payload", message: "to, subject and bodyText are required." }, 400);
  }

  const lines = [
    `To: ${to}`,
    body.cc ? `Cc: ${body.cc}` : null,
    body.bcc ? `Bcc: ${body.bcc}` : null,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    bodyText,
  ].filter(Boolean) as string[];

  const payload = { raw: base64url(lines.join("\r\n")) };

  try {
    const sent = await fetchGoogleJson(accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return json({ ok: true, sent: { id: sent?.id || null, threadId: sent?.threadId || null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send Gmail message";
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailThreadTrash(
  req: Request,
  env: Env,
  workspaceId: string,
  threadId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED" });
  }

  try {
    await fetchGoogleJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/trash`,
      { method: "POST" }
    );
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to trash Gmail thread";
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function handleMailDraftReply(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: false, error: "NOT_CONNECTED", message: "Mail not connected." }, 409);
  }

  let body: { threadId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const threadId = (body.threadId || "").trim();
  if (!threadId) {
    return json({ ok: false, error: "thread_id_required" }, 400);
  }

  try {
    const detail = await fetchGoogleJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`
    );
    const summary = normalizeThreadSummary(detail);
    const subject = ((summary.subject as string) || "").trim();
    const from = ((summary.from as string) || "").trim();
    const draftSubject = subject ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : "Re: Follow-up";
    const draftBody = [
      `Hi ${from || "there"},`,
      "",
      "thanks for your message.",
      "",
      "Best regards",
    ].join("\n");

    return json({
      ok: true,
      draft: {
        to: from,
        subject: draftSubject,
        body: draftBody,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to draft reply";
    return json({ ok: false, error: "gmail_error", message }, 502);
  }
}

async function listCalendarEventsForWorkspace(
  req: Request,
  env: Env,
  workspaceId: string,
  userKey: string
): Promise<Response> {
  const accessToken = await getGoogleAccessToken(env, userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", events: [] });
  }

  const url = new URL(req.url);
  const range = Math.min(365, Math.max(1, Number(url.searchParams.get("range") || "30")));
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "60")));

  const timeMin = start || new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const timeMax = end || new Date(Date.now() + range * 24 * 60 * 60 * 1000).toISOString();

  try {
    const listUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    listUrl.searchParams.set("timeMin", timeMin);
    listUrl.searchParams.set("timeMax", timeMax);
    listUrl.searchParams.set("singleEvents", "true");
    listUrl.searchParams.set("orderBy", "startTime");
    listUrl.searchParams.set("maxResults", String(limit));

    const payload = await fetchGoogleJson(accessToken, listUrl.toString());
    const events = Array.isArray(payload?.items)
      ? payload.items
          .map((event: any) => normalizeCalendarEvent(event))
          .filter((event: Record<string, unknown> | null): event is Record<string, unknown> => Boolean(event))
      : [];
    return json({ ok: true, connected: true, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Calendar events";
    return json({ ok: false, error: "calendar_error", message }, 502);
  }
}

async function handleCalendarEvents(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;
  return listCalendarEventsForWorkspace(req, env, workspaceId, gate.userKey);
}

async function handleCalendarMutate(
  req: Request,
  env: Env,
  kind: "create" | "update" | "delete"
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  }

  const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
  if (!activeWs) {
    return json({ ok: false, error: "workspace_not_accessible" }, 403);
  }

  const userKey = resolveUserKey(resolved);
  const accessToken = await getGoogleAccessToken(env, userKey, activeWs.id);
  if (!accessToken) {
    return json({ ok: false, error: "calendar_not_connected", code: "NOT_CONNECTED" }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  try {
    if (kind === "create") {
      const summary = ((body.summary || body.title || "") as string).trim() || "Untitled event";
      const start = (body.start as string | undefined)?.trim();
      const end = (body.end as string | undefined)?.trim();
      if (!start || !end) {
        return json({ ok: false, error: "invalid_payload", message: "start and end are required." }, 400);
      }

      const payload = await fetchGoogleJson(accessToken, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        body: JSON.stringify({
          summary,
          description: body.description || "",
          location: body.location || "",
          start: { dateTime: start },
          end: { dateTime: end },
        }),
      });

      return json({ ok: true, event: normalizeCalendarEvent(payload) });
    }

    if (kind === "update") {
      const eventId = ((body.eventId || body.id || "") as string).trim();
      if (!eventId) {
        return json({ ok: false, error: "invalid_payload", message: "eventId is required." }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.summary === "string" || typeof body.title === "string") {
        patch.summary = (body.summary || body.title || "").toString();
      }
      if (typeof body.description === "string") patch.description = body.description;
      if (typeof body.location === "string") patch.location = body.location;
      if (typeof body.start === "string") patch.start = { dateTime: body.start };
      if (typeof body.end === "string") patch.end = { dateTime: body.end };

      const payload = await fetchGoogleJson(
        accessToken,
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        }
      );

      return json({ ok: true, event: normalizeCalendarEvent(payload) });
    }

    const eventId = ((body.eventId || body.id || "") as string).trim();
    if (!eventId) {
      return json({ ok: false, error: "invalid_payload", message: "eventId is required." }, 400);
    }
    await fetchGoogleJson(
      accessToken,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar request failed";
    return json({ ok: false, error: "calendar_error", message }, 502);
  }
}

async function handleDriveStatus(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;
  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, provider: null, code: "NOT_CONNECTED" });
  }
  return json({ ok: true, connected: true, provider: "google" });
}

async function handleDriveFilesList(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", files: [] });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const mimeType = (url.searchParams.get("mimeType") || "").trim();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "25")));
  const pageToken = (url.searchParams.get("pageToken") || "").trim();

  const filters = ["trashed = false"];
  if (q) filters.push(`name contains '${q.replace(/'/g, "\\'")}'`);
  if (mimeType) filters.push(`mimeType = '${mimeType.replace(/'/g, "\\'")}'`);

  try {
    const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
    listUrl.searchParams.set("q", filters.join(" and "));
    listUrl.searchParams.set("pageSize", String(limit));
    listUrl.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,webContentLink,iconLink,size)"
    );
    listUrl.searchParams.set("orderBy", "modifiedTime desc");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const payload = await fetchGoogleJson(accessToken, listUrl.toString());
    const files = Array.isArray(payload?.files)
      ? payload.files
          .map((file: any) => normalizeDriveFile(file))
          .filter((file: Record<string, unknown> | null): file is Record<string, unknown> => Boolean(file))
      : [];

    await trackToolUsage(env, {
      workspaceId,
      userId: gate.resolved.user.id,
      domain: "drive",
      action: "tool_called",
      metadata: { route: "drive.list", count: files.length },
    });

    return json({ ok: true, connected: true, files, nextPageToken: payload?.nextPageToken || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Drive files";
    return json({ ok: false, error: "drive_error", message }, 502);
  }
}

async function handleDriveFileDetail(
  req: Request,
  env: Env,
  workspaceId: string,
  fileId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;

  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", file: null });
  }

  try {
    const detail = await fetchGoogleJson(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,webContentLink,iconLink,size`
    );

    await trackToolUsage(env, {
      workspaceId,
      userId: gate.resolved.user.id,
      domain: "drive",
      action: "tool_called",
      metadata: { route: "drive.get", fileId },
    });

    return json({ ok: true, file: normalizeDriveFile(detail) });
  } catch (error) {
    const status = (error as any)?.status;
    const message = error instanceof Error ? error.message : "Unable to load Drive file";
    if (status === 404) return json({ ok: false, error: "file_not_found", message }, 404);
    return json({ ok: false, error: "drive_error", message }, 502);
  }
}

async function handleDriveMutate(
  req: Request,
  env: Env,
  kind: "create" | "update" | "delete",
  workspaceId?: string
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  let targetWorkspaceId = workspaceId || "";
  if (targetWorkspaceId) {
    const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, targetWorkspaceId);
    if (!membership) return json({ ok: false, error: "workspace_not_accessible" }, 403);
  } else {
    const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
    if (!activeWs) return json({ ok: false, error: "workspace_not_accessible" }, 403);
    targetWorkspaceId = activeWs.id;
  }

  const userKey = resolveUserKey(resolved);
  const accessToken = await getGoogleAccessToken(env, userKey, targetWorkspaceId);
  if (!accessToken) {
    return json({ ok: false, error: "drive_not_connected", code: "NOT_CONNECTED" }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  try {
    if (kind === "create") {
      const name = ((body.name || body.title || "Untitled") as string).trim() || "Untitled";
      const mimeType = ((body.mimeType || "text/plain") as string).trim();
      const content = ((body.content || "") as string).toString();

      const boundary = `elyra-boundary-${crypto.randomUUID()}`;
      const multipartBody =
        `--${boundary}\r\n` +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        `${JSON.stringify({ name, mimeType })}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType || "text/plain"}\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;

      const payload = await fetchGoogleJson(
        accessToken,
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,webContentLink,iconLink,size",
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: multipartBody,
        }
      );

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "drive",
        action: "tool_called",
        metadata: { route: "drive.create", name, mimeType },
      });

      return json({ ok: true, file: normalizeDriveFile(payload) });
    }

    const fileId = ((body.fileId || body.id || "") as string).trim();
    if (!fileId) {
      return json({ ok: false, error: "invalid_payload", message: "fileId is required." }, 400);
    }

    if (kind === "update") {
      const name = typeof body.name === "string" ? body.name : undefined;
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "text/plain";
      const content = typeof body.content === "string" ? body.content : "";

      const boundary = `elyra-boundary-${crypto.randomUUID()}`;
      const multipartBody =
        `--${boundary}\r\n` +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        `${JSON.stringify({ name })}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;

      const payload = await fetchGoogleJson(
        accessToken,
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
          fileId
        )}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,createdTime,webViewLink,webContentLink,iconLink,size`,
        {
          method: "PATCH",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: multipartBody,
        }
      );

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "drive",
        action: "tool_called",
        metadata: { route: "drive.update", fileId },
      });

      return json({ ok: true, file: normalizeDriveFile(payload) });
    }

    await fetchGoogleJson(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: "PATCH", body: JSON.stringify({ trashed: true }) }
    );

    await trackToolUsage(env, {
      workspaceId: targetWorkspaceId,
      userId: resolved.user.id,
      domain: "drive",
      action: "tool_called",
      metadata: { route: "drive.delete", fileId },
    });

    return json({ ok: true, deletedId: fileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive request failed";
    return json({ ok: false, error: "drive_error", message }, 502);
  }
}

async function handleDocsStatus(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  return handleDriveStatus(req, env, workspaceId);
}

async function handleDocsList(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const driveReq = new Request(
    `${new URL(req.url).origin}${new URL(req.url).pathname}?${new URLSearchParams({
      ...(Object.fromEntries(new URL(req.url).searchParams.entries())),
      mimeType: "application/vnd.google-apps.document",
    }).toString()}`,
    req
  );
  const driveRes = await handleDriveFilesList(driveReq, env, workspaceId);
  const payload = await driveRes.clone().json().catch(() => null);
  if (!payload || !payload.ok) return driveRes;
  return json({
    ok: true,
    connected: payload.connected,
    docs: payload.files || [],
    nextPageToken: payload.nextPageToken || null,
  });
}

async function handleDocDetail(
  req: Request,
  env: Env,
  workspaceId: string,
  docId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;
  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", doc: null });
  }

  try {
    const payload = await fetchGoogleJson(
      accessToken,
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`
    );

    await trackToolUsage(env, {
      workspaceId,
      userId: gate.resolved.user.id,
      domain: "docs",
      action: "tool_called",
      metadata: { route: "docs.get", docId },
    });

    return json({ ok: true, doc: payload });
  } catch (error) {
    const status = (error as any)?.status;
    const message = error instanceof Error ? error.message : "Unable to load document";
    if (status === 404) return json({ ok: false, error: "doc_not_found", message }, 404);
    return json({ ok: false, error: "docs_error", message }, 502);
  }
}

async function handleDocsMutate(
  req: Request,
  env: Env,
  kind: "create" | "update" | "delete",
  workspaceId?: string
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  let targetWorkspaceId = workspaceId || "";
  if (targetWorkspaceId) {
    const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, targetWorkspaceId);
    if (!membership) return json({ ok: false, error: "workspace_not_accessible" }, 403);
  } else {
    const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
    if (!activeWs) return json({ ok: false, error: "workspace_not_accessible" }, 403);
    targetWorkspaceId = activeWs.id;
  }

  const userKey = resolveUserKey(resolved);
  const accessToken = await getGoogleAccessToken(env, userKey, targetWorkspaceId);
  if (!accessToken) {
    return json({ ok: false, error: "docs_not_connected", code: "NOT_CONNECTED" }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  try {
    if (kind === "create") {
      const title = ((body.title || body.name || "Untitled doc") as string).trim() || "Untitled doc";
      const payload = await fetchGoogleJson(accessToken, "https://docs.googleapis.com/v1/documents", {
        method: "POST",
        body: JSON.stringify({ title }),
      });

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "docs",
        action: "tool_called",
        metadata: { route: "docs.create", title },
      });

      return json({ ok: true, doc: payload });
    }

    const docId = ((body.docId || body.id || "") as string).trim();
    if (!docId) return json({ ok: false, error: "invalid_payload", message: "docId is required." }, 400);

    if (kind === "update") {
      let requests = Array.isArray(body.requests) ? body.requests : null;
      if (!requests) {
        const findText = (body.findText || "").toString();
        const replaceText = (body.replaceText || "").toString();
        if (findText) {
          requests = [
            {
              replaceAllText: {
                containsText: { text: findText, matchCase: true },
                replaceText,
              },
            },
          ];
        }
      }
      if (!requests || requests.length === 0) {
        return json(
          { ok: false, error: "invalid_payload", message: "requests or findText is required for update." },
          400
        );
      }

      const payload = await fetchGoogleJson(
        accessToken,
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({ requests }),
        }
      );

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "docs",
        action: "tool_called",
        metadata: { route: "docs.update", docId, requests: requests.length },
      });

      return json({ ok: true, result: payload });
    }

    await fetchGoogleJson(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}`,
      { method: "PATCH", body: JSON.stringify({ trashed: true }) }
    );

    await trackToolUsage(env, {
      workspaceId: targetWorkspaceId,
      userId: resolved.user.id,
      domain: "docs",
      action: "tool_called",
      metadata: { route: "docs.delete", docId },
    });

    return json({ ok: true, deletedId: docId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docs request failed";
    return json({ ok: false, error: "docs_error", message }, 502);
  }
}

async function handleSlidesStatus(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  return handleDriveStatus(req, env, workspaceId);
}

async function handleSlidesList(
  req: Request,
  env: Env,
  workspaceId: string
): Promise<Response> {
  const driveReq = new Request(
    `${new URL(req.url).origin}${new URL(req.url).pathname}?${new URLSearchParams({
      ...(Object.fromEntries(new URL(req.url).searchParams.entries())),
      mimeType: "application/vnd.google-apps.presentation",
    }).toString()}`,
    req
  );
  const driveRes = await handleDriveFilesList(driveReq, env, workspaceId);
  const payload = await driveRes.clone().json().catch(() => null);
  if (!payload || !payload.ok) return driveRes;

  const items = payload.files || [];
  return json({
    ok: true,
    connected: payload.connected,
    presentations: items,
    decks: items,
    nextPageToken: payload.nextPageToken || null,
  });
}

async function handleSlideDetail(
  req: Request,
  env: Env,
  workspaceId: string,
  presentationId: string
): Promise<Response> {
  const gate = await requireWorkspaceAccess(req, env, workspaceId);
  if (gate instanceof Response) return gate;
  const accessToken = await getGoogleAccessToken(env, gate.userKey, workspaceId);
  if (!accessToken) {
    return json({ ok: true, connected: false, code: "NOT_CONNECTED", presentation: null });
  }

  try {
    const payload = await fetchGoogleJson(
      accessToken,
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`
    );

    await trackToolUsage(env, {
      workspaceId,
      userId: gate.resolved.user.id,
      domain: "slides",
      action: "tool_called",
      metadata: { route: "slides.get", presentationId },
    });

    return json({ ok: true, presentation: payload, deck: payload });
  } catch (error) {
    const status = (error as any)?.status;
    const message = error instanceof Error ? error.message : "Unable to load presentation";
    if (status === 404) return json({ ok: false, error: "presentation_not_found", message }, 404);
    return json({ ok: false, error: "slides_error", message }, 502);
  }
}

async function handleSlidesMutate(
  req: Request,
  env: Env,
  kind: "create" | "update" | "delete",
  workspaceId?: string
): Promise<Response> {
  const resolved = await resolveSession(req, env);
  if (!resolved) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  let targetWorkspaceId = workspaceId || "";
  if (targetWorkspaceId) {
    const membership = await getUserMembership(env.ASSISTANT_DB, resolved.user.id, targetWorkspaceId);
    if (!membership) return json({ ok: false, error: "workspace_not_accessible" }, 403);
  } else {
    const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
    if (!activeWs) return json({ ok: false, error: "workspace_not_accessible" }, 403);
    targetWorkspaceId = activeWs.id;
  }

  const userKey = resolveUserKey(resolved);
  const accessToken = await getGoogleAccessToken(env, userKey, targetWorkspaceId);
  if (!accessToken) {
    return json({ ok: false, error: "slides_not_connected", code: "NOT_CONNECTED" }, 409);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  try {
    if (kind === "create") {
      const title = ((body.title || body.name || "Untitled deck") as string).trim() || "Untitled deck";
      const payload = await fetchGoogleJson(accessToken, "https://slides.googleapis.com/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title }),
      });

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "slides",
        action: "tool_called",
        metadata: { route: "slides.create", title },
      });

      return json({ ok: true, presentation: payload, deck: payload });
    }

    const presentationId = ((body.presentationId || body.id || body.deckId || "") as string).trim();
    if (!presentationId) {
      return json(
        { ok: false, error: "invalid_payload", message: "presentationId (or id/deckId) is required." },
        400
      );
    }

    if (kind === "update") {
      let requests = Array.isArray(body.requests) ? body.requests : null;
      if (!requests) {
        const replacements = Array.isArray(body.replacements) ? body.replacements : [];
        if (replacements.length > 0) {
          requests = replacements
            .map((entry: any) => {
              const containsText = (entry?.containsText || "").toString();
              const replaceText = (entry?.replaceText || "").toString();
              if (!containsText) return null;
              return {
                replaceAllText: {
                  containsText: { text: containsText, matchCase: true },
                  replaceText,
                },
              };
            })
            .filter(Boolean);
        }
      }
      if (!requests || requests.length === 0) {
        return json(
          { ok: false, error: "invalid_payload", message: "requests or replacements is required for update." },
          400
        );
      }

      const payload = await fetchGoogleJson(
        accessToken,
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({ requests }),
        }
      );

      await trackToolUsage(env, {
        workspaceId: targetWorkspaceId,
        userId: resolved.user.id,
        domain: "slides",
        action: "tool_called",
        metadata: { route: "slides.update", presentationId, requests: requests.length },
      });

      return json({ ok: true, result: payload });
    }

    await fetchGoogleJson(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(presentationId)}`,
      { method: "PATCH", body: JSON.stringify({ trashed: true }) }
    );

    await trackToolUsage(env, {
      workspaceId: targetWorkspaceId,
      userId: resolved.user.id,
      domain: "slides",
      action: "tool_called",
      metadata: { route: "slides.delete", presentationId },
    });

    return json({ ok: true, deletedId: presentationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slides request failed";
    return json({ ok: false, error: "slides_error", message }, 502);
  }
}

async function handleEmailSummarize(req: Request): Promise<Response> {
  let body: { email?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const email = body.email || {};
  const subject = (email.subject || "No subject").toString();
  const from = (email.from || "Unknown sender").toString();
  const snippet = (email.snippet || email.text || "").toString();
  const summary = [`From: ${from}`, `Subject: ${subject}`, snippet ? `Summary: ${snippet.slice(0, 280)}` : "Summary: (no content)"].join("\n");
  return json({ ok: true, summary });
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Preflight — must respond before any other logic
    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }), env);
    }

    try {
      const url = new URL(request.url);

      // Root / health
      if (url.pathname === "/" || url.pathname === "/health") {
        return withCors(
          request,
          json({ ok: true, service: "elyra-api", ts: new Date().toISOString() }),
          env,
        );
      }

      // Auth routes
      if (url.pathname === "/assistant/auth/exchange-supabase" && request.method === "POST") {
        return withCors(request, await handleExchange(request, env), env);
      }

      if (url.pathname === "/assistant/auth/whoami") {
        return withCors(request, await handleWhoami(request, env), env);
      }

      if (url.pathname === "/assistant/auth/logout" && request.method === "POST") {
        return withCors(request, await handleLogout(request, env), env);
      }

      // Onboarding
      if (url.pathname === "/assistant/onboarding/complete" && request.method === "POST") {
        return withCors(request, await handleOnboardingComplete(request, env), env);
      }

      // -----------------------------------------------------------------
      // Active workspace
      // -----------------------------------------------------------------

      if (url.pathname === "/assistant/workspaces/create" && request.method === "POST") {
        return withCors(request, await handleCreateWorkspace(request, env), env);
      }

      if (url.pathname === "/assistant/workspaces/active" && request.method === "POST") {
        return withCors(request, await handleSetActiveWorkspace(request, env), env);
      }

      if (url.pathname === "/assistant/workspaces/active" && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }

        const workspace = await resolveActiveWorkspaceForSession(
          env.ASSISTANT_DB,
          resolved.session,
          resolved.user,
          env
        );

        return withCors(
          request,
          json({ ok: true, workspace: workspace ? buildWhoamiWorkspace(workspace) : null }),
          env,
        );
      }

      if (url.pathname.startsWith("/v1/")) {
        // Proxy logic for routes handled by AI Service but not Worker
        const AI_SERVICE_PREFIXES = [
          "/v1/intents",
          "/v1/artifacts",
          "/v1/google/status",
          "/v1/chat",
          "/v1/runs",
        ];
        if (AI_SERVICE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
          const proxiedRes = await forwardToAIService(request, env);
          // If the proxied response already has CORS headers, we might not want to wrap it.
          // However, to ensure consistency with the app origin, we apply withCors.
          return withCors(request, proxiedRes, env);
        }

        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated" }, 401), env);
        }

        const windowLayoutResponse = await handleWindowLayoutRoute(request, env, resolved);
        if (windowLayoutResponse) {
          return withCors(request, windowLayoutResponse, env);
        }

        const v1Response = await handleV1Request(request, env, resolved);
        if (v1Response) {
          return withCors(request, v1Response, env);
        }
      }

      // -----------------------------------------------------------------
      // Google OAuth (Vision 2035 local/dev)
      // -----------------------------------------------------------------
      const isGetLike = request.method === "GET" || request.method === "HEAD";

      if (url.pathname === "/assistant/oauth/google/start" && isGetLike) {
        return withCors(request, await googleOAuthStart(request, env), env);
      }

      if (url.pathname === "/assistant/oauth/google/callback" && isGetLike) {
        return withCors(request, await googleOAuthCallback(request, env), env);
      }

      // -----------------------------------------------------------------
      // Core assistant utility routes
      // -----------------------------------------------------------------
      if (url.pathname === "/assistant/email/summarize" && request.method === "POST") {
        return withCors(request, await handleEmailSummarize(request), env);
      }

      if (url.pathname === "/assistant/calendar/events" && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        const userKey = resolveUserKey(resolved);
        return withCors(request, await listCalendarEventsForWorkspace(request, env, activeWs.id, userKey), env);
      }

      if (
        (url.pathname === "/assistant/calendar/events/create" ||
          url.pathname === "/assistant/calendar/create-event" ||
          url.pathname === "/assistant/calendar/create") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleCalendarMutate(request, env, "create"), env);
      }

      if (
        (url.pathname === "/assistant/calendar/events/update" ||
          url.pathname === "/assistant/calendar/update-event" ||
          url.pathname === "/assistant/calendar/update") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleCalendarMutate(request, env, "update"), env);
      }

      if (
        (url.pathname === "/assistant/calendar/events/delete" ||
          url.pathname === "/assistant/calendar/delete-event" ||
          url.pathname === "/assistant/calendar/delete") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleCalendarMutate(request, env, "delete"), env);
      }

      // -----------------------------------------------------------------
      // Drive / Docs / Slides aliases (active workspace)
      // -----------------------------------------------------------------
      if ((url.pathname === "/assistant/drive/files" || url.pathname === "/assistant/drive/search") && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDriveFilesList(request, env, activeWs.id), env);
      }
      if (url.pathname === "/assistant/drive/status" && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDriveStatus(request, env, activeWs.id), env);
      }

      const driveDetailAlias = url.pathname.match(/^\/assistant\/drive\/files\/([^/]+)$/);
      if (driveDetailAlias && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDriveFileDetail(request, env, activeWs.id, decodeURIComponent(driveDetailAlias[1])), env);
      }

      if (
        (url.pathname === "/assistant/drive/files" ||
          url.pathname === "/assistant/drive/files/create" ||
          url.pathname === "/assistant/drive/create") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleDriveMutate(request, env, "create"), env);
      }
      if ((url.pathname === "/assistant/drive/files/update" || url.pathname === "/assistant/drive/update") && request.method === "POST") {
        return withCors(request, await handleDriveMutate(request, env, "update"), env);
      }
      if ((url.pathname === "/assistant/drive/files/delete" || url.pathname === "/assistant/drive/delete") && request.method === "POST") {
        return withCors(request, await handleDriveMutate(request, env, "delete"), env);
      }

      if ((url.pathname === "/assistant/docs/list" || url.pathname === "/assistant/docs/files") && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDocsList(request, env, activeWs.id), env);
      }
      if (url.pathname === "/assistant/docs/status" && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDocsStatus(request, env, activeWs.id), env);
      }

      const docDetailAlias = url.pathname.match(/^\/assistant\/docs\/([^/]+)$/);
      if (docDetailAlias && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleDocDetail(request, env, activeWs.id, decodeURIComponent(docDetailAlias[1])), env);
      }

      if ((url.pathname === "/assistant/docs/create" || url.pathname === "/assistant/docs/new") && request.method === "POST") {
        return withCors(request, await handleDocsMutate(request, env, "create"), env);
      }
      if ((url.pathname === "/assistant/docs/update" || url.pathname === "/assistant/docs/edit") && request.method === "POST") {
        return withCors(request, await handleDocsMutate(request, env, "update"), env);
      }
      if ((url.pathname === "/assistant/docs/delete" || url.pathname === "/assistant/docs/remove") && request.method === "POST") {
        return withCors(request, await handleDocsMutate(request, env, "delete"), env);
      }

      if (
        (url.pathname === "/assistant/slides/list" ||
          url.pathname === "/assistant/slides/list-decks" ||
          url.pathname === "/assistant/slides") &&
        request.method === "GET"
      ) {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleSlidesList(request, env, activeWs.id), env);
      }
      if (url.pathname === "/assistant/slides/status" && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(request, await handleSlidesStatus(request, env, activeWs.id), env);
      }

      const slideDetailAlias = url.pathname.match(/^\/assistant\/slides\/([^/]+)$/);
      if (slideDetailAlias && request.method === "GET") {
        const resolved = await resolveSession(request, env);
        if (!resolved) {
          return withCors(request, json({ ok: false, error: "AUTH_REQUIRED" }, 401), env);
        }
        const activeWs = await resolveActiveWorkspaceForSession(env.ASSISTANT_DB, resolved.session, resolved.user, env);
        if (!activeWs) {
          return withCors(request, json({ ok: false, error: "workspace_not_accessible" }, 403), env);
        }
        return withCors(
          request,
          await handleSlideDetail(request, env, activeWs.id, decodeURIComponent(slideDetailAlias[1])),
          env
        );
      }

      if (
        (url.pathname === "/assistant/slides/create" ||
          url.pathname === "/assistant/slides/create-presentation") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleSlidesMutate(request, env, "create"), env);
      }
      if (
        (url.pathname === "/assistant/slides/update" ||
          url.pathname === "/assistant/slides/update-presentation") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleSlidesMutate(request, env, "update"), env);
      }
      if (
        (url.pathname === "/assistant/slides/delete" ||
          url.pathname === "/assistant/slides/delete-presentation") &&
        request.method === "POST"
      ) {
        return withCors(request, await handleSlidesMutate(request, env, "delete"), env);
      }

      // -----------------------------------------------------------------
      // Action Confirmation routes (B3-001)
      // -----------------------------------------------------------------

      // POST /assistant/actions/propose — create a new action proposal
      if (url.pathname === "/assistant/actions/propose" && request.method === "POST") {
        return withCors(request, await handleActionPropose(request, env), env);
      }

      // POST /assistant/actions/:id/confirm — confirm a pending proposal
      // POST /assistant/actions/:id/cancel  — cancel a pending/failed proposal
      // GET  /assistant/actions/:id         — get proposal status
      const actionMatch = url.pathname.match(/^\/assistant\/actions\/([a-f0-9]+)(\/(?:confirm|cancel))?$/);
      if (actionMatch) {
        const [, actionId, suffix] = actionMatch;
        if (suffix === "/confirm" && request.method === "POST") {
          return withCors(request, await handleActionConfirm(request, env, actionId), env);
        }
        if (suffix === "/cancel" && request.method === "POST") {
          return withCors(request, await handleActionCancel(request, env, actionId), env);
        }
        if (!suffix && request.method === "GET") {
          return withCors(request, await handleActionGet(request, env, actionId), env);
        }
      }

      // -----------------------------------------------------------------
      // Workspace-scoped routes
      // /assistant/workspaces/:workspaceId/...
      // -----------------------------------------------------------------

      const wsMatch = url.pathname.match(
        /^\/assistant\/workspaces\/([a-f0-9-]+)(\/.*)?$/
      );
      if (wsMatch) {
        const [, wsId, subPath] = wsMatch;
        const sub = subPath || "";

        // --- Poker ---
        if (sub === "/poker" && request.method === "GET") {
          return withCors(request, await handleGetPoker(request, env, wsId), env);
        }
        if (sub === "/poker" && request.method === "PUT") {
          return withCors(request, await handlePutPoker(request, env, wsId), env);
        }

        // --- Mail ---
        if (sub === "/mail/status" && request.method === "GET") {
          return withCors(request, await handleMailStatus(request, env, wsId), env);
        }
        if (sub === "/mail/labels" && request.method === "GET") {
          return withCors(request, await handleMailLabels(request, env, wsId), env);
        }
        if (sub === "/mail/threads" && request.method === "GET") {
          return withCors(request, await handleMailThreads(request, env, wsId), env);
        }
        if (sub === "/mail/send" && request.method === "POST") {
          return withCors(request, await handleMailSend(request, env, wsId), env);
        }
        if (sub === "/mail/draft-reply" && request.method === "POST") {
          return withCors(request, await handleMailDraftReply(request, env, wsId), env);
        }
        const threadTrashMatch = sub.match(/^\/mail\/threads\/([^/]+)\/trash$/);
        if (threadTrashMatch && request.method === "POST") {
          return withCors(
            request,
            await handleMailThreadTrash(request, env, wsId, decodeURIComponent(threadTrashMatch[1])),
            env
          );
        }
        const threadDetailMatch = sub.match(/^\/mail\/threads\/([^/]+)$/);
        if (threadDetailMatch && request.method === "GET") {
          return withCors(
            request,
            await handleMailThreadDetail(request, env, wsId, decodeURIComponent(threadDetailMatch[1])),
            env
          );
        }
        const messageDetailMatch = sub.match(/^\/mail\/messages\/([^/]+)$/);
        if (messageDetailMatch && request.method === "GET") {
          return withCors(
            request,
            await handleMailMessageDetail(request, env, wsId, decodeURIComponent(messageDetailMatch[1])),
            env
          );
        }

        // --- Calendar ---
        if (sub === "/calendar/events" && request.method === "GET") {
          return withCors(request, await handleCalendarEvents(request, env, wsId), env);
        }

        // --- Drive ---
        if (sub === "/drive/status" && request.method === "GET") {
          return withCors(request, await handleDriveStatus(request, env, wsId), env);
        }
        if ((sub === "/drive/files" || sub === "/drive/search") && request.method === "GET") {
          return withCors(request, await handleDriveFilesList(request, env, wsId), env);
        }
        const driveFileMatch = sub.match(/^\/drive\/files\/([^/]+)$/);
        if (driveFileMatch && request.method === "GET") {
          return withCors(request, await handleDriveFileDetail(request, env, wsId, decodeURIComponent(driveFileMatch[1])), env);
        }
        if (
          (sub === "/drive/files" || sub === "/drive/files/create" || sub === "/drive/create") &&
          request.method === "POST"
        ) {
          return withCors(request, await handleDriveMutate(request, env, "create", wsId), env);
        }
        if ((sub === "/drive/files/update" || sub === "/drive/update") && request.method === "POST") {
          return withCors(request, await handleDriveMutate(request, env, "update", wsId), env);
        }
        if ((sub === "/drive/files/delete" || sub === "/drive/delete") && request.method === "POST") {
          return withCors(request, await handleDriveMutate(request, env, "delete", wsId), env);
        }

        // --- Docs ---
        if (sub === "/docs/status" && request.method === "GET") {
          return withCors(request, await handleDocsStatus(request, env, wsId), env);
        }
        if ((sub === "/docs/list" || sub === "/docs/files") && request.method === "GET") {
          return withCors(request, await handleDocsList(request, env, wsId), env);
        }
        const docMatch = sub.match(/^\/docs\/([^/]+)$/);
        if (docMatch && request.method === "GET") {
          return withCors(request, await handleDocDetail(request, env, wsId, decodeURIComponent(docMatch[1])), env);
        }
        if ((sub === "/docs/create" || sub === "/docs/new") && request.method === "POST") {
          return withCors(request, await handleDocsMutate(request, env, "create", wsId), env);
        }
        if ((sub === "/docs/update" || sub === "/docs/edit") && request.method === "POST") {
          return withCors(request, await handleDocsMutate(request, env, "update", wsId), env);
        }
        if ((sub === "/docs/delete" || sub === "/docs/remove") && request.method === "POST") {
          return withCors(request, await handleDocsMutate(request, env, "delete", wsId), env);
        }

        // --- Slides ---
        if (sub === "/slides/status" && request.method === "GET") {
          return withCors(request, await handleSlidesStatus(request, env, wsId), env);
        }
        if ((sub === "/slides/list" || sub === "/slides/list-decks" || sub === "/slides") && request.method === "GET") {
          return withCors(request, await handleSlidesList(request, env, wsId), env);
        }
        const slideMatch = sub.match(/^\/slides\/([^/]+)$/);
        if (slideMatch && request.method === "GET") {
          return withCors(
            request,
            await handleSlideDetail(request, env, wsId, decodeURIComponent(slideMatch[1])),
            env
          );
        }
        if (
          (sub === "/slides/create" || sub === "/slides/create-presentation") &&
          request.method === "POST"
        ) {
          return withCors(request, await handleSlidesMutate(request, env, "create", wsId), env);
        }
        if (
          (sub === "/slides/update" || sub === "/slides/update-presentation") &&
          request.method === "POST"
        ) {
          return withCors(request, await handleSlidesMutate(request, env, "update", wsId), env);
        }
        if (
          (sub === "/slides/delete" || sub === "/slides/delete-presentation") &&
          request.method === "POST"
        ) {
          return withCors(request, await handleSlidesMutate(request, env, "delete", wsId), env);
        }

        // Workspace sub-route not found
        return withCors(request, json({ ok: false, message: "Not Found" }, 404), env);
      }

      // 404 — still gets CORS headers
      return withCors(request, json({ ok: false, message: "Not Found" }, 404), env);

    } catch (err) {
      // Unhandled exception — 500 with CORS headers so browser can read the error
      const message = err instanceof Error ? err.message : "Internal Server Error";
      console.error("[elyra-api] unhandled error:", message, err);
      return withCors(
        request,
        json({ ok: false, message: "Internal Server Error", detail: message }, 500),
        env,
      );
    }
  },
};
