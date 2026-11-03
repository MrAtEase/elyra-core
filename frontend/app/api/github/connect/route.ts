import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import { safeNext } from "@/lib/safeNext";
import {
  createGitHubOAuthState,
  GITHUB_OAUTH_STATE_COOKIE,
  getGitHubOAuthEnv,
} from "@/lib/github/oauth";

export const runtime = "nodejs";

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

function redirectWithError(request: NextRequest, nextPath: string, message: string): NextResponse {
  const target = new URL(appendStatusParam(nextPath, "github_error", message), request.nextUrl.origin);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const nextPath = safeNext(request.nextUrl.searchParams.get("next"), "/os/code");
  const workspaceId = normalizeWorkspaceId(request.nextUrl.searchParams.get("workspaceId")) ?? "";
  if (!workspaceId) {
    return redirectWithError(request, "/os/github/connect", "Missing workspaceId for GitHub OAuth.");
  }

  let env;
  try {
    env = getGitHubOAuthEnv(request.nextUrl.origin);
  } catch (error) {
    return redirectWithError(request, `/os/github/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(nextPath)}`, error instanceof Error ? error.message : "GitHub OAuth is not configured.");
  }

  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.redirect(new URL(`/signin?reason=worker_auth_required&next=${encodeURIComponent(nextPath)}`, request.nextUrl.origin));
  }

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return redirectWithError(request, `/os/github/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(nextPath)}`, "You do not have access to this workspace.");
  }

  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return redirectWithError(request, `/os/github/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(nextPath)}`, "Authenticated user id is missing.");
  }

  const oauthState = createGitHubOAuthState({
    workspaceId,
    userId,
    next: nextPath,
    redirectUri: env.redirectUri,
    key: env.stateKey,
  });

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", env.clientId);
  githubUrl.searchParams.set("redirect_uri", env.redirectUri);
  githubUrl.searchParams.set("scope", "repo read:user");
  githubUrl.searchParams.set("state", oauthState.state);

  const responseRedirect = NextResponse.redirect(githubUrl);
  responseRedirect.cookies.set({
    name: GITHUB_OAUTH_STATE_COOKIE,
    value: oauthState.cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: oauthState.maxAgeSeconds,
  });
  return responseRedirect;
}
