import path from "node:path";
import { AstSummary } from "./astParser";
import { FileMeta } from "./fileCrawler";

export type DependencyGraph = {
  nodes: Record<
    string,
    {
      imports: string[];
      exports: string[];
      symbols: string[];
      size: number;
    }
  >;
  issues: {
    circular?: string[][];
    missing?: { file: string; target: string }[];
    orphans?: string[];
    hotspots?: string[];
    untyped?: string[];
  };
};

function resolveImport(baseFile: string, source: string, allFiles: Set<string>): string | null {
  if (!source.startsWith(".")) return null;
  const baseDir = path.dirname(baseFile);
  const candidateBase = path.resolve(baseDir, source);
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];
  for (const ext of exts) {
    const rel = path.relative(process.cwd(), `${candidateBase}${ext}`);
    if (allFiles.has(rel)) return rel;
  }
  return null;
}

export function buildGraph(files: FileMeta[], summaries: Record<string, AstSummary>): DependencyGraph {
  const nodes: DependencyGraph["nodes"] = {};
  const allFiles = new Set(files.map((f) => f.path));

  files.forEach((meta) => {
    const summary = summaries[meta.path];
    nodes[meta.path] = {
      imports: summary?.imports
        .map((imp) => resolveImport(path.resolve(process.cwd(), meta.path), imp.source, allFiles) || imp.source)
        .filter(Boolean) as string[],
      exports: summary?.exports.map((e) => e.name) || [],
      symbols: summary?.symbols.map((s) => s.name) || [],
      size: meta.size,
    };
  });

  // missing
  const missing: { file: string; target: string }[] = [];
  Object.entries(nodes).forEach(([file, data]) => {
    data.imports.forEach((imp) => {
      if (imp.startsWith(".") && !allFiles.has(imp)) {
        missing.push({ file, target: imp });
      }
    });
  });

  // circular (simple DFS)
  const visited = new Set<string>();
  const stack: string[] = [];
  const circular: string[][] = [];

  function dfs(node: string): void {
    if (stack.includes(node)) {
      const idx = stack.indexOf(node);
      circular.push(stack.slice(idx).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    (nodes[node]?.imports || [])
      .filter((i) => allFiles.has(i))
      .forEach((child) => dfs(child));
    stack.pop();
  }
  Object.keys(nodes).forEach((n) => dfs(n));

  // orphans: no incoming edges
  const incomingCount: Record<string, number> = {};
  Object.keys(nodes).forEach((n) => (incomingCount[n] = 0));
  Object.values(nodes).forEach((data) => {
    data.imports.forEach((imp) => {
      if (incomingCount[imp] !== undefined) incomingCount[imp] += 1;
    });
  });
  const orphans = Object.entries(incomingCount)
    .filter(([, cnt]) => cnt === 0)
    .map(([f]) => f);

  const hotspots = files.filter((f) => f.size > 150 * 1024).map((f) => f.path);
  const untyped = files.filter((f) => f.ext === ".js" || f.ext === ".jsx").map((f) => f.path);

  return {
    nodes,
    issues: { circular, missing, orphans, hotspots, untyped },
  };
}
