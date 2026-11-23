/**
 * Coding agent – Playground mirror, package scripts and diff normalisation.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import { PLAYGROUND_PID_FILE, PLAYGROUND_PREVIEW_PORT } from "@/lib/code-agent/config";
import { runCommand, sanitizeUnifiedDiff } from "@/lib/code-agent/gates";
import { slugifyCommitFragment } from "@/lib/code-agent/localAgent";
import type { ScopedFileSnapshot } from "@/lib/code-agent/types";
import { rewriteNoIndexDiffPaths } from "@/lib/code-agent/localFallback";
import { diffTouchedFiles } from "@/lib/code-agent/repo";
import { callProviderJson } from "@/lib/code-agent/providers";

export function buildAgentBranchName(stage: "playground" | "dev" | "prod"): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  return `elyra/${stage}-${stamp}`;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function preparePlaygroundMirror(sourceRoot: string): Promise<string> {
  // Use /tmp for the mirror to avoid Node.js cp EINVAL when the destination is
  // a subdirectory of the source (e.g. sourceRoot/.run/playground/mirror would
  // trigger EINVAL even with a filter that excludes .run).
  const mirrorHash = createHash("sha256").update(sourceRoot).digest("hex").slice(0, 12);
  const mirrorRoot = path.join(require("node:os").tmpdir(), `elyra-mirror-${mirrorHash}`);
  await rm(mirrorRoot, { recursive: true, force: true });
  await mkdir(mirrorRoot, { recursive: true });
  await cp(sourceRoot, mirrorRoot, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === ".git" || name === ".next" || name === ".run" || name === PLAYGROUND_PID_FILE) return false;
      if (name === "node_modules") return false;
      return true;
    },
  });

  const sourceNodeModules = path.join(sourceRoot, "node_modules");
  const targetNodeModules = path.join(mirrorRoot, "node_modules");
  if (await pathExists(sourceNodeModules)) {
    try {
      await symlink(sourceNodeModules, targetNodeModules, "dir");
    } catch {
      // Ignore if the platform does not allow symlinks; build/test may still work if dependencies are hoisted.
    }
  }

  // Initialize a standalone git repo in the mirror so git apply works correctly.
  // Without its own .git, git would inherit the parent repo context and resolve
  // patch paths relative to the wrong working tree root.
  await runCommand("git", ["init"], mirrorRoot, undefined, 10_000);
  await runCommand("git", ["-c", "user.email=agent@elyra.local", "-c", "user.name=ElyraAgent", "commit", "--allow-empty", "-m", "init"], mirrorRoot, undefined, 10_000);
  await runCommand("git", ["add", "-A"], mirrorRoot, undefined, 30_000);
  await runCommand("git", ["-c", "user.email=agent@elyra.local", "-c", "user.name=ElyraAgent", "commit", "-m", "snapshot: playground baseline"], mirrorRoot, undefined, 30_000);

  return mirrorRoot;
}

/**
 * After applying a patch to the playground mirror, sync the changed files to the
 * actual running playground directory (served on port 3100) so that Next.js
 * hot-reload picks up the changes immediately.
 */
export async function syncMirrorToPlayground(mirrorRoot: string, sourceRoot: string, changedFiles: string[]): Promise<void> {
  // The running playground server serves from {sourceRoot}/.run/playground/frontend.
  const playgroundDir = path.join(sourceRoot, ".run", "playground", "frontend");
  if (!(await pathExists(playgroundDir))) return;

  // Keep the live preview mirror in sync with the verified temp mirror, not only
  // the changed files. Otherwise a previously broken file can survive in
  // .run/playground/frontend even though the verified temp mirror is clean.
  await cp(mirrorRoot, playgroundDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === ".git" || name === ".next" || name === PLAYGROUND_PID_FILE) return false;
      if (name === "node_modules") return false;
      return true;
    },
  }).catch(() => null);

  // Also ensure explicitly changed paths are overwritten even if their diff path
  // came through with a frontend/ prefix.
  for (const relPath of changedFiles) {
    const strippedPath = relPath.startsWith("frontend/") ? relPath.slice("frontend/".length) : relPath;
    const mirrorFile = path.resolve(mirrorRoot, relPath);
    const fallbackMirrorFile = path.resolve(mirrorRoot, strippedPath);
    const sourceFile = (await pathExists(mirrorFile)) ? mirrorFile : fallbackMirrorFile;
    const playgroundFile = path.resolve(playgroundDir, strippedPath);
    if (!(await pathExists(sourceFile))) continue;
    await mkdir(path.dirname(playgroundFile), { recursive: true }).catch(() => null);
    await cp(sourceFile, playgroundFile, { force: true }).catch(() => null);
  }
}

