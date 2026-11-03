import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { getTokens, saveTokens } from "../db/repos/token-vault.js";
import { AuthError, ValidationError } from "../lib/errors.js";
import {
  buildGoogleOAuthUrl,
  decodeOAuthState,
} from "../tools/google-auth.js";
import { extractBearerToken, verifySupabaseJwt } from "../lib/supabase-jwt.js";

type GoogleTokenExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

function decodeGoogleIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function googleOAuthRoutes(app: FastifyInstance) {
  // Redirect to Google OAuth consent
  app.get("/v1/google/connect", async (request, reply) => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = config();
    const query = request.query as { workspaceId?: string; token?: string };
    const requestedWorkspaceId = query.workspaceId?.trim();
    if (!requestedWorkspaceId) {
      throw new ValidationError("workspaceId is required");
    }

    // Browser redirects cannot set Authorization headers; support token query as fallback.
    const token =
      extractBearerToken(request.headers.authorization) ?? query.token?.trim() ?? "";
    if (!token) {
      throw new AuthError("Missing authorization token");
    }

    const claims = await verifySupabaseJwt(
      token,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    );
    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      claims.sub,
      requestedWorkspaceId,
    );
    if (!authorizedWorkspaceId) {
      throw new AuthError("No access to requested workspace");
    }

    const url = buildGoogleOAuthUrl(authorizedWorkspaceId);
    reply.redirect(url);
  });

  // OAuth callback
  app.get("/v1/google/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    if (!code || !state) throw new ValidationError("Missing code or state");

    const parsedState = decodeOAuthState(state);
    if (!parsedState) {
      throw new ValidationError("Invalid OAuth state");
    }
    const workspaceId = parsedState.workspaceId;

    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, FRONTEND_URL } = config();

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new ValidationError(`Google token exchange failed: ${err}`);
    }

    const tokens = (await tokenRes.json()) as GoogleTokenExchangeResponse;
    const existing = await getTokens(workspaceId);
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
    if (!refreshToken) {
      throw new ValidationError("Google did not return a refresh token");
    }

    await saveTokens({
      workspaceId,
      provider: "google",
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? existing?.scopes ?? "",
      accountEmail: decodeGoogleIdTokenEmail(tokens.id_token) ?? existing?.accountEmail ?? null,
    });

    // Redirect back to frontend
    const redirectUrl = new URL("/os", FRONTEND_URL);
    redirectUrl.searchParams.set("connected", "google");
    redirectUrl.searchParams.set("workspaceId", workspaceId);
    reply.redirect(redirectUrl.toString());
  });
}
