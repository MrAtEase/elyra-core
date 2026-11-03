import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "./logger";
import type { GitAutoCommitOptions, GitRunContext } from "./devTaskTypes";

const execFile = promisify(execFileCb);
const log = createLogger("GitService");

export interface GitCleanOptions {
  allowDirty?: boolean;
  message?: string;
}

const DEFAULT_DIRTY_MESSAGE =
  "Commit or stash your changes before running the session (or pass allowDirty=true in the caller).";

export async function getGitStatusPorcelain(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to run "git status --porcelain" in ${cwd}: ${message}`
    );
  }
}

export type GitStatusSummary = {
  clean: boolean;
  statusText: string;
};

export async function getGitStatus(root: string): Promise<GitStatusSummary> {
  const porcelain = await getGitStatusPorcelain(root);
  try {
    const { stdout } = await execFile("git", ["status", "-sb"], { cwd: root, encoding: "utf8" });
    return { clean: porcelain.trim().length === 0, statusText: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get git status in ${root}: ${message}`);
  }
}

export async function getCurrentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" });
    const branch = stdout.trim();
    if (branch === "HEAD") return null;
    return branch;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get current branch in ${root}: ${message}`);
  }
}

export async function getCurrentCommitSha(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function ensureCleanGitWorkingTree(
  cwd: string,
  options: GitCleanOptions = {}
): Promise<void> {
  const { allowDirty = false, message = DEFAULT_DIRTY_MESSAGE } = options;
  if (allowDirty) return;

  const status = await getGitStatusPorcelain(cwd);
  if (status !== "") {
    throw new Error(
      `Git working tree is not clean in ${cwd}. ${message}`
    );
  }
}

export async function ensureGitRepo(root: string): Promise<void> {
  try {
    await execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Not a git repository: ${root} (${msg})`);
  }
}

export async function createFeatureBranch(options: {
  projectRoot: string;
  baseBranch: string;
  branchName: string;
}): Promise<void> {
  const { projectRoot, baseBranch, branchName } = options;
  try {
    await execFile("git", ["fetch", "--all", "--prune"], { cwd: projectRoot });
  } catch (error) {
    log.warn("Git fetch failed (continuing):", error);
  }
  try {
    await execFile("git", ["show-ref", "--verify", "--quiet", `refs/heads/${baseBranch}`], { cwd: projectRoot });
  } catch {
    await execFile("git", ["branch", "--track", baseBranch, `origin/${baseBranch}`], { cwd: projectRoot }).catch(() => null);
  }
  try {
    await execFile("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd: projectRoot });
    await execFile("git", ["checkout", branchName], { cwd: projectRoot });
  } catch {
    await execFile("git", ["checkout", "-B", branchName, baseBranch], { cwd: projectRoot });
  }
  log.info(`[GitService] Using branch ${branchName} (base: ${baseBranch})`);
}

export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd: projectRoot });
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[MADRCU? ]+/, ""))
    .map((p) => p.replace(/\\/g, "/"));
}

export async function commitAll(options: {
  projectRoot: string;
  message: string;
}): Promise<{ commitSha?: string }> {
  const { projectRoot, message } = options;
  try {
    const status = await getGitStatusPorcelain(projectRoot);
    if (!status.trim()) {
      log.info("[GitService] No changes to commit.");
      return { commitSha: undefined };
    }
    await execFile("git", ["add", "-A"], { cwd: projectRoot });
    await execFile("git", ["commit", "-m", message], { cwd: projectRoot });
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
    return { commitSha: stdout.trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit changes: ${msg}`);
  }
}

export async function pushBranch(options: { projectRoot: string; branchName: string }): Promise<void> {
  try {
    await execFile("git", ["push", "-u", "origin", options.branchName], { cwd: options.projectRoot });
  } catch (error) {
    log.warn("[GitService] push skipped or failed:", error);
  }
}

export async function createOrCheckoutBranch(root: string, branchName: string): Promise<void> {
  const exists = await (async () => {
    try {
      await execFile("git", ["rev-parse", "--verify", branchName], { cwd: root });
      return true;
    } catch {
      return false;
    }
  })();

  try {
    if (exists) {
      await execFile("git", ["checkout", branchName], { cwd: root });
    } else {
      await execFile("git", ["checkout", "-b", branchName], { cwd: root });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create/checkout branch ${branchName}: ${msg}`);
  }
}

export async function hasUncommittedChanges(repoRoot: string): Promise<boolean> {
  const status = await getGitStatusPorcelain(repoRoot);
  return status.length > 0;
}

async function branchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--verify", branchName], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