export async function snapshotPlaygroundGit(input: {
  sourceRoot: string;
  task: string;
}): Promise<{ commit?: string; note: string }> {
  const playgroundDir = path.join(input.sourceRoot, ".run", "playground", "frontend");
  if (!(await pathExists(playgroundDir))) {
    return { note: "Playground git snapshot skipped (playground directory not found)." };
  }

  const dotGit = path.join(playgroundDir, ".git");
  if (!(await pathExists(dotGit))) {
    const init = await runCommand("git", ["init"], playgroundDir, undefined, 10_000);
    if (init.code !== 0) {
      return { note: "Playground git snapshot skipped (git init failed)." };
    }
    await runCommand("git", ["config", "user.email", "playground@elyra.local"], playgroundDir, undefined, 10_000);
    await runCommand("git", ["config", "user.name", "Elyra Playground"], playgroundDir, undefined, 10_000);
  }

  await runCommand("git", ["add", "-A"], playgroundDir, undefined, 30_000);
  const status = await runCommand("git", ["status", "--porcelain"], playgroundDir, undefined, 10_000);
  if (!status.stdout.trim()) {
    return { note: "Playground git snapshot skipped (no changes)." };
  }

  const message = `playground: ${slugifyCommitFragment(input.task)}`;
  const commit = await runCommand("git", ["commit", "-m", message], playgroundDir, undefined, 30_000);
  if (commit.code !== 0) {
    return { note: "Playground git snapshot skipped (commit failed)." };
  }
  const head = await runCommand("git", ["rev-parse", "--short", "HEAD"], playgroundDir, undefined, 10_000);
  const commitSha = head.stdout.trim();
  return commitSha
    ? { commit: commitSha, note: `Playground snapshot committed (${commitSha}).` }
    : { note: "Playground snapshot committed." };
}

