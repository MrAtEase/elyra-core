import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type FileMeta = {
  path: string;
  ext: string;
  size: number;
  mtimeMs: number;
  hash: string;
};

const DEFAULT_EXTS = [".ts", ".tsx", ".js", ".jsx", ".json"];
const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  ".autopilot-backup",
];

function normalizeIgnores(root: string, gitignore: string | null): string[] {
  const patterns = [...DEFAULT_IGNORES];
  if (gitignore) {
    gitignore
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .forEach((p) => patterns.push(p));
  }
  return patterns.map((p) => p.replace(/\/+$/, ""));
}

function shouldIgnore(relPath: string, ignores: string[]): boolean {
  return ignores.some((p) => {
    if (p.includes("*")) {
      const regex = new RegExp(
        "^" +
          p
            .split("*")
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$"
      );
      return regex.test(relPath);
    }
    return relPath === p || relPath.startsWith(`${p}/`);
  });
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function crawlFiles(root: string): Promise<FileMeta[]> {
  const normalizedRoot = path.resolve(root);
  const gitignorePath = path.join(normalizedRoot, ".gitignore");
  const gitignore = await fs.readFile(gitignorePath, "utf8").catch(() => null);
  const ignores = normalizeIgnores(normalizedRoot, gitignore);
  const files: FileMeta[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const rel = path.relative(normalizedRoot, fullPath);
      if (shouldIgnore(rel, ignores)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!DEFAULT_EXTS.includes(ext)) continue;
      const stat = await fs.stat(fullPath);
      const hash = await hashFile(fullPath);
      files.push({
        path: rel,
        ext,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash,
      });
    }
  }

  await walk(normalizedRoot);
  return files;
}
