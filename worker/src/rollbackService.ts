import fs from "node:fs/promises";
import path from "node:path";
import type { DevTaskBackupInfo } from "./devTaskTypes";

export interface BackupSnapshotSummary {
  id: string;
  createdAt: string;
  sessionId?: string;
  taskId?: string;
  files: string[];
  path: string;
}

export interface RestoreOptions {
  dryRun?: boolean;
}

export interface RestoreResult {
  backupId: string;
  restoredFiles: string[];
}

async function collectFiles(dir: string, base: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, base);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(path.relative(base, fullPath));
    }
  }
  return files;
}

function normalizeTimestampFromId(id: string): string {
  const base = path.basename(id);
  const normalized = base.replace(
    /T(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?Z?)/,
    (_m, hh, mm, rest) => `T${hh}:${mm}:${rest}`
  );
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export async function listBackups(projectRoot: string): Promise<BackupSnapshotSummary[]> {
  const backupRoot = path.join(projectRoot, ".autopilot-backup");
  try {
    const entries = await fs.readdir(backupRoot, { withFileTypes: true });
    const summaries: BackupSnapshotSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(backupRoot, entry.name);
      const files = await collectFiles(dirPath, dirPath);
      const id = path.relative(projectRoot, dirPath);
      const createdAt = normalizeTimestampFromId(entry.name);
      summaries.push({
        id,
        createdAt,
        files: files.map((f) => path.relative("", f)),
        path: dirPath,
      });
    }
    return summaries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function restoreBackup(
  projectRoot: string,
  backupId: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const backupPath = path.isAbsolute(backupId)
    ? backupId
    : path.join(projectRoot, backupId);
  const stat = await fs.stat(backupPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const files = await collectFiles(backupPath, backupPath);
  const restoredFiles: string[] = [];
  for (const relativeFile of files) {
    const sourcePath = path.join(backupPath, relativeFile);
    const targetPath = path.join(projectRoot, relativeFile);
    if (!options.dryRun) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
    restoredFiles.push(relativeFile);
  }

  return {
    backupId,
    restoredFiles,
  };
}

export function backupInfoFromResult(backup: DevTaskBackupInfo | null | undefined): BackupSnapshotSummary | null {
  if (!backup) return null;
  return {
    id: backup.id,
    createdAt: normalizeTimestampFromId(path.basename(backup.id)),
    files: backup.files,
    path: backup.rootDir,
  };
}
