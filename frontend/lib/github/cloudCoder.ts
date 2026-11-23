/**
 * GitHub Cloud Coder helpers
 *
 * Provides clone → apply → push → PR functions used by the coder API route
 * when the target repository is a remote GitHub repo (not a local filesystem path).
 *
 * Flow:
 *   1. cloneRepoToTmp()       — shallow-clone the repo into /tmp
 *   2. applyPatchAndVerify()  — existing pipeline applies the diff to the clone (unchanged)
 *   3. pushBranchAndCreatePR() — commit, push a new branch, open a PR
 *   4. cleanupGitHubClone()   — remove the /tmp directory
 */

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";

// ── Git helper ──────────────────────────────────────────────────────────────

function runGit(
  args: string[],
  cwd: string,
  timeout = 90_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout, maxBuffer: 1024 * 1024 * 8 },
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

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "update"
  );
}

// ── Clone ───────────────────────────────────────────────────────────────────

/**
 * Shallow-clone a GitHub repo to /tmp and return the absolute clone path.
 * Uses x-access-token auth so no SSH key is needed on Vercel.
 */
export async function cloneRepoToTmp(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const tmpDir = `/tmp/elyra-gh-${owner}-${repo}-${Date.now()}`;
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "git",
      ["clone", "--depth=1", "--branch", branch, "--single-branch", authUrl, tmpDir],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() });
      },
    );
  });

  if (result.code !== 0) {
    throw new Error(
      `GitHub clone failed (${owner}/${repo}@${branch}): ${result.stderr || result.stdout}`,
    );
  }

  return tmpDir;
}

// ── Push + PR ────────────────────────────────────────────────────────────────

export type GitHubPRResult = {
  branchName: string;
  prUrl: string | null;
  compareUrl: string;
  prWarning?: string;
};

/**
 * Create a new branch in the clone, commit all working-tree changes, push,
 * and open a Pull Request via the GitHub API.
 */
export async function pushBranchAndCreatePR(opts: {
  token: string;
  tmpDir: string;
  owner: string;
  repo: string;
  baseBranch: string;
  taskSlug: string;
  prTitle: string;
  prBody: string;
}): Promise<GitHubPRResult> {
  const { token, tmpDir, owner, repo, baseBranch, taskSlug, prTitle, prBody } = opts;

  // Branch name: elly/{slug}-{YYYYMMDD}-{HHmm}
  const now = new Date();
  const datePart = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const branchName = `elly/${slugify(taskSlug)}-${datePart}-${timePart}`;

  // Create feature branch
  const checkout = await runGit(["checkout", "-b", branchName], tmpDir);
  if (checkout.code !== 0) {
    throw new Error(`Failed to create branch ${branchName}: ${checkout.stderr}`);
  }

  // Set git identity
  await runGit(["config", "user.email", "elly@elyra.local"], tmpDir);
  await runGit(["config", "user.name", "Elyra Code"], tmpDir);

  // Stage all changes
  const add = await runGit(["add", "-A"], tmpDir);
  if (add.code !== 0) {
    throw new Error(`git add failed: ${add.stderr}`);
  }

  // Verify there is something to commit
  const staged = await runGit(["diff", "--cached", "--name-only"], tmpDir);
  if (!staged.stdout.trim()) {
    throw new Error("No changes staged after patch apply — nothing to commit.");
  }

  // Commit
  const commit = await runGit(["commit", "-m", `elly: ${taskSlug.slice(0, 72)}`], tmpDir);
  if (commit.code !== 0) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }

  // Authenticate the remote before pushing
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await runGit(["remote", "set-url", "origin", authUrl], tmpDir);

  // Push
  const push = await runGit(["push", "origin", branchName], tmpDir);
  if (push.code !== 0) {
    throw new Error(`git push failed: ${push.stderr}`);
  }

  const compareUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;

  // Create PR via GitHub API
  let prUrl: string | null = null;
  let prWarning: string | undefined;

  try {
    const prRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: prTitle,
          head: branchName,
          base: baseBranch,
          body: prBody,
        }),
      },
    );

    const prPayload = (await prRes.json().catch(() => null)) as
      | { html_url?: string; message?: string; errors?: Array<{ message?: string }> }
      | null;

    if (prRes.ok && prPayload?.html_url) {
      prUrl = prPayload.html_url;
    } else {
      const msg =
        prPayload?.message || prPayload?.errors?.[0]?.message || `GitHub API ${prRes.status}`;
      prWarning = `PR creation failed: ${msg}`;
    }
  } catch (err) {
    prWarning = `PR creation error: ${String(err)}`;
  }

  return { branchName, prUrl, compareUrl, ...(prWarning ? { prWarning } : {}) };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/** Remove the temporary clone directory. Safe to call even if the dir doesn't exist. */
export async function cleanupGitHubClone(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}
