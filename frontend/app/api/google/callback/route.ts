import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { getGoogleServerEnvSafe } from "@/lib/google/env";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/google/oauthState";
import { parseScopeString } from "@/lib/google/scopes";
import { saveGoogleTokens } from "@/lib/google/tokenStore";
import { safeNext } from "@/lib/safeNext";

export const runtime = "nodejs";

function isLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const TokenExchangeSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  });
  return response;
}

function appendStatusParam(path: string, key: string, value: string): string {
  try {
    const url = new URL(path, "http://localhost");
    url.searchParams.set(key, value);
    return `${url.pathname}${url.search}`;
  } catch {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function mapOAuthErrorMessage(error: string, description: string | null): string {
  const normalized = error.trim().toLowerCase();
  if (normalized === "access_denied") {
    return (
      "Google OAuth blocked access. Add this account as a Test User in the Google OAuth consent screen " +
      "or publish the app before retrying."
    );
  }
  if (description && description.trim().length > 0) {
    return description.trim();
  }
  return error;
}

function mapStateErrorMessage(reason: string): string {
  const normalized = reason.trim().toLowerCase();
  if (
    normalized.includes("expired") ||
    normalized.includes("missing oauth state") ||
    normalized.includes("state value mismatch")
  ) {
    return "Google OAuth state expired. Please click Connect Google again.";
  }
  if (normalized.includes("signature mismatch")) {
    return "Google OAuth state mismatch. Please retry from the current workspace.";
  }
  return reason;
}

function redirectToPath(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
  originOverride?: string | null
): NextResponse {
  let nextPath = safeNext(path, "/os");
  for (const [key, value] of Object.entries(params)) {
    nextPath = appendStatusParam(nextPath, key, value);
  }
  let baseOrigin = request.nextUrl.origin;
  if (typeof originOverride === "string" && originOverride.trim().length > 0) {
    try {
      baseOrigin = new URL(originOverride).origin;
    } catch {
      baseOrigin = request.nextUrl.origin;
    }
  }
  return NextResponse.redirect(new URL(nextPath, baseOrigin));
}

async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<z.infer<typeof TokenExchangeSchema>> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const message =
      (typeof payload?.error_description === "string" &&
        payload.error_description) ||
      (typeof payload?.error === "string" && payload.error) ||
      `Google token exchange failed (${response.status})`;
    throw new Error(message);
  }

  const parsed = TokenExchangeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Google token exchange returned invalid payload.");
  }
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const envStatus = getGoogleServerEnvSafe();
  if (!envStatus.ok) {
    return redirectToPath(request, "/os", {
      google_error: envStatus.error.issues.join(" | "),
    });
  }

  const stateParam = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorDescription =
    request.nextUrl.searchParams.get("error_description");

  const stateVerification = verifyOAuthState({
    stateParam,
    cookieValue: request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? null,
    key: envStatus.env.TOKEN_ENCRYPTION_KEY_BYTES,
  });

  const fallbackPath = "/os";
  const verifiedPath =
    stateVerification.ok && stateVerification.payload.next
      ? stateVerification.payload.next
      : fallbackPath;
  const verifiedOriginFromState =
    stateVerification.ok && stateVerification.payload.returnOrigin
      ? stateVerification.payload.returnOrigin
      : null;
  // Guard against local-dev OAuth loops: when callback hits localhost, always finish on localhost.
  const verifiedOrigin = isLocalOrigin(request.nextUrl.origin)
    ? request.nextUrl.origin
    : verifiedOriginFromState;

  if (oauthError) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        google_error: mapOAuthErrorMessage(oauthError, oauthErrorDescription),
      }, verifiedOrigin)
    );
  }

  if (!stateVerification.ok) {
    return clearStateCookie(
      redirectToPath(request, fallbackPath, {
        google_error: mapStateErrorMessage(stateVerification.reason),
      })
    );
  }

  if (!code) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        google_error: "Missing OAuth code.",
      }, verifiedOrigin)
    );
  }

  const auth = await getGoogleAuthContext(
    request,
    stateVerification.payload.workspaceId,
    stateVerification.payload.accessToken
      ? { accessToken: stateVerification.payload.accessToken }
      : undefined
  );
  if (!auth.ok) {
    return clearStateCookie(
      NextResponse.redirect(
        new URL(
          auth.loginUrl ||
            `/signin?reason=worker_auth_required&next=${encodeURIComponent(
              verifiedPath
            )}`,
          request.nextUrl.origin
        )
      )
    );
  }

  if (auth.context.userId !== stateVerification.payload.userId) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        google_error: "Session mismatch. Please retry Google connect.",
      }, verifiedOrigin)
    );
  }

  try {
    const tokenPayload = await exchangeAuthorizationCode({
      code,
      redirectUri: stateVerification.payload.redirectUri,
      clientId: envStatus.env.GOOGLE_CLIENT_ID,
      clientSecret: envStatus.env.GOOGLE_CLIENT_SECRET,
    });

    const scopes = parseScopeString(tokenPayload.scope);
    await saveGoogleTokens({
      workspaceId: stateVerification.payload.workspaceId,
      userId: auth.context.userId,
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token ?? null,
      scopes,
      expiresAtMs: Date.now() + tokenPayload.expires_in * 1000,
    });

    return clearStateCookie(redirectToPath(request, verifiedPath, {}, verifiedOrigin));
  } catch (error) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        google_error:
          error instanceof Error
            ? error.message
            : "Unable to complete Google OAuth callback.",
      }, verifiedOrigin)
    );
  }
}
