import { promises as fs } from "fs";
import path from "path";
import { promises as fsp } from "node:fs";

export interface ListFilesOptions {
  exts?: string[];
  ignorePatterns?: string[];
}

export interface ListProjectFilesOptions {
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxDepth?: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchOptions {
  roots?: string[];
  caseSensitive?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxDepth?: number;
  glob?: string;
  maxResults?: number;
}

export interface BackupSnapshot {
  timestamp: string;
  rootDir: string;
  files: string[];
  backupDir: string;
}

function shouldIgnore(relativePath: string, ignorePatterns?: string[]): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  return ignorePatterns.some((pattern) => relativePath.includes(pattern));
}

function toPosix(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/([.+^=!:${}()|[\]\\])/g, "\\$1")
    .replace(/\*\*/g, "§§DOUBLESTAR§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§DOUBLESTAR§§/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function matchesGlobs(relativePath: string, globs?: string[]): boolean {
  if (!globs || globs.length === 0) return true;
  const posixPath = toPosix(relativePath);
  return globs.some((glob) => globToRegExp(glob).test(posixPath));
}

export async function listFiles(root: string, pattern?: string): Promise<string[]> {
  const normalizedRoot = path.resolve(root);
  const includeGlobs = pattern ? [pattern] : undefined;
  return listProjectFiles(normalizedRoot, { includeGlobs });
}

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/.DS_Store",
  "**/out/**",
  "**/build/**",
];

export async function listProjectFiles(
  root: string,
  options: ListProjectFilesOptions = {}
): Promise<string[]> {
  const { includeGlobs, excludeGlobs = DEFAULT_EXCLUDES, maxDepth } = options;
  const normalizedRoot = path.resolve(root);
  const results: string[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (maxDepth !== undefined && depth > maxDepth) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(normalizedRoot, fullPath) || entry.name;
      const relPosix = toPosix(relativePath);

      if (!matchesGlobs(relPosix, includeGlobs)) {
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
        continue;
      }
      if (matchesGlobs(relPosix, excludeGlobs)) {
        if (entry.isDirectory()) continue;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await walk(normalizedRoot, 0);
  return results;
}

export async function readFileUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function ensureInsideRoot(root: string, target: string): void {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, target);
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${target}`);
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFileUtf8(filePath);
}

export async function readFileSafe(root: string, relativePath: string): Promise<string> {
  ensureInsideRoot(root, relativePath);
  const fullPath = path.resolve(root, relativePath);
  return readFileUtf8(fullPath);
}

export async function writeFileUtf8(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function searchInFiles(
  root: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchMatch[]> {
  if (!query) throw new Error("Query must not be empty");

  const normalizedRoot = path.resolve(root);
  const roots = options.roots && options.roots.length > 0 ? options.roots : [normalizedRoot];
  const files = (
    await Promise.all(
      roots.map((r) =>
        listProjectFiles(r, {
          includeGlobs: options.glob ? [options.glob] : options.includeGlobs,
          excludeGlobs: options.excludeGlobs,
          maxDepth: options.maxDepth,
        })
      )
    )
  ).flat();
  const matches: SearchMatch[] = [];
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const maxResults = options.maxResults ?? 200;

  for (const file of files) {
    ensureInsideRoot(normalizedRoot, file);
    const content = await readFileUtf8(file);
    const haystack = options.caseSensitive ? content : content.toLowerCase();
    const lines = haystack.split(/\r?\n/);
    const previewLines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const lineContent = lines[i];
      let searchIndex = 0;

      while (searchIndex <= lineContent.length) {
        const hitIndex = lineContent.indexOf(needle, searchIndex);
        if (hitIndex === -1) break;

        matches.push({
          file: path.relative(normalizedRoot, file),
          line: i + 1,
          column: hitIndex + 1,
          preview: previewLines[i],
        });

        searchIndex = hitIndex + Math.max(1, query.length);
        if (matches.length >= maxResults) {
          return matches;
        }
      }
    }
  }

  return matches;
}

export async function createBackupForFiles(rootDir: string, files: string[]): Promise<BackupSnapshot> {
  const normalizedRoot = path.resolve(rootDir);
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const backupDir = path.join(normalizedRoot, ".autopilot-backup", timestamp);
  const uniqueFiles = Array.from(new Set(files));

  for (const rel of uniqueFiles) {
    ensureInsideRoot(normalizedRoot, rel);
    const sourcePath = path.join(normalizedRoot, rel);
    const targetPath = path.join(backupDir, rel);
    const content = await fsp.readFile(sourcePath, "utf8").catch(() => null);
    if (content === null) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, content, "utf8");
  }

  return {
    timestamp,
    rootDir: normalizedRoot,
    files: uniqueFiles,
    backupDir,
  };
}

export async function restoreBackupSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const { rootDir, backupDir, files } = snapshot;
  for (const rel of files) {
    const backupPath = path.join(backupDir, rel);
    const targetPath = path.join(rootDir, rel);
    const content = await fsp.readFile(backupPath, "utf8").catch(() => null);
    if (content === null) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, content, "utf8");
  }
}
