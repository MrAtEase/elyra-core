import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";

type PromoteRequest = {
  repoUrl?: string;
  workspaceId?: string;
  baseBranch?: string;
  branchName?: string;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
  files?: string[];
  createPullRequest?: boolean;
};

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout ?? "").trim(),
          stderr: String(stderr ?? "").trim(),
        });
      },
    );
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    const dotGit = path.join(current, ".git");
    if (await pathExists(dotGit)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "update";
}

function remoteToHttps(remote: string): string | null {
  const cleaned = remote.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("https://github.com/")) {
    return cleaned.replace(/\.git$/, "");
  }
  const ssh = cleaned.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
  if (ssh?.[1]) return `https://github.com/${ssh[1]}`;
  return null;
}

function parseGitHubOwnerRepo(remote: string): { owner: string; repo: string } | null {
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch?.[1] && httpsMatch?.[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = remote.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1] && sshMatch?.[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PromoteRequest;
  const requestedRepo = (body.repoUrl ?? "").trim();
  const workspaceId = (body.workspaceId ?? "").trim();
  const baseBranch = (body.baseBranch ?? "main").trim() || "main";
  const now = new Date();
  // Include HHmmss to prevent branch collisions on the same day
  const datePart = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const branchName = (body.branchName ?? `codex/promote-${datePart}-${timePart}-${slugify(body.commitMessage || body.prTitle || "changes")}`).trim();
  const commitMessage = (body.commitMessage ?? "chore: promote dev changes").trim();
  const prTitle = (body.prTitle ?? commitMessage).trim();
  const prBody = (body.prBody ?? "").trim();
  const files = Array.isArray(body.files) ? body.files.map((item) => String(item).trim()).filter(Boolean) : [];
  const createPullRequest = body.createPullRequest !== false;

  if (!requestedRepo) {
    return NextResponse.json({ ok: false, error: "repoUrl is required." }, { status: 400 });
  }
  if (!branchName.startsWith("codex/")) {
    return NextResponse.json({ ok: false, error: "branchName must start with codex/." }, { status: 400 });
  }

  const repoRoot = await findGitRoot(requestedRepo);
  if (!repoRoot) {
    return NextResponse.json({ ok: false, error: "Could not resolve git repository root from repoUrl." }, { status: 400 });
  }

  const checkout = await runGit(["checkout", "-B", branchName], repoRoot);
  if (checkout.code !== 0) {
    return NextResponse.json({ ok: false, error: checkout.stderr || "Failed to checkout promotion branch." }, { status: 500 });
  }

  const addArgs = files.length > 0 ? ["add", "--", ...files] : ["add", "-A"];
  const add = await runGit(addArgs, repoRoot);
  if (add.code !== 0) {
    return NextResponse.json({ ok: false, error: add.stderr || "Failed to stage changes." }, { status: 500 });
  }

  const staged = await runGit(["diff", "--cached", "--name-only"], repoRoot);
  if (staged.code !== 0 || !staged.stdout.trim()) {
    return NextResponse.json({ ok: false, error: "No staged changes available for promotion." }, { status: 409 });
  }

  await runGit(["config", "--local", "user.email", "elly@elyra.local"], repoRoot);
  await runGit(["config", "--local", "user.name", "Elyra Code"], repoRoot);
  const commit = await runGit(["commit", "-m", commitMessage], repoRoot);
  if (commit.code !== 0) {
    return NextResponse.json({ ok: false, error: commit.stderr || "Failed to create commit." }, { status: 500 });
  }

  const push = await runGit(["push", "-u", "origin", branchName], repoRoot);
  if (push.code !== 0) {
    return NextResponse.json({ ok: false, error: push.stderr || "Failed to push branch to origin." }, { status: 500 });
  }

  const remote = await runGit(["remote", "get-url", "origin"], repoRoot);
  const remoteRaw = remote.stdout || "";
  const remoteHttps = remoteToHttps(remote.stdout);
  const compareUrl =
    remoteHttps
      ? `${remoteHttps}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`
      : null;

  let prUrl: string | null = null;
  let prCreated = false;
  let prWarning: string | null = null;
  if (createPullRequest) {
    const ownerRepo = parseGitHubOwnerRepo(remoteRaw);
    if (!workspaceId) {
      prWarning = "PR creation skipped: workspaceId missing.";
    } else if (!ownerRepo) {
      prWarning = "PR creation skipped: origin remote is not a GitHub repository.";
    } else {
      const stored = await loadStoredGitHubToken(workspaceId).catch(() => null);
      const token = stored?.accessToken?.trim() ?? "";
      if (!token) {
        prWarning = "PR creation skipped: GitHub connector token is missing for this workspace.";
      } else {
        const prResponse = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(ownerRepo.owner)}/${encodeURIComponent(ownerRepo.repo)}/pulls`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: prTitle,
              head: branchName,
              base: baseBranch,
              body: prBody || undefined,
            }),
          },
        );
        const prPayload = (await prResponse.json().catch(() => null)) as
          | { html_url?: string; message?: string; errors?: Array<{ message?: string }> }
          | null;
        if (prResponse.ok && prPayload?.html_url) {
          prUrl = prPayload.html_url;
          prCreated = true;
        } else {
          const msg =
            prPayload?.message ||
            prPayload?.errors?.[0]?.message ||
            `GitHub API ${prResponse.status}`;
          prWarning = `PR creation failed: ${msg}`;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    repoRoot,
    branchName,
    baseBranch,
    prTitle,
    prBody,
    stagedFiles: staged.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    compareUrl,
    prUrl,
    prCreated,
    ...(prWarning ? { prWarning } : {}),
    commitOutput: commit.stdout || commit.stderr,
    pushOutput: push.stdout || push.stderr,
  });
}
