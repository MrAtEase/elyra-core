import { promises as fs, Dirent } from "node:fs";
import path from "node:path";
import { createLogger } from "./logger";

export type GraphFileKind = "page" | "layout" | "component" | "hook" | "api" | "util" | "other";

export interface GraphSymbol {
  name: string;
  type: "function" | "component" | "hook" | "type" | "const" | "class" | "other";
  location: { line: number; column: number } | null;
}

export interface GraphImport {
  source: string;
  specifiers: string[];
}

export interface GraphFile {
  id: string;
  path: string;
  kind: GraphFileKind;
  exports: GraphSymbol[];
  imports: GraphImport[];
}

export interface ProjectGraph {
  files: GraphFile[];
  generatedAt: string;
}

export interface GraphSearchMatch {
  file: GraphFile;
  matchedSymbols: GraphSymbol[];
  matchedImports: GraphImport[];
}

const log = createLogger("ProjectGraph");

const DEFAULT_DIRS = ["frontend/app", "frontend/lib", "frontend/components", "worker/src"];
const DEFAULT_EXTS = [".ts", ".tsx", ".js", ".jsx"];

let cachedGraph: ProjectGraph | null = null;
let cachedRoot: string | null = null;

function detectKind(relPath: string, ext: string, content: string): GraphFileKind {
  const parts = relPath.split(path.sep);
  if (relPath.includes(`${path.sep}app${path.sep}`) && /page\.(t|j)sx?$/.test(relPath)) return "page";
  if (relPath.includes(`${path.sep}app${path.sep}`) && /layout\.(t|j)sx?$/.test(relPath)) return "layout";
  if (relPath.includes(`${path.sep}api${path.sep}`)) return "api";
  if (relPath.includes(`${path.sep}hooks${path.sep}`) || /use[A-Z]/.test(path.basename(relPath))) return "hook";
  if (ext === ".tsx" || ext === ".jsx") {
    if (/\bexport\s+default\s+function\s+[A-Z]/.test(content) || /\bconst\s+[A-Z][A-Za-z0-9]*\s*=\s*\(/.test(content)) {
      return "component";
    }
  }
  if (relPath.includes(`${path.sep}utils${path.sep}`) || relPath.includes(`${path.sep}lib${path.sep}`)) return "util";
  return "other";
}

function extractImports(content: string): GraphImport[] {
  const regex = /import\s+([^;]+)\s+from\s+['"]([^'"]+)['"]/g;
  const imports: GraphImport[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    const specRaw = match[1];
    const source = match[2];
    const specifiers = specRaw
      .replace(/\{|\}/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    imports.push({ source, specifiers });
  }
  return imports;
}

function extractExports(content: string): GraphSymbol[] {
  const symbols: GraphSymbol[] = [];
  const patterns: Array<{ regex: RegExp; type: GraphSymbol["type"] }> = [
    { regex: /export\s+function\s+([A-Za-z0-9_]+)/g, type: "function" },
    { regex: /export\s+class\s+([A-Za-z0-9_]+)/g, type: "class" },
    { regex: /export\s+type\s+([A-Za-z0-9_]+)/g, type: "type" },
    { regex: /export\s+const\s+([A-Za-z0-9_]+)/g, type: "const" },
  ];
  patterns.forEach(({ regex, type }) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      symbols.push({ name: m[1], type, location: null });
    }
  });
  const defaultComponent = content.match(/export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/);
  if (defaultComponent) symbols.push({ name: defaultComponent[1], type: "component", location: null });
  return symbols;
}

async function readFileSafe(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const limitDirs = DEFAULT_DIRS.map((d) => path.resolve(root, d));

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (DEFAULT_EXTS.includes(ext)) {
          files.push(full);
        }
      }
    }
  }

  for (const base of limitDirs) {
    await walk(base);
  }

  return files;
}

export async function buildProjectGraph(projectRoot: string): Promise<ProjectGraph> {
  const normalizedRoot = path.resolve(projectRoot);
  const files = await collectFiles(normalizedRoot);
  const graphFiles: GraphFile[] = [];

  for (const abs of files) {
    const rel = path.relative(normalizedRoot, abs).replace(/\\/g, "/");
    const content = await readFileSafe(abs);
    const ext = path.extname(abs);
    const kind = detectKind(rel, ext, content);
    const imports = extractImports(content);
    const exports = extractExports(content);
    graphFiles.push({
      id: rel,
      path: rel,
      kind,
      imports,
      exports,
    });
  }

  const graph: ProjectGraph = {
    files: graphFiles,
    generatedAt: new Date().toISOString(),
  };

  cachedGraph = graph;
  cachedRoot = normalizedRoot;
  log.info(`[ProjectGraph] Built graph with ${graphFiles.length} files`);
  return graph;
}

export async function getProjectGraph(projectRoot: string, options?: { forceRefresh?: boolean }): Promise<ProjectGraph> {
  const normalizedRoot = path.resolve(projectRoot);
  if (!options?.forceRefresh && cachedGraph && cachedRoot === normalizedRoot) {
    return cachedGraph;
  }
  return buildProjectGraph(normalizedRoot);
}

export function searchProjectGraph(graph: ProjectGraph, query: string): GraphSearchMatch[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const matches: GraphSearchMatch[] = [];

  for (const file of graph.files) {
    const matchedSymbols = file.exports.filter((sym) => sym.name.toLowerCase().includes(needle));
    const matchedImports = file.imports.filter(
      (imp) =>
        imp.source.toLowerCase().includes(needle) ||
        imp.specifiers.some((s) => s.toLowerCase().includes(needle))
    );
    const pathHit = file.path.toLowerCase().includes(needle);
    if (matchedSymbols.length || matchedImports.length || pathHit) {
      matches.push({
        file,
        matchedSymbols,
        matchedImports,
      });
    }
  }

  return matches;
}
