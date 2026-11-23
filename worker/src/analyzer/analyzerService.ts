import path from "node:path";
import { crawlFiles, FileMeta } from "./fileCrawler";
import { parseSource, AstSummary } from "./astParser";
import { buildGraph, DependencyGraph } from "./graphBuilder";
import { loadCache, saveCache, diffFiles } from "./projectCache";
import { createLogger } from "../logger";
import { promises as fs } from "node:fs";

const log = createLogger("Analyzer");
let cachedAnalysis: {
  files: FileMeta[];
  summaries: Record<string, AstSummary>;
  graph: DependencyGraph;
  generatedAt: string;
} | null = null;

async function readFileContent(root: string, relPath: string): Promise<string> {
  const full = path.resolve(root, relPath);
  return fs.readFile(full, "utf8");
}

export async function analyzeProject(root = path.resolve(__dirname, "..", "..")): Promise<{
  files: FileMeta[];
  graph: DependencyGraph;
  summaries: Record<string, AstSummary>;
  generatedAt: string;
}> {
  if (cachedAnalysis) return cachedAnalysis;

  log.info("[Analyzer] Starting project analysis...");
  const files = await crawlFiles(root);
  const cache = await loadCache();
  const { changed, unchangedSummaries } = diffFiles(files, cache);
  const summaries: Record<string, AstSummary> = { ...unchangedSummaries };

  for (const meta of changed) {
    const content = await readFileContent(root, meta.path);
    summaries[meta.path] = parseSource(meta.path, content);
  }

  const graph = buildGraph(files, summaries);
  const generatedAt = new Date().toISOString();
  cachedAnalysis = { files, graph, summaries, generatedAt };
  await saveCache({
    files,
    summaries,
    graph,
    generatedAt,
  });
  log.info("[Analyzer] Project analysis completed. Files:", files.length);
  return cachedAnalysis;
}

export function getFileInfo(relPath: string) {
  if (!cachedAnalysis) return null;
  return cachedAnalysis.files.find((f) => f.path === relPath) || null;
}

export function getGraph(): DependencyGraph | null {
  return cachedAnalysis?.graph || null;
}

export function getSymbolIndex(): Record<string, AstSummary> | null {
  return cachedAnalysis?.summaries || null;
}

export function findComponent(name: string): string[] {
  if (!cachedAnalysis) return [];
  return Object.entries(cachedAnalysis.summaries)
    .filter(([, sum]) => sum.symbols.some((s) => s.kind === "component" && s.name === name))
    .map(([file]) => file);
}
