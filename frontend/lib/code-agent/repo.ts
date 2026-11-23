/**
 * Coding agent – Repository resolution, snapshots and task-scoped file selection.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import path from "node:path";
import { readdir, readFile, stat, symlink } from "node:fs/promises";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole } from "@/types/agent";
import { runCommand } from "@/lib/code-agent/gates";
import { pathExists } from "@/lib/code-agent/playground";
import type { FolderOption, RepoOption, RepoSampleFile, RepoSnapshot } from "@/lib/code-agent/types";
import { MAX_FOLDER_OPTIONS, MAX_FOLDER_SCAN_DEPTH, MAX_LOCAL_REPOS, MAX_REPO_EXCERPT_CHARS, MAX_REPO_FILES, MAX_REPO_SAMPLES, MAX_REPO_SCAN_FILES, REPO_SCAN_SKIP_DIRS, REPO_SCAN_TEXT_EXTENSIONS } from "@/lib/code-agent/config";

export async function resolveRepoRoot(repoUrl: string): Promise<string> {
  const trimmed = repoUrl.trim();
  const candidates: string[] = [];
  const workspaceRoot = path.resolve(process.cwd(), "..");

  const pushCandidate = (candidate: string) => {
    const normalized = path.resolve(candidate);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  const isAncestor = (parentPath: string, childPath: string) => {
    const rel = path.relative(parentPath, childPath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };

  let explicitCandidate: string | null = null;

  if (trimmed.startsWith("file://")) {
    try {
      explicitCandidate = new URL(trimmed).pathname;
    } catch {
      // fall through
    }
  } else if (trimmed.startsWith("/")) {
    explicitCandidate = trimmed;
  }

  if (explicitCandidate) {
    // If the explicit path is a broad parent directory (for example "/Users/.../Projects")
    // prefer the active Elyra repo root first to avoid resolving to the wrong parent git root.
    if (isAncestor(path.resolve(explicitCandidate), workspaceRoot)) {
      pushCandidate(workspaceRoot);
      pushCandidate(explicitCandidate);
    } else {
      pushCandidate(explicitCandidate);
      pushCandidate(workspaceRoot);
    }
  } else {
    pushCandidate(workspaceRoot);
  }

  pushCandidate(process.cwd());

  for (const candidate of candidates) {
    try {
      const details = await stat(candidate);
      if (!details.isDirectory()) {
        continue;
      }

      const gitTopLevel = await runCommand("git", ["rev-parse", "--show-toplevel"], candidate, undefined, 5_000);
      if (gitTopLevel.code === 0) {
        const resolved = gitTopLevel.stdout.trim();
        if (resolved) {
          return resolved;
        }
      }

      const gitStats = await stat(path.join(candidate, ".git")).catch(() => null);
      if (gitStats && (gitStats.isDirectory() || gitStats.isFile())) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  return process.cwd();
}

export async function resolveRepoWorkdir(repoUrl: string): Promise<string> {
  const trimmed = repoUrl.trim();
  let explicitCandidate: string | null = null;

  if (trimmed.startsWith("file://")) {
    try {
      explicitCandidate = new URL(trimmed).pathname;
    } catch {
      explicitCandidate = null;
    }
  } else if (trimmed.startsWith("/")) {
    explicitCandidate = trimmed;
  }

  if (explicitCandidate) {
    const resolvedCandidate = path.resolve(explicitCandidate);
    try {
      const details = await stat(resolvedCandidate);
      if (details.isDirectory()) {
        return resolvedCandidate;
      }
    } catch {
      // fall through to repo root resolution
    }
  }

  return resolveRepoRoot(repoUrl);
}

export async function resolveVerificationRoot(repoUrl: string, executionRoot: string): Promise<string> {
  const trimmed = repoUrl.trim();
  let explicitCandidate: string | null = null;

  if (trimmed.startsWith("file://")) {
    try {
      explicitCandidate = new URL(trimmed).pathname;
    } catch {
      explicitCandidate = null;
    }
  } else if (trimmed.startsWith("/")) {
    explicitCandidate = trimmed;
  }

  if (!explicitCandidate) return executionRoot;

  const resolvedCandidate = path.resolve(explicitCandidate);
  const hasCandidatePackageJson = await pathExists(path.join(resolvedCandidate, "package.json"));
  if (!hasCandidatePackageJson) return executionRoot;

  const repoRoot = await resolveRepoRoot(repoUrl.split("#")[0] ?? repoUrl);
  const rel = path.relative(repoRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return executionRoot;
  }

  const mapped = rel ? path.resolve(executionRoot, rel) : executionRoot;
  if (await pathExists(path.join(mapped, "package.json"))) {
    const mappedNodeModules = path.join(mapped, "node_modules");
    const rootNodeModules = path.join(executionRoot, "node_modules");
    if (!(await pathExists(mappedNodeModules)) && (await pathExists(rootNodeModules))) {
      try {
        await symlink(rootNodeModules, mappedNodeModules, "dir");
      } catch {
        // Ignore if the symlink already exists or the platform rejects it.
      }
    }
    return mapped;
  }

  // When the user targets a nested package directly (for example `/repo/frontend`)
  // the playground mirror is already a copy of that package root. In that case
  // `mapped` points to a non-existent nested duplicate such as
  // `.../elyra-mirror-xxxx/frontend`, which breaks build verification because the
  // package manager sees no local installation. If the mirror root itself already
  // contains a package.json, prefer it.
  if (await pathExists(path.join(executionRoot, "package.json"))) {
    return executionRoot;
  }

  return executionRoot;
}

export function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const trimmed = repoUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

async function fetchGitHubRepoSnapshot(input: {
  workspaceId: string;
  repoUrl: string;
  branch: string;
  folderPath: string;
}): Promise<RepoSnapshot | null> {
  const parsedRepo = parseGitHubRepoUrl(input.repoUrl);
  if (!parsedRepo || !input.workspaceId) return null;

  const token = await loadStoredGitHubToken(input.workspaceId).catch(() => null);
  if (!token?.accessToken) return null;

  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/git/trees/${encodeURIComponent(input.branch || "main")}?recursive=1`;
  const treeResponse = await fetch(treeUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  }).catch(() => null);

  if (!treeResponse?.ok) return null;
  const treePayload = (await treeResponse.json().catch(() => null)) as {
    tree?: Array<{ path?: string; type?: string }>;
    truncated?: boolean;
  } | null;
  if (!Array.isArray(treePayload?.tree)) return null;

  const normalizedFolder = input.folderPath.trim().replace(/^\/+|\/+$/g, "");
  const prefix = normalizedFolder ? `${normalizedFolder}/` : "";
  const files = treePayload.tree
    .filter((entry) => entry?.type === "blob" && typeof entry.path === "string")
    .map((entry) => String(entry.path))
    .filter((file) => !normalizedFolder || file === normalizedFolder || file.startsWith(prefix));

  const visibleFiles = files.slice(0, MAX_REPO_FILES);
  const sampledPaths = visibleFiles
    .filter((file) => REPO_SCAN_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .slice(0, MAX_REPO_SAMPLES);
  const sampledFiles: RepoSampleFile[] = [];

  for (const samplePath of sampledPaths) {
    const contentUrl = `https://api.github.com/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/contents/${samplePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(input.branch || "main")}`;
    const contentResponse = await fetch(contentUrl, {
      headers: {
        Accept: "application/vnd.github.raw",
        Authorization: `Bearer ${token.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }).catch(() => null);
    if (!contentResponse?.ok) continue;
    const content = await contentResponse.text().catch(() => "");
    sampledFiles.push({
      path: samplePath,
      excerpt: content.slice(0, MAX_REPO_EXCERPT_CHARS),
    });
  }

  const scanRoot = normalizedFolder
    ? `${parsedRepo.owner}/${parsedRepo.repo}/${normalizedFolder}`
    : `${parsedRepo.owner}/${parsedRepo.repo}`;

  return {
    repoRoot: `${parsedRepo.owner}/${parsedRepo.repo}`,
    scanRoot,
    fileCount: files.length,
    files: visibleFiles,
    sampledFiles,
    truncated: Boolean(treePayload.truncated) || files.length > MAX_REPO_FILES,
    source: "github",
  };
}

async function resolveScanRoot(repoUrl: string, folderPath: string): Promise<{ repoRoot: string; scanRoot: string }> {
  const repoRoot = await resolveRepoWorkdir(repoUrl);
  let baseScanRoot = repoRoot;
  const trimmedRepo = repoUrl.trim();

  if (trimmedRepo && !parseGitHubRepoUrl(trimmedRepo)) {
    const explicitRepoPath = trimmedRepo.startsWith("file://")
      ? (() => {
          try {
            return new URL(trimmedRepo).pathname;
          } catch {
            return "";
          }
        })()
      : trimmedRepo.startsWith("/")
        ? trimmedRepo
        : path.resolve(repoRoot, trimmedRepo);

    if (explicitRepoPath) {
      try {
        const details = await stat(explicitRepoPath);
        if (details.isDirectory()) {
          const relativeToRoot = path.relative(repoRoot, explicitRepoPath);
          if (!relativeToRoot.startsWith("..")) {
            baseScanRoot = explicitRepoPath;
          }
        }
      } catch {
        // keep repo root
      }
    }
  }

  const trimmedFolder = folderPath.trim();
  if (!trimmedFolder) {
    return { repoRoot, scanRoot: baseScanRoot };
  }

  const candidate = path.isAbsolute(trimmedFolder)
    ? trimmedFolder
    : path.resolve(baseScanRoot, trimmedFolder);

  try {
    const details = await stat(candidate);
    if (!details.isDirectory()) {
      return { repoRoot, scanRoot: baseScanRoot };
    }
    return { repoRoot, scanRoot: candidate };
  } catch {
    return { repoRoot, scanRoot: baseScanRoot };
  }
}

export async function collectRepoSnapshot(repoUrl: string, folderPath = "", branch = "main", workspaceId = ""): Promise<RepoSnapshot | null> {
  const githubSnapshot = await fetchGitHubRepoSnapshot({ workspaceId, repoUrl, branch, folderPath });
  if (githubSnapshot) {
    return githubSnapshot;
  }

  const { repoRoot, scanRoot } = await resolveScanRoot(repoUrl, folderPath);
  const files: string[] = [];
  const sampledFiles: RepoSampleFile[] = [];
  let truncated = false;

  const walk = async (dir: string) => {
    if (truncated) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (truncated) break;
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory() && REPO_SCAN_SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(scanRoot, absolutePath).replaceAll(path.sep, "/");

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!relativePath || relativePath.startsWith("..")) continue;

      files.push(relativePath);
      if (files.length >= MAX_REPO_SCAN_FILES) {
        truncated = true;
      }

      if (
        sampledFiles.length < MAX_REPO_SAMPLES &&
        REPO_SCAN_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        try {
          const content = await readFile(absolutePath, "utf8");
          sampledFiles.push({
            path: relativePath,
            excerpt: content.slice(0, MAX_REPO_EXCERPT_CHARS),
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  };

  try {
    await walk(scanRoot);
  } catch {
    return null;
  }

  return {
    repoRoot,
    scanRoot,
    fileCount: files.length,
    files: [...files]
      .sort((left, right) => {
        const byScore = fileOptionPriority(right) - fileOptionPriority(left);
        if (byScore !== 0) return byScore;
        return left.localeCompare(right);
      })
      .slice(0, MAX_REPO_FILES),
    sampledFiles,
    truncated,
    source: "local",
  };
}

export function formatRepoSnapshot(snapshot: RepoSnapshot | null): string {
  if (!snapshot) {
    return "Repo snapshot unavailable. Review the current repository using the task and repo metadata only.";
  }

  const fileList = snapshot.files.slice(0, 80).map((file) => `- ${file}`).join("\n");
  const samples = snapshot.sampledFiles
    .slice(0, 8)
    .map(
      (sample) =>
        `FILE: ${sample.path}\n---\n${(sample.excerpt.trim() || "(empty)").slice(0, 1200)}\n---`
    )
    .join("\n\n");

  return [
    `${snapshot.source === "github" ? "GitHub repository root" : "Local repository root"}: ${snapshot.repoRoot}`,
    `${snapshot.source === "github" ? "GitHub review scope" : "Review scope root"}: ${snapshot.scanRoot}`,
    `Indexed files: ${snapshot.fileCount}${snapshot.truncated ? " (truncated)" : ""}`,
    "Repository file list (first 80):",
    fileList || "- No files indexed",
    "",
    "Sampled file excerpts (first 8, trimmed):",
    samples || "No sample excerpts available.",
  ].join("\n");
}

function getProjectsRootCandidates(): string[] {
  return [
    trimEnv("CODE_REVIEW_ROOT"),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter(Boolean);
}

export async function listLocalRepos(): Promise<RepoOption[]> {
  for (const candidateRoot of getProjectsRootCandidates()) {
    try {
      const rootStats = await stat(candidateRoot);
      if (!rootStats.isDirectory()) continue;

      const entries = await readdir(candidateRoot, { withFileTypes: true });
      const repos: RepoOption[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const absolute = path.join(candidateRoot, entry.name);
        try {
          const gitStats = await stat(path.join(absolute, ".git"));
          if (!gitStats.isDirectory() && !gitStats.isFile()) continue;
          repos.push({
            id: `local:${absolute}`,
            label: entry.name,
            value: absolute,
            source: "local",
          });
        } catch {
          // skip non-git folders
        }
        if (repos.length >= MAX_LOCAL_REPOS) break;
      }

      if (repos.length > 0) {
        repos.sort((left, right) => left.label.localeCompare(right.label));
        return repos;
      }
    } catch {
      // try next root
    }
  }

  const fallback = await resolveRepoRoot("");
  return [
    {
      id: `local:${fallback}`,
      label: path.basename(fallback) || "Current repo",
      value: fallback,
      source: "local",
    },
  ];
}

export async function listFolderOptions(repoUrl: string): Promise<FolderOption[]> {
  if (parseGitHubRepoUrl(repoUrl)) {
    return [{ label: "Whole repository", value: "" }];
  }

  const { scanRoot } = await resolveScanRoot(repoUrl, "");
  const folders = new Set<string>([""]);

  const walk = async (dir: string, depth: number) => {
    if (depth > MAX_FOLDER_SCAN_DEPTH || folders.size >= MAX_FOLDER_OPTIONS) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (REPO_SCAN_SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(scanRoot, absolute).replaceAll(path.sep, "/");
      if (!relative || relative.startsWith("..")) continue;
      folders.add(relative);
      if (folders.size >= MAX_FOLDER_OPTIONS) break;
      await walk(absolute, depth + 1);
      if (folders.size >= MAX_FOLDER_OPTIONS) break;
    }
  };

  try {
    await walk(scanRoot, 1);
  } catch {
    return [{ label: "Whole repository", value: "" }];
  }

  return Array.from(folders)
    .sort((left, right) => left.localeCompare(right))
    .map((folder) => ({
      label: folder ? folder : "Whole repository",
      value: folder,
    }));
}

export async function listGitHubRepos(workspaceId: string): Promise<RepoOption[]> {
  const token = await loadStoredGitHubToken(workspaceId).catch(() => null);
  if (!token?.accessToken) return [];

  const response = await fetch("https://api.github.com/user/repos?per_page=30&sort=updated", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) return [];
  const payload = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(payload)) return [];

  const repos = payload
    .map((repo): RepoOption | null => {
      const fullName = typeof repo.full_name === "string" ? repo.full_name : "";
      const htmlUrl = typeof repo.html_url === "string" ? repo.html_url : "";
      if (!fullName || !htmlUrl) return null;
      return {
        id: `github:${fullName}`,
        label: fullName,
        value: htmlUrl,
        source: "github",
      };
    })
    .filter((item): item is RepoOption => item !== null);

  return repos;
}

export function trimEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function tokenizeTask(task: string): string[] {
  return task
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function extractPathCandidatesFromTask(task: string): string[] {
  const candidates = new Set<string>();
  const add = (raw: string) => {
    const normalized = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[),.;:!?]+$/g, "")
      .replace(/^\/+/, "");
    if (!normalized) return;
    if (!normalized.includes("/")) return;
    if (!/\.(ts|tsx|js|jsx|sql|css|scss|md|json)$/i.test(normalized)) return;
    candidates.add(normalized);
  };

  const codeBlockMatches = task.match(/`([^`]+)`/g) ?? [];
  for (const match of codeBlockMatches) {
    add(match.slice(1, -1));
  }

  const pathLikeMatches = task.match(/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9]+/g) ?? [];
  for (const match of pathLikeMatches) {
    add(match);
  }

  return Array.from(candidates);
}

function selectRelevantFiles(snapshot: RepoSnapshot | null, task: string): string[] {
  if (!snapshot) return [];
  const tokens = Array.from(new Set(tokenizeTask(task)));
  if (tokens.length === 0) {
    return snapshot.files.slice(0, 10);
  }

  const scored = snapshot.files.map((file) => {
    const lower = file.toLowerCase();
    const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
    return { file, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
    .slice(0, 12)
    .map((entry) => entry.file);
}

export async function inferTaskScopedFiles(repoUrl: string, snapshot: RepoSnapshot | null, task: string): Promise<string[]> {
  if (!snapshot) return [];
  const lowerTask = task.toLowerCase();
  const candidates = new Set<string>();
  const repoRoot = await resolveRepoWorkdir(repoUrl);

  const addIfExists = async (file: string) => {
    if (snapshot.files.includes(file)) {
      candidates.add(file);
      return;
    }
    const absolute = path.resolve(repoRoot, file);
    if (await pathExists(absolute)) {
      candidates.add(file);
    }
  };

  const explicitPathHints = extractPathCandidatesFromTask(task);
  for (const hintedPath of explicitPathHints) {
    await addIfExists(hintedPath);
  }

  if (
    /menu|menü|dropdown|profile|profil|account|konto|oben rechts|top right|user menu|identity menu/.test(lowerTask)
  ) {
    await addIfExists("frontend/components/os/shell/IdentityMenu.tsx");
    await addIfExists("components/os/shell/IdentityMenu.tsx");
  }

  if (/intent|input|ask elli|prompt|composer/.test(lowerTask)) {
    await addIfExists("frontend/components/os/shell/IntentLine.tsx");
    await addIfExists("components/os/shell/IntentLine.tsx");
  }

  if (/right rail|ai dock|actions rail|sidebar/.test(lowerTask)) {
    await addIfExists("frontend/components/agent/AIDock.tsx");
    await addIfExists("components/agent/AIDock.tsx");
  }

  if (/weather|wetter|surf|forecast|leserlich|readable|contrast/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/weather/WeatherWindow.tsx");
    await addIfExists("components/os/apps/weather/WeatherWindow.tsx");
  }

  if (/api-gateway|legacy gateway|elly|elyra-os|dead code|deprecated gateway/.test(lowerTask)) {
    await addIfExists("api-gateway/server.js");
    await addIfExists("package.json");
    await addIfExists("README.md");
    await addIfExists("REFACTORING_REPORT.md");
  }

  if (/token_encryption_key|encryption key|integration_tokens|oauth token|scope column|google-auth/.test(lowerTask)) {
    await addIfExists("backend/ai-service/src/config.ts");
    await addIfExists("backend/ai-service/src/tools/google-auth.ts");
    await addIfExists("backend/ai-service/src/db/migrations/0007_integrations.sql");
    await addIfExists("backend/ai-service/src/db/migrations/0011_integration_tokens_scope_array.sql");
    await addIfExists("backend/ai-service/src/lib/crypto.ts");
  }

  if (candidates.size > 0) return Array.from(candidates).slice(0, 12);
  return selectRelevantFiles(snapshot, task).slice(0, 12);
}

export async function inferTaskScopedFilesFast(repoUrl: string, task: string): Promise<string[]> {
  const lowerTask = task.toLowerCase();
  const candidates = new Set<string>();
  const repoRoot = await resolveRepoWorkdir(repoUrl);

  const addIfExists = async (file: string) => {
    const normalized = file.replace(/^\/+/, "");
    const variants = new Set<string>([normalized]);
    if (normalized.startsWith("frontend/")) {
      variants.add(normalized.slice("frontend/".length));
    } else {
      variants.add(`frontend/${normalized}`);
    }
    for (const variant of variants) {
      if (await pathExists(path.resolve(repoRoot, variant))) {
        candidates.add(variant);
        return;
      }
    }
  };

  const explicitPathHints = extractPathCandidatesFromTask(task);
  for (const hintedPath of explicitPathHints) {
    await addIfExists(hintedPath);
  }

  if (/menu|menü|dropdown|profile|profil|account|konto|oben rechts|top right|user menu|identity menu/.test(lowerTask)) {
    await addIfExists("frontend/components/os/shell/IdentityMenu.tsx");
  }
  if (/intent|input|ask elli|prompt|composer/.test(lowerTask)) {
    await addIfExists("frontend/components/os/shell/IntentLine.tsx");
  }
  if (/right rail|ai dock|actions rail|sidebar/.test(lowerTask)) {
    await addIfExists("frontend/components/agent/AIDock.tsx");
  }
  if (/weather|wetter|surf|forecast|leserlich|readable|contrast/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/weather/WeatherWindow.tsx");
  }
  if (/builder|workflow builder|automation builder|canvas/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/builder/BuilderWindow.tsx");
  }
  if (/mail|email/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/mail/MailWindow.tsx");
  }
  if (/calendar|kalender/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/calendar/CalendarWindow.tsx");
  }
  if (/task|todo|aufgabe/.test(lowerTask)) {
    await addIfExists("frontend/components/os/apps/tasks/TasksWindow.tsx");
  }

  return Array.from(candidates).slice(0, 12);
}

export async function normalizeSelectedFilesForRepo(repoUrl: string, files: string[]): Promise<string[]> {
  if (files.length === 0) return [];
  const repoRoot = await resolveRepoWorkdir(repoUrl);
  const normalizedFiles = new Set<string>();

  for (const file of files) {
    const trimmed = file.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!trimmed) continue;
    const variants = new Set<string>([trimmed]);
    if (trimmed.startsWith("frontend/")) {
      variants.add(trimmed.slice("frontend/".length));
    } else {
      variants.add(`frontend/${trimmed}`);
    }
    for (const variant of variants) {
      if (await pathExists(path.resolve(repoRoot, variant))) {
        normalizedFiles.add(variant);
        break;
      }
    }
  }

  return Array.from(normalizedFiles).slice(0, 12);
}

export async function correctStaleUiScopeForTask(input: {
  repoUrl: string;
  task: string;
  selectedFiles: string[];
}): Promise<string[]> {
  if (input.selectedFiles.length === 0) return [];
  const lowerTask = input.task.toLowerCase();
  const identityMenuFocusedTask =
    /menu|menü|dropdown|profile|profil|account|konto/.test(lowerTask) &&
    !/launcher|launchpad|app launcher|overlay|dock|desktop|elypanel|artifact/i.test(lowerTask);

  if (identityMenuFocusedTask && !input.selectedFiles.some((file) => /IdentityMenu\.tsx$/i.test(file))) {
    const inferred = await inferTaskScopedFilesFast(input.repoUrl, input.task);
    const correctedFiles = inferred.filter((file) => /IdentityMenu\.tsx$/i.test(file));
    if (correctedFiles.length > 0) return correctedFiles;
  }

  return input.selectedFiles;
}

export function looksLikeFrontendUiFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  if (!(normalized.endsWith(".tsx") || normalized.endsWith(".ts") || normalized.endsWith(".css") || normalized.endsWith(".scss"))) {
    return false;
  }
  if (normalized.includes("/api/")) return false;
  if (normalized.includes("/backend/")) return false;
  return (
    normalized.startsWith("frontend/") ||
    normalized.startsWith("components/") ||
    normalized.startsWith("app/")
  );
}

export async function inferUxUiDesignScopedFiles(repoUrl: string, snapshot: RepoSnapshot | null, task: string): Promise<string[]> {
  if (!snapshot) return [];
  const repoRoot = await resolveRepoRoot(repoUrl);
  const candidates = new Set<string>();
  const lowerTask = task.toLowerCase();
  const tokens = tokenizeTask(task);
  const identityMenuFocusedTask =
    /menu|menü|dropdown|profile|profil|account|konto/.test(lowerTask) &&
    !/launcher|launchpad|app launcher|overlay|dock|desktop|elypanel|artifact/i.test(lowerTask);

  const tryAdd = async (file: string) => {
    if (candidates.size >= 12) return;
    if (!looksLikeFrontendUiFile(file)) return;
    if (snapshot.files.includes(file)) {
      candidates.add(file);
      return;
    }
    const absolute = path.resolve(repoRoot, file);
    if (await pathExists(absolute)) {
      candidates.add(file);
    }
  };

  // Task-specific seeds first.
  const inferredTaskScoped = await inferTaskScopedFiles(repoUrl, snapshot, task);
  for (const file of inferredTaskScoped) {
    await tryAdd(file);
  }

  if (/menu|menü|profile|konto|account|dropdown/.test(lowerTask)) {
    await tryAdd("frontend/components/os/shell/IdentityMenu.tsx");
    await tryAdd("components/os/shell/IdentityMenu.tsx");
  }
  if (/weather|wetter|surf|forecast/.test(lowerTask)) {
    await tryAdd("frontend/components/os/apps/weather/WeatherWindow.tsx");
    await tryAdd("components/os/apps/weather/WeatherWindow.tsx");
  }
  if (/mail|email/.test(lowerTask)) {
    await tryAdd("frontend/components/os/apps/mail/MailWindow.tsx");
    await tryAdd("components/os/apps/mail/MailWindow.tsx");
  }
  if (/calendar|kalender/.test(lowerTask)) {
    await tryAdd("frontend/components/os/apps/calendar/CalendarWindow.tsx");
    await tryAdd("components/os/apps/calendar/CalendarWindow.tsx");
  }

  if (identityMenuFocusedTask && candidates.size > 0) {
    return Array.from(candidates).slice(0, 12);
  }

  // Fill with best frontend UI matches from snapshot.
  const ranked = snapshot.files
    .filter((file) => looksLikeFrontendUiFile(file))
    .map((file) => {
      const normalized = file.toLowerCase();
      let score = fileOptionPriority(file);
      score += normalized.includes("/components/") ? 30 : 0;
      score += normalized.includes("/os/") ? 25 : 0;
      score += normalized.includes("/shell/") ? 22 : 0;
      score += normalized.includes("/apps/") ? 18 : 0;
      score += normalized.includes("window") ? 10 : 0;
      score += tokens.reduce((acc, token) => acc + (normalized.includes(token) ? 16 : 0), 0);
      return { file, score };
    })
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  for (const entry of ranked) {
    if (candidates.size >= 12) break;
    candidates.add(entry.file);
  }

  return Array.from(candidates).slice(0, 12);
}

export async function inferUxUiDesignScopedFilesFast(repoUrl: string, task: string): Promise<string[]> {
  return inferTaskScopedFilesFast(repoUrl, task);
}

export function looksLikeUiStylingTask(task: string): boolean {
  const lowerTask = task.toLowerCase();
  return /menu|menü|dropdown|profil|profile|account|konto|ui|layout|spacing|overlap|window|panel|builder|workflow|canvas|farbe|color|grün|gruen|green|gelb|yellow|dunkel|hell|weather|wetter|surf|leserlich|readable|contrast/.test(lowerTask);
}

export function shouldRequireScopedExecutionForTask(task: string, skill: CodingSkill, role: AgentRole): boolean {
  return (
    skill === "ux-ui-design" ||
    role === "ui" ||
    looksLikeUiStylingTask(task) ||
    /(frontend|component|tsx|css|scss|weather app|mail app|calendar app|tasks app|builder app|intent line|intentline)/i.test(task)
  );
}

export function looksLikeRepoReviewOnlyTask(task: string): boolean {
  const lowerTask = task.toLowerCase();
  const reviewWords =
    /(scan|scanne|audit|prüf|pruef|inspect|insiziere|review|analys|analyse|fehler|issues|risks|probleme|biggest|größte|groesste|grässte|gruesste|top\s*\d+|nenne|list|find)/.test(
      lowerTask
    );
  const repositoryTarget =
    /(repo|repository|project|projekt|codebase|code|app|weather app|mail app|calendar app|tasks app|builder app|weatherwindow|component)/.test(
      lowerTask
    );
  const explicitNoEdit =
    /(before you change|before changing|before editing|bevor du etwas änderst|bevor du etwas aenderst|bevor du änderst|bevor du aenderst|ohne zu ändern|ohne zu aendern|vor dem ändern|vor dem aendern)/.test(
      lowerTask
    );
  const reviewIntent = (reviewWords && repositoryTarget) || explicitNoEdit;

  // Use word boundaries so "building" / "rebuilding" / "codebase" don't accidentally trigger editIntent.
  const editIntent =
    /(implement|refactor|\bfix\b|\bpatch\b|\bchange\b|ändere|aendere|rewrite|redesign|\bbuild\b|\bcreate\b|erstelle|\bupdate\b|anpassen|umsetzen|write code)/.test(
      lowerTask
    );

  return explicitNoEdit || (reviewIntent && !editIntent);
}

export function formatRealPathHints(snapshot: RepoSnapshot | null, task: string): string {
  const relevant = selectRelevantFiles(snapshot, task);
  if (relevant.length === 0) {
    return "Use only real file paths from the repository snapshot. Do not invent component or CSS file paths.";
  }
  return [
    "Use only real file paths from this repository. Do not invent file paths.",
    "Prefer these candidate files when preparing changes:",
    ...relevant.map((file) => `- ${file}`),
  ].join("\n");
}

export function fileOptionPriority(file: string): number {
  let score = 0;
  if (file.startsWith("frontend/")) score += 80;
  if (file.includes("/components/")) score += 40;
  if (file.includes("/app/")) score += 30;
  if (file.includes("/api/")) score += 20;
  if (file.endsWith(".tsx")) score += 18;
  if (file.endsWith(".ts")) score += 14;
  if (file.endsWith(".css") || file.endsWith(".scss")) score += 12;
  if (file.includes("/os/")) score += 10;
  return score;
}

export function buildSelectedFileHints(selectedFiles: string[]): string {
  if (selectedFiles.length === 0) return "";
  return [
    "Restrict all proposed changes to this explicit allowlist of files:",
    ...selectedFiles.map((file) => `- ${file}`),
    "Do not modify or reference files outside this allowlist.",
  ].join("\n");
}

export async function buildSelectedFileGroundTruth(repoUrl: string, selectedFiles: string[]): Promise<string> {
  if (selectedFiles.length === 0) return "";
  const repoPath = repoUrl.split("#")[0]?.trim() || repoUrl;
  const repoRoot = await resolveRepoRoot(repoPath);
  const chunks: string[] = [];

  for (const relPath of selectedFiles.slice(0, 4)) {
    const absPath = path.resolve(repoRoot, relPath);
    if (!(await pathExists(absPath))) continue;
    try {
      const content = await readFile(absPath, "utf8");
      chunks.push(
        [
          `FILE: ${relPath}`,
          "----- BEGIN FILE -----",
          content.slice(0, 2200),
          "----- END FILE -----",
        ].join("\n")
      );
    } catch {
      // ignore unreadable file
    }
  }

  if (chunks.length === 0) return "";
  return [
    "Ground-truth file content (must match exact framework/styles already used in repo):",
    ...chunks,
    "Never introduce a different component system if the file content does not use it.",
  ].join("\n\n");
}

export function diffTouchedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim();
      if (!value || value === "/dev/null") continue;
      files.add(value.replace(/^b\//, ""));
    } else if (line.startsWith("--- ")) {
      const value = line.slice(4).trim();
      if (!value || value === "/dev/null") continue;
      files.add(value.replace(/^a\//, ""));
    }
  }
  return Array.from(files);
}
