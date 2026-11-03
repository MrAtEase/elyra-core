import { promises as fs } from "node:fs";
import path from "node:path";
import { FileMeta } from "./fileCrawler";
import { AstSummary } from "./astParser";

export type CachedAnalysis = {
  files: FileMeta[];
  summaries: Record<string, AstSummary>;
  graph: unknown;
  generatedAt: string;
};

const CACHE_PATH = path.resolve(__dirname, "..", ".cache", "project-analysis.json");

export async function loadCache(): Promise<CachedAnalysis | null> {
  try {
    const json = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(json) as CachedAnalysis;
  } catch {
    return null;
  }
}

export async function saveCache(cache: CachedAnalysis): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

export function diffFiles(current: FileMeta[], cached: CachedAnalysis | null): {
  changed: FileMeta[];
  unchangedSummaries: Record<string, AstSummary>;
} {
  if (!cached) return { changed: current, unchangedSummaries: {} };
  const cachedMap = new Map(cached.files.map((f) => [f.path, f]));
  const unchangedSummaries: Record<string, AstSummary> = {};
  const changed: FileMeta[] = [];
  current.forEach((meta) => {
    const prev = cachedMap.get(meta.path);
    if (prev && prev.hash === meta.hash) {
      const summary = cached.summaries[meta.path];
      if (summary) unchangedSummaries[meta.path] = summary;
      return;
    }
    changed.push(meta);
  });
  return { changed, unchangedSummaries };
}
