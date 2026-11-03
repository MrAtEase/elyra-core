/**
 * GET /api/os/code/github/files
 *
 * Returns the file tree for a GitHub repository using the stored workspace
 * GitHub token (connected via the GitHub OAuth integration).
 *
 * Query params:
 *   repo        — e.g. "github.com/user/repo" or "user/repo"
 *   branch      — branch/ref to list (default: "main")
 *   workspaceId — required, used to load the workspace GitHub token
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";

// ── URL parser ───────────────────────────────────────────────────────────────

function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/i, "") };
}

// ── Ignore list ──────────────────────────────────────────────────────────────

const IGNORED_PREFIXES = [
  "node_modules/",
  ".next/",
  ".git/",
  "dist/",
  "build/",
  ".cache/",
  "coverage/",
  ".vercel/",
  "__pycache__/",
  ".venv/",
  "venv/",
  ".yarn/",
  ".pnp/",
];

function shouldIgnore(filePath: string): boolean {
  return IGNORED_PREFIXES.some(
    (prefix) => filePath.startsWith(prefix) || filePath.includes(`/${prefix}`),
  );
}

// ── GitHub API types ─────────────────────────────────────────────────────────

type GitHubTreeItem = {
  path?: string;
  type?: string;
  size?: number;
  sha?: string;
};

type GitHubTreeResponse = {
  tree: GitHubTreeItem[];
  truncated?: boolean;
};

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = (searchParams.get("repo") ?? "").trim();
  const branch = (searchParams.get("branch") ?? "main").trim() || "main";
  const workspaceId = (searchParams.get("workspaceId") ?? "").trim();

  if (!repo || !workspaceId) {
    return NextResponse.json(
      { ok: false, error: "repo and workspaceId are required." },
      { status: 400 },
    );
  }

  // Auth check
  const whoamiResult = await fetchWhoamiPayload(request).catch(() => null);
  if (!whoamiResult?.response.ok || !whoamiResult.payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(whoamiResult.payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "No access to this workspace." }, { status: 403 });
  }

  const parsed = parseRepoInput(repo);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "Invalid repo format. Use 'github.com/owner/repo' or 'owner/repo'." },
      { status: 400 },
    );
  }

  // Load GitHub token
  const tokenInfo = await loadStoredGitHubToken(workspaceId).catch(() => null);
  if (!tokenInfo?.accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "GitHub not connected for this workspace. Connect GitHub in Settings → Connections.",
        code: "GITHUB_NOT_CONNECTED",
      },
      { status: 409 },
    );
  }

  // Fetch GitHub repo default branch (to return it to UI)
  let defaultBranch = branch;
  try {
    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      {
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (repoRes.ok) {
      const repoData = (await repoRes.json()) as { default_branch?: string };
      defaultBranch = repoData.default_branch ?? branch;
    }
  } catch {
    // Not critical — continue with provided branch
  }

  // Fetch file tree (recursive)
  const treeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${tokenInfo.accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!treeRes.ok) {
    const errPayload = (await treeRes.json().catch(() => null)) as { message?: string } | null;
    return NextResponse.json(
      {
        ok: false,
        error:
          errPayload?.message ??
          `GitHub API error ${treeRes.status}. Check that the repo exists and you have access.`,
      },
      { status: treeRes.status === 404 ? 404 : 502 },
    );
  }

  const treePayload = (await treeRes.json()) as GitHubTreeResponse;

  const files = (treePayload.tree ?? [])
    .filter(
      (item): item is GitHubTreeItem & { path: string } =>
        item.type === "blob" && typeof item.path === "string" && !shouldIgnore(item.path),
    )
    .map((item) => item.path)
    .sort();

  return NextResponse.json({
    ok: true,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    defaultBranch,
    files,
    truncated: treePayload.truncated ?? false,
    total: files.length,
  });
}
