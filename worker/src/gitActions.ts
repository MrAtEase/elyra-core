import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createLogger } from "./logger";

const run = promisify(exec);
const log = createLogger("GitActions");

async function execGit(cmd: string, cwd: string) {
  return run(cmd, { cwd, env: process.env, maxBuffer: 4 * 1024 * 1024 });
}

export async function ensureRepo(cwd: string): Promise<void> {
  try {
    await execGit("git rev-parse --is-inside-work-tree", cwd);
  } catch (error) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

export async function safeMergeBase(cwd: string, base = "main"): Promise<string> {
  const { stdout } = await execGit(`git merge-base HEAD ${base}`, cwd);
  return stdout.trim();
}

async function branchExists(cwd: string, name: string): Promise<boolean> {
  try {
    const { stdout } = await execGit(`git rev-parse --verify ${name}`, cwd);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function createBranch(cwd: string, name: string, base = "main"): Promise<string> {
  await ensureRepo(cwd);
  let branchName = name;
  let suffix = 1;
  while (await branchExists(cwd, branchName)) {
    branchName = `${name}-${suffix}`;
    suffix += 1;
  }
  await execGit(`git fetch origin ${base}:${base} || true`, cwd);
  await execGit(`git checkout -b ${branchName} ${base}`, cwd);
  log.info(`Created branch ${branchName} from ${base}`);
  return branchName;
}

export async function switchToBranch(cwd: string, name: string): Promise<void> {
  await ensureRepo(cwd);
  await execGit(`git checkout ${name}`, cwd);
  log.info(`Switched to branch ${name}`);
}

export async function commitAll(
  cwd: string,
  message: string
): Promise<{ noChanges: boolean; commitSha?: string }> {
  await ensureRepo(cwd);
  const { stdout: status } = await execGit("git status --porcelain", cwd);
  if (!status.trim()) {
    return { noChanges: true };
  }
  await execGit("git add -A", cwd);
  await execGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
  const { stdout } = await execGit("git rev-parse HEAD", cwd);
  const sha = stdout.trim();
  log.info(`Committed changes ${sha}`);
  return { noChanges: false, commitSha: sha };
}

type PRDraftInput = { title: string; body?: string };

export async function createPRDraft(
  cwd: string,
  input: PRDraftInput
): Promise<{ url?: string; skipped?: boolean }> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    log.warn("Skipping PR draft (GITHUB_TOKEN/OWNER/REPO not set)");
    return { skipped: true };
  }

  const { stdout: currentBranchOut } = await execGit("git rev-parse --abbrev-ref HEAD", cwd);
  const branch = currentBranchOut.trim();

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "merlin-autopilot",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body || "",
      head: branch,
      base: "main",
      draft: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error("Failed to create PR draft:", res.status, text.slice(0, 200));
    return { skipped: true };
  }

  const data = await res.json();
  return { url: data.html_url as string | undefined, skipped: false };
}