export async function createAndCheckoutBranch(
  repoRoot: string,
  branchName: string,
  baseBranch?: string
): Promise<void> {
  try {
    if (baseBranch) {
      await execFile("git", ["checkout", baseBranch], { cwd: repoRoot });
      // Pull latest to avoid stale-branch merge conflicts on PR creation.
      // Silently ignore failures (e.g. no remote configured, detached HEAD).
      try {
        await execFile("git", ["pull", "--ff-only"], { cwd: repoRoot });
      } catch {
        // best-effort — continue even if pull fails
      }
    }
    const exists = await branchExists(repoRoot, branchName);
    if (exists) {
      await execFile("git", ["checkout", branchName], { cwd: repoRoot });
      return;
    }
    const args = ["checkout", "-b", branchName];
    if (baseBranch) args.push(baseBranch);
    await execFile("git", args, { cwd: repoRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create/checkout branch ${branchName}: ${message}`);
  }
}

async function ensureBranchExists(repoRoot: string, branchName: string): Promise<void> {
  const exists = await branchExists(repoRoot, branchName);
  if (exists) return;
  await execFile("git", ["branch", branchName], { cwd: repoRoot });
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-");
}

export async function createAutopilotCommit(
  repoRoot: string,
  options: GitAutoCommitOptions,
  files?: string[]
): Promise<GitRunContext> {
  const branchMode = options.branchMode || "none";
  const baseBranch = options.baseBranch || "main";
  let branchName: string | undefined;

  if (!options.enable) {
    return {
      repoRoot,
      branch: await getCurrentBranch(repoRoot),
      commitSha: await getCurrentCommitSha(repoRoot),
      tag: null,
    };
  }

  const current = await getCurrentBranch(repoRoot);
  if (branchMode === "feature") {
    const featureSlug = sanitizeName(options.featureId || "autopilot");
    branchName = `feature/autopilot/${featureSlug}`;
  } else if (branchMode === "custom") {
    if (!options.customBranchName) throw new Error("customBranchName is required for custom branch mode");
    branchName = options.customBranchName;
  } else {
    branchName = current || undefined;
  }

  if (!branchName) {
    throw new Error("Unable to determine branch name for git auto-commit");
  }

  try {
    await ensureGitRepo(repoRoot);
  } catch (err) {
    throw new Error(`Git repo check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    if (branchMode !== "none") {
      await ensureBranchExists(repoRoot, branchName);
      await checkoutBranch(repoRoot, branchName);
    }
  } catch (err) {
    throw new Error(`Git branch setup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    if (files && files.length > 0) {
      await execFile("git", ["add", "--", ...files], { cwd: repoRoot });
    } else {
      await execFile("git", ["add", "-A"], { cwd: repoRoot });
    }
    const message = options.commitMessage || (options.featureId ? `Autopilot: ${options.featureId}` : "Autopilot session");
    const commitResult = await execFile("git", ["commit", "-m", message], { cwd: repoRoot }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("nothing to commit")) {
        log.info("[GitService] Nothing to commit.");
        return null;
      }
      throw err;
    });
    if (commitResult) {
      log.info("[GitService] Commit created", { branch: branchName });
    }
    const commitSha = await getCurrentCommitSha(repoRoot);
    if (options.tagName && commitSha) {
      const tagMsg = options.tagMessage || message;
      await execFile("git", ["tag", "-a", options.tagName, "-m", tagMsg], { cwd: repoRoot }).catch((err) => {
        log.warn("[GitService] Tag creation failed:", err);
      });
    }
    return {
      repoRoot,
      branch: branchName,
      commitSha,
      tag: options.tagName || null,
    };
  } catch (err) {
    throw new Error(`Git auto-commit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  try {
    await execFile("git", ["checkout", branchName], { cwd: repoRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to checkout branch ${branchName}: ${message}`);
  }
}

export async function commitAllChanges(
  repoRoot: string,
  message: string
): Promise<{ hash: string; message: string } | null> {
  const dirty = await hasUncommittedChanges(repoRoot);
  if (!dirty) return null;
  try {
    await execFile("git", ["add", "-A"], { cwd: repoRoot });
    await execFile("git", ["commit", "-m", message], { cwd: repoRoot });
    const hash = await getHeadCommitHash(repoRoot);
    return { hash, message };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit changes: ${msg}`);
  }
}

export async function getHeadCommitHash(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return stdout.trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read commit hash: ${msg}`);
  }
}

export async function createBranchIfNeeded(root: string, branchName: string): Promise<void> {
  const current = await getCurrentBranch(root);
  if (current === branchName) return;
  const exists = await (async () => {
    try {
      await execFile("git", ["rev-parse", "--verify", branchName], { cwd: root });
      return true;
    } catch {
      return false;
    }
  })();
  try {
    if (exists) {
      await execFile("git", ["switch", branchName], { cwd: root });
    } else {
      await execFile("git", ["switch", "-c", branchName], { cwd: root });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create/switch to branch ${branchName}: ${message}`);
  }
}

export async function commitAllChangesWithSummary(
  root: string,
  message: string
): Promise<{ commitHash: string; summary: string }> {
  await execFile("git", ["add", "-A"], { cwd: root });
  await execFile("git", ["commit", "-m", message], { cwd: root });
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });
  const commitHash = stdout.trim();
  return { commitHash, summary: message };
}