async function ensurePlaygroundPreviewServer(root: string): Promise<string | undefined> {
  const packageJsonPath = path.join(root, "package.json");
  if (!(await pathExists(packageJsonPath))) return undefined;

  const pidFile = path.join(root, PLAYGROUND_PID_FILE);
  if (await pathExists(pidFile)) {
    try {
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 0);
        return `http://localhost:${PLAYGROUND_PREVIEW_PORT}`;
      }
    } catch {
      // stale pid file – clean it up so we start fresh
      await rm(pidFile, { force: true }).catch(() => null);
    }
  }

  const devArgs = ["run", "dev", "--", "--port", String(PLAYGROUND_PREVIEW_PORT)];
  const child = spawn("npm", devArgs, {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await writeFile(pidFile, String(child.pid ?? ""), "utf8");
  return `http://localhost:${PLAYGROUND_PREVIEW_PORT}`;
}

const PACKAGE_MANAGER_BINARY_CACHE = new Map<string, boolean>();

async function commandExists(command: string): Promise<boolean> {
  const cached = PACKAGE_MANAGER_BINARY_CACHE.get(command);
  if (typeof cached === "boolean") return cached;

  const candidates =
    command === "pnpm"
      ? [
          process.env.PNPM_PATH?.trim(),
          "/opt/homebrew/bin/pnpm",
          "/usr/local/bin/pnpm",
          path.join(process.env.HOME || "", ".local", "share", "pnpm", "pnpm"),
        ].filter(Boolean) as string[]
      : [command];

  for (const candidate of candidates) {
    try {
      const target = candidate.includes("/") ? candidate : candidate;
      await new Promise<void>((resolve, reject) => {
        execFile(target, ["--version"], { timeout: 5_000 }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      PACKAGE_MANAGER_BINARY_CACHE.set(command, true);
      return true;
    } catch {
      // try next candidate
    }
  }

  PACKAGE_MANAGER_BINARY_CACHE.set(command, false);
  return false;
}

export async function detectPackageManager(root: string): Promise<"pnpm" | "npm"> {
  const hasPackageLock = await pathExists(path.join(root, "package-lock.json"));
  const hasPnpmLock = await pathExists(path.join(root, "pnpm-lock.yaml"));
  const pnpmAvailable = hasPnpmLock ? await commandExists("pnpm") : false;

  if (hasPackageLock) return "npm";
  if (hasPnpmLock && pnpmAvailable) return "pnpm";
  return "npm";
}

export async function loadPackageScripts(root: string, executionLog?: string[]): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return packageJson.scripts ?? {};
  } catch {
    // Missing or invalid package.json — gates will be silently skipped.
    // Log a warning so the user understands why no gates ran.
    executionLog?.push(`Warning: package.json not found or invalid at ${root} — build/test gates will be skipped.`);
    return {};
  }
}

function normalizeDiffPathToken(token: string, executionRoot: string): string {
  if (!token || token === "/dev/null") return token;

  const prefix = token.startsWith("a/") ? "a/" : token.startsWith("b/") ? "b/" : "";
  const rawPath = prefix ? token.slice(2) : token;
  const normalizedRawPath = rawPath.replace(/\\/g, "/");
  const normalizedRoot = path.resolve(executionRoot).replace(/\\/g, "/");
  const repoName = path.basename(normalizedRoot);

  let relativePath = normalizedRawPath;
  if (path.isAbsolute(normalizedRawPath)) {
    if (normalizedRawPath.startsWith(`${normalizedRoot}/`)) {
      relativePath = normalizedRawPath.slice(normalizedRoot.length + 1);
    } else {
      return token;
    }
  } else {
    const mirrorMarker = `/.run/playground/${repoName}/`;
    const mirrorIdx = normalizedRawPath.indexOf(mirrorMarker);
    if (mirrorIdx >= 0) {
      relativePath = normalizedRawPath.slice(mirrorIdx + mirrorMarker.length);
    }
  }

  const clean = relativePath.replace(/^\.\/+/, "");
  if (!clean || clean.startsWith("../")) return token;
  return `${prefix}${clean}`;
}

export function normalizeDiffForExecution(diff: string, executionRoot: string): string {
  const lines = diff.split("\n");
  const isTempPath = (value: string) => {
    const raw = value.replace(/^a\//, "").replace(/^b\//, "");
    return raw.startsWith(".run/tmp/") || raw.includes("/.run/tmp/");
  };
  const stripPrefix = (value: string) => value.replace(/^a\//, "").replace(/^b\//, "");
  const withPrefix = (value: string, prefix: "a/" | "b/") => (value.startsWith(prefix) ? value : `${prefix}${value}`);
  let currentOldPath: string | null = null;
  let currentNewPath: string | null = null;
  const normalized = lines.map((line) => {
    const diffHeader = line.match(/^diff --git\s+([^\s]+)\s+([^\s]+)\s*$/);
    if (diffHeader) {
      const leftToken = normalizeDiffPathToken(diffHeader[1] ?? "", executionRoot);
      const rightToken = normalizeDiffPathToken(diffHeader[2] ?? "", executionRoot);
      const leftRaw = stripPrefix(leftToken);
      const rightRaw = stripPrefix(rightToken);
      let nextLeft = leftToken;
      let nextRight = rightToken;
      if (isTempPath(nextLeft) && !isTempPath(nextRight) && rightRaw) {
        nextLeft = withPrefix(rightRaw, "a/");
      } else if (isTempPath(nextRight) && !isTempPath(nextLeft) && leftRaw) {
        nextRight = withPrefix(leftRaw, "b/");
      }
      currentOldPath = stripPrefix(nextLeft);
      currentNewPath = stripPrefix(nextRight);
      return `diff --git ${nextLeft} ${nextRight}`;
    }
    if (line.startsWith("diff --git ")) {
      currentOldPath = null;
      currentNewPath = null;
      return line;
    }
    const match = line.match(/^(\+\+\+|---)\s+([^\s]+)(.*)$/);
    if (!match) return line;
    const marker = match[1] ?? "";
    const token = match[2] ?? "";
    const suffix = match[3] ?? "";
    let normalizedToken = normalizeDiffPathToken(token, executionRoot);

    if (marker === "---") {
      const candidateOld = stripPrefix(normalizedToken);
      if (isTempPath(normalizedToken) && currentNewPath && !isTempPath(currentNewPath)) {
        normalizedToken = `a/${currentNewPath}`;
      }
      currentOldPath = stripPrefix(normalizedToken || candidateOld);
      return `${marker} ${normalizedToken}${suffix}`;
    }

    const candidateNew = stripPrefix(normalizedToken);
    if (isTempPath(normalizedToken) && currentOldPath && !isTempPath(currentOldPath)) {
      normalizedToken = `b/${currentOldPath}`;
    }
    currentNewPath = stripPrefix(normalizedToken || candidateNew);
    return `${marker} ${normalizedToken}${suffix}`;
  });
  return `${normalized.join("\n").trim()}\n`;
}

export function rewriteTempDiffToSelectedFile(diff: string, selectedFile: string): string {
  const safePath = selectedFile.replace(/^\.\/+/, "");
  const lines = diff.split("\n");
  const rewritten = lines.map((line) => {
    if (line.startsWith("diff --git ")) {
      return `diff --git a/${safePath} b/${safePath}`;
    }
    const header = line.match(/^(\+\+\+|---)\s+([^\s]+)(.*)$/);
    if (!header) return line;
    const marker = header[1] ?? "";
    const token = header[2] ?? "";
    const suffix = header[3] ?? "";
    if (token === "/dev/null") return line;
    return marker === "---"
      ? `--- a/${safePath}${suffix}`
      : `+++ b/${safePath}${suffix}`;
  });
  return `${rewritten.join("\n").trim()}\n`;
}

const GEMINI_PATCH_REPAIR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    diff: { type: "string" },
    notes: { type: "string" },
  },
  required: ["diff"],
};

const SINGLE_FILE_REWRITE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    content: { type: "string" },
    summary: { type: "string" },
  },
  required: ["content"],
};

