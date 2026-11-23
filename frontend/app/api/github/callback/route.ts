import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
} from "@/lib/api/whoamiClient";
import { saveGitHubToken } from "@/lib/github/tokenStore";
import { safeNext } from "@/lib/safeNext";
import {
  GITHUB_OAUTH_STATE_COOKIE,
  getGitHubOAuthEnv,
  verifyGitHubOAuthState,
} from "@/lib/github/oauth";

export const runtime = "nodejs";

type GitHubTokenResponse = {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: GITHUB_OAUTH_STATE_COOKIE,
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

function redirectToPath(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
): NextResponse {
  let nextPath = safeNext(path, "/os");
  for (const [key, value] of Object.entries(params)) {
    nextPath = appendStatusParam(nextPath, key, value);
  }
  return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin));
}

function parseScopes(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GitHubTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as GitHubTokenResponse | null;
  if (!response.ok || !payload) {
    throw new Error(`GitHub token exchange failed (${response.status}).`);
  }
  if (!payload.access_token) {
    throw new Error(payload.error_description || payload.error || "GitHub did not return an access token.");
  }
  return payload;
}

export async function GET(request: NextRequest) {
  let env;
  try {
    env = getGitHubOAuthEnv(request.nextUrl.origin);
  } catch (error) {
    return redirectToPath(request, "/os/github/connect", {
      github_error: error instanceof Error ? error.message : "GitHub OAuth is not configured.",
    });
  }

  const stateParam = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorDescription = request.nextUrl.searchParams.get("error_description");

  const verification = verifyGitHubOAuthState({
    stateParam,
    cookieValue: request.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value ?? null,
    key: env.stateKey,
  });

  const fallbackPath = "/os/code";
  const verifiedPath = verification.ok ? verification.payload.next : fallbackPath;

  if (oauthError) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        github_error: oauthErrorDescription || oauthError,
      }),
    );
  }

  if (!verification.ok) {
    return clearStateCookie(
      redirectToPath(request, fallbackPath, {
        github_error: verification.reason,
      }),
    );
  }

  if (!code) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        github_error: "Missing GitHub OAuth code.",
      }),
    );
  }

  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return clearStateCookie(
      NextResponse.redirect(
        new URL(`/signin?reason=worker_auth_required&next=${encodeURIComponent(verifiedPath)}`, request.nextUrl.origin),
      ),
    );
  }

  const userId = getWhoamiUserId(payload);
  if (!userId || userId !== verification.payload.userId) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        github_error: "Session mismatch. Please retry GitHub connect.",
      }),
    );
  }

  try {
    const tokenPayload = await exchangeAuthorizationCode({
      code,
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      redirectUri: verification.payload.redirectUri,
    });

    await saveGitHubToken({
      workspaceId: verification.payload.workspaceId,
      userId,
      accessToken: tokenPayload.access_token!,
      scopes: parseScopes(tokenPayload.scope),
    });

    return clearStateCookie(redirectToPath(request, verifiedPath, {}));
  } catch (error) {
    return clearStateCookie(
      redirectToPath(request, verifiedPath, {
        github_error: error instanceof Error ? error.message : "Unable to complete GitHub OAuth callback.",
      }),
    );
  }
}
