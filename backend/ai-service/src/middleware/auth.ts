import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { AuthError, ForbiddenError } from "../lib/errors.js";
import { extractBearerToken, verifySupabaseJwt } from "../lib/supabase-jwt.js";

export type AuthenticatedRequest = FastifyRequest & {
  userId: string;
  userEmail: string | null;
  workspaceId: string;
  accessToken: string;
};

const PUBLIC_ROUTE_PREFIXES = new Set([
  "/health",
  "/v1/google/connect",
  "/v1/google/callback",
]);
const WORKSPACE_WITH_INDEX_SUFFIX = /^(ws-[a-z0-9-]+):\d+$/i;

function normalizeWorkspaceId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withSuffix = trimmed.match(WORKSPACE_WITH_INDEX_SUFFIX);
  if (withSuffix?.[1]) return withSuffix[1];
  return trimmed;
}

function parseWorkspaceId(request: FastifyRequest): string {
  const wsHeader = request.headers["x-workspace-id"];
  if (typeof wsHeader === "string" && wsHeader.trim()) {
    return normalizeWorkspaceId(wsHeader);
  }

  const query = request.query as Record<string, unknown> | undefined;
  const wsQuery = query?.["workspaceId"];
  if (typeof wsQuery === "string" && wsQuery.trim()) {
    return normalizeWorkspaceId(wsQuery);
  }
  const wsQuerySnake = query?.["workspace_id"];
  if (typeof wsQuerySnake === "string" && wsQuerySnake.trim()) {
    return normalizeWorkspaceId(wsQuerySnake);
  }

  return "";
}

function parseAccessToken(request: FastifyRequest): string | null {
  const headerToken = extractBearerToken(request.headers.authorization);
  if (headerToken) {
    return headerToken;
  }

  const query = request.query as Record<string, unknown> | undefined;
  const queryToken = query?.["access_token"];
  if (typeof queryToken === "string" && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}

type WorkerWorkspace = { id?: string; slug?: string; type?: string };
const ACCESS_CACHE_MS = 60_000;
const accessCache = new Map<string, { expires: number; allowed: Set<string> }>();

/**
 * Workspaces this token's user is a member of, as reported by the worker (source of truth
 * for memberships). Includes the built-in aliases the frontend uses for those workspaces.
 */
async function loadAllowedWorkspaces(token: string): Promise<Set<string>> {
  const cached = accessCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.allowed;
  const base = config().WORKER_URL.replace(/\/$/, "");
  const response = await fetch(`${base}/assistant/auth/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new AuthError("Workspace membership could not be verified");
  const payload = (await response.json().catch(() => null)) as { workspaces?: WorkerWorkspace[] } | null;
  const allowed = new Set<string>();
  for (const ws of payload?.workspaces ?? []) {
    if (ws.id) allowed.add(ws.id);
    if (ws.slug) {
      allowed.add(ws.slug);
      allowed.add(`ws-${ws.slug.replace(/^ws-/, "")}`);
    }
    if ((ws.type ?? "").toLowerCase() === "personal") allowed.add("ws-personal");
  }
  accessCache.set(token, { expires: Date.now() + ACCESS_CACHE_MS, allowed });
  if (accessCache.size > 500) {
    for (const [key, entry] of accessCache) if (entry.expires <= Date.now()) accessCache.delete(key);
  }
  return allowed;
}

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("userId", "");
  app.decorateRequest("userEmail", null);
  app.decorateRequest("workspaceId", "");
  app.decorateRequest("accessToken", "");

  app.addHook("onRequest", async (request, _reply) => {
    const requestPath = request.url.split("?")[0] ?? request.url;
    if (PUBLIC_ROUTE_PREFIXES.has(requestPath)) return;

    const token = parseAccessToken(request);
    if (!token) {
      throw new AuthError("Missing or invalid Authorization header");
    }

    const env = config();
    const claims = await verifySupabaseJwt(
      token,
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const authRequest = request as AuthenticatedRequest;
    authRequest.userId = claims.sub;
    authRequest.userEmail = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
    authRequest.workspaceId = parseWorkspaceId(request);
    authRequest.accessToken = token;

    // A workspace id from the client is only accepted if the user is a member of it.
    if (authRequest.workspaceId) {
      const allowed = await loadAllowedWorkspaces(token);
      if (!allowed.has(authRequest.workspaceId)) {
        throw new ForbiddenError("No access to this workspace");
      }
    }
  });
}