export const DIRECT_FILE_EDIT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    content: { type: "string" },
    summary: { type: "string" },
    diagnosis: { type: "string" },
    relatedFilesChecked: { type: "array", items: { type: "string" } },
  },
  required: ["content"],
};

function buildExecutionPathVariants(relPath: string): string[] {
  const trimmed = relPath.replace(/^\.\/+/, "").replace(/^\/+/, "");
  const variants = new Set<string>();
  if (!trimmed) return [];
  // Reject paths that escape the repo root via parent-directory traversal.
  if (path.normalize(trimmed).startsWith("..")) return [];
  variants.add(trimmed);
  if (trimmed.startsWith("frontend/")) {
    variants.add(trimmed.slice("frontend/".length));
  } else {
    variants.add(`frontend/${trimmed}`);
  }
  return [...variants];
}

export async function resolveExistingExecutionPath(executionRoot: string, relPath: string): Promise<string | null> {
  for (const candidate of buildExecutionPathVariants(relPath)) {
    if (await pathExists(path.resolve(executionRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

export async function snapshotScopedFiles(executionRoot: string, selectedFiles: string[]): Promise<ScopedFileSnapshot[]> {
  const snapshots: ScopedFileSnapshot[] = [];
  for (const relPath of selectedFiles) {
    const targetFile = await resolveExistingExecutionPath(executionRoot, relPath);
    if (!targetFile) continue;
    const content = await readFile(path.resolve(executionRoot, targetFile), "utf8").catch(() => "");
    if (!content) continue;
    snapshots.push({ file: targetFile, content });
  }
  return snapshots;
}

export async function restoreScopedFiles(executionRoot: string, snapshots: ScopedFileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    await writeFile(path.resolve(executionRoot, snapshot.file), snapshot.content, "utf8").catch(() => null);
  }
}

async function buildReplacementDiffForFile(input: {
  executionRoot: string;
  targetRelPath: string;
  updatedContent: string;
}): Promise<string | null> {
  const targetRel = input.targetRelPath.replace(/^\/+/, "");
  const tempDir = path.join(input.executionRoot, ".run", "tmp");
  await mkdir(tempDir, { recursive: true });
  const tempRel = path.join(".run", "tmp", `.single-file-rewrite-${Date.now()}.tmp`).replaceAll(path.sep, "/");
  const tempAbs = path.resolve(input.executionRoot, tempRel);
  try {
    await writeFile(tempAbs, input.updatedContent, "utf8");
    const diffResult = await runCommand("git", ["diff", "--no-index", "--", targetRel, tempRel], input.executionRoot);
    const rawDiff = diffResult.stdout || diffResult.stderr || "";
    if (!rawDiff.trim()) return null;
    const diff = rewriteNoIndexDiffPaths(rawDiff, targetRel, tempRel);
    return diff.includes(`+++ b/${targetRel}`) ? sanitizeUnifiedDiff(diff) : null;
  } finally {
    await rm(tempAbs, { force: true }).catch(() => null);
  }
}

export async function attemptSingleFileRewriteFallback(input: {
  provider: ProviderId;
  task: string;
  executionRoot: string;
  selectedFiles: string[];
  failedDiff: string;
  applyError: string;
}): Promise<{ diff: string; targetFile: string; summary?: string } | null> {
  const touched = diffTouchedFiles(input.failedDiff);
  const preferred = input.selectedFiles.length === 1
    ? input.selectedFiles[0] ?? ""
    : touched.length === 1
      ? touched[0] ?? ""
      : "";
  if (!preferred) return null;

  const targetFile = await resolveExistingExecutionPath(input.executionRoot, preferred);
  if (!targetFile) return null;

  const targetAbs = path.resolve(input.executionRoot, targetFile);
  let currentContent = "";
  try {
    currentContent = await readFile(targetAbs, "utf8");
  } catch {
    return null;
  }
  if (!currentContent || currentContent.length > 120_000) return null;

  const prompt = [
    `Task: ${input.task}`,
    `Target file: ${targetFile}`,
    "Goal: regenerate the full contents of this single file so the intended change can be applied against the current repository state.",
    "Modify only this file. Preserve unrelated logic and formatting unless required for the task.",
    "",
    "git apply error:",
    input.applyError,
    "",
    "Failed unified diff:",
    input.failedDiff,
    "",
    `Current file (${targetFile}) from the repo:`,
    "----- BEGIN FILE -----",
    currentContent,
    "----- END FILE -----",
    "",
    "Return ONLY strict JSON: {\"content\":\"<full updated file contents>\",\"summary\":\"optional short note\"}.",
    "Rules: content must be the complete file, not a diff. No markdown fences.",
  ].join("\n");

  try {
    const parsed = await callProviderJson(input.provider, {
      system:
        "You repair failed code-edit attempts by rewriting a single existing file from the current repository state. Return strict JSON only.",
      prompt,
      responseJsonSchema: SINGLE_FILE_REWRITE_SCHEMA,
      cwd: input.executionRoot,
    });
    const nextContent = typeof parsed.content === "string" ? parsed.content : "";
    if (!nextContent || nextContent === currentContent) return null;
    const diff = await buildReplacementDiffForFile({
      executionRoot: input.executionRoot,
      targetRelPath: targetFile,
      updatedContent: nextContent,
    });
    if (!diff) return null;
    return {
      diff,
      targetFile,
      ...(typeof parsed.summary === "string" && parsed.summary.trim()
        ? { summary: parsed.summary.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function buildUnifiedDiffFromContents(input: {
  executionRoot: string;
  targetRelPath: string;
  beforeContent: string;
  afterContent: string;
}): Promise<string | null> {
  const targetRel = input.targetRelPath.replace(/^\/+/, "");
  const tempDir = path.join(input.executionRoot, ".run", "tmp");
  await mkdir(tempDir, { recursive: true });
  const beforeRel = path.join(".run", "tmp", `.before-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`).replaceAll(path.sep, "/");
  const afterRel = path.join(".run", "tmp", `.after-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`).replaceAll(path.sep, "/");
  const beforeAbs = path.resolve(input.executionRoot, beforeRel);
  const afterAbs = path.resolve(input.executionRoot, afterRel);
  try {
    await writeFile(beforeAbs, input.beforeContent, "utf8");
    await writeFile(afterAbs, input.afterContent, "utf8");
    const diffResult = await runCommand("git", ["diff", "--no-index", "--", beforeRel, afterRel], input.executionRoot);
    const rawDiff = diffResult.stdout || diffResult.stderr || "";
    if (!rawDiff.trim()) return null;
    const rewritten = rawDiff
      .replace(new RegExp(`a/${escape(beforeRel)}`, "g"), `a/${targetRel}`)
      .replace(new RegExp(`b/${escape(afterRel)}`, "g"), `b/${targetRel}`)
      .replace(new RegExp(`--- ${escape(beforeRel)}`, "g"), `--- a/${targetRel}`)
      .replace(new RegExp(`\\+\\+\\+ ${escape(afterRel)}`, "g"), `+++ b/${targetRel}`);
    return sanitizeUnifiedDiff(rewritten);
  } finally {
    await rm(beforeAbs, { force: true }).catch(() => null);
    await rm(afterAbs, { force: true }).catch(() => null);
  }
}
