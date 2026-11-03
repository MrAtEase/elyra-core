import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { saveGitHubToken } from "@/lib/github/tokenStore";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

type GitHubTokenRequest = {
  workspaceId: string;
  accessToken: string;
};

export const runtime = "nodejs";

function parseScopes(headerValue: string | null): string[] {
  if (!headerValue) return [];
  return headerValue
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as GitHubTokenRequest | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const workspaceId = normalizeWorkspaceId(body.workspaceId) ?? body.workspaceId;
  const accessToken = body.accessToken?.trim() ?? "";
  if (!workspaceId || !accessToken) {
    return NextResponse.json(
      { error: "workspace_and_token_required", message: "workspaceId and GitHub access token are required." },
      { status: 400 },
    );
  }

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }

  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }

  const githubResponse = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Elyra-Core",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  const profile = (await githubResponse.json().catch(() => null)) as
    | { login?: string; message?: string }
    | null;

  if (!githubResponse.ok || !profile?.login) {
    return NextResponse.json(
      {
        error: "github_auth_failed",
        message:
          profile?.message ||
          `GitHub rejected the token (${githubResponse.status}). Use a valid token with repo read access.`,
      },
      { status: githubResponse.status >= 400 ? githubResponse.status : 401 },
    );
  }

  const scopes = parseScopes(githubResponse.headers.get("x-oauth-scopes"));
  await saveGitHubToken({
    workspaceId,
    userId,
    accessToken,
    scopes,
  });

  return NextResponse.json({
    ok: true,
    login: profile.login,
    scopes,
  });
}
