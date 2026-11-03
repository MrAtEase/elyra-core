import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { AuthError } from "../lib/errors.js";
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
  });
}
