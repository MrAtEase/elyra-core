/**
 * Coding agent – Read-only repository investigation helpers.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { geminiCliEnv } from "@/lib/code-agent/providers";

async function execReviewShell(cwd: string, command: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "bash",
      ["-lc", command],
      {
        cwd,
        env: geminiCliEnv(),
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr?.trim() || error.message || "Review shell command failed.").trim()));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function normalizeRelativeDotPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("./") ? trimmed : `./${trimmed.replace(/^\/+/, "")}`;
}

async function listFolderSummary(repoRoot: string, relativeDir: string, limit = 12): Promise<string> {
  const absolute = path.join(repoRoot, relativeDir);
  if (!existsSync(absolute)) return "";
  const stats = await stat(absolute).catch(() => null);
  if (!stats?.isDirectory()) return "";
  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .slice(0, limit)
    .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`)
    .join("\n");
}

export async function buildRepoInvestigationContext(input: {
  repoRoot: string;
  task: string;
  selectedFiles: string[];
}): Promise<{ context: string; trace: string[] }> {
  const MAX_CONTEXT_CHARS = 28_000;
  const MAX_FILE_CHARS = 2_400;
  const trace: string[] = [
    "Thinking: I can do that. To give you the best analysis, I will start by using a specialized tool to investigate the codebase for major issues.",
    "check Codebase Investigator Agent started",
    "Thinking: I will inspect repository structure, dependency manifests, key service entrypoints, and obvious debt markers before writing the final review.",
    "check WriteTodos repository map, dependency audit, backend scan, frontend scan, debt markers, final synthesis",
  ];

  let packageFiles: string[] = [];
  try {
    const packageRaw = await execReviewShell(
      input.repoRoot,
      "find . -name package.json -not -path './node_modules/*' -not -path './.next/*' -not -path './dist/*' | sort | head -n 60",
    );
    packageFiles = packageRaw
      .split("\n")
      .map((line) => normalizeRelativeDotPath(line))
      .filter(Boolean);
    trace.push(`check FindFiles ${path.basename(input.repoRoot)}/ **/package.json (${packageFiles.length} found)`);
  } catch (error) {
    trace.push(`check FindFiles failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const criticalFiles = [
    "./package.json",
    "./frontend/package.json",
    "./backend/ai-service/package.json",
    "./worker/package.json",
    "./email-io/package.json",
    "./frontend/app/api/os/code/run/route.ts",
    "./frontend/components/os/apps/code/CodingAgentWindow.tsx",
    ...input.selectedFiles.map((file) => normalizeRelativeDotPath(file)),
  ]
    .filter(Boolean)
    .slice(0, 8);

  const fileSections: string[] = [];
  for (const relativeFile of criticalFiles) {
    const absolute = path.join(input.repoRoot, relativeFile.slice(2));
    if (!existsSync(absolute)) continue;
    const fileStats = await stat(absolute).catch(() => null);
    if (!fileStats?.isFile()) continue;
    trace.push(`check ReadFile ${relativeFile}`);
    const content = await readFile(absolute, "utf8").catch((error) => `<read failed: ${error instanceof Error ? error.message : "unknown error"}>`);
    fileSections.push(`## ${relativeFile}\n${String(content).slice(0, MAX_FILE_CHARS)}`);
  }

  const folderSections: string[] = [];
  for (const relativeDir of ["frontend", "backend/ai-service", "worker/src"]) {
    trace.push(`check ReadFolder ./${relativeDir}`);
    const listing = await listFolderSummary(input.repoRoot, relativeDir, 10);
    if (listing) {
      folderSections.push(`## ./${relativeDir}\n${listing}`);
    }
  }

  let todoSection = "";
  try {
    trace.push("check SearchText TODO|FIXME");
    // Use grep (available everywhere) with an rg fast-path when installed.
    const todoRaw = await execReviewShell(
      input.repoRoot,
      "(command -v rg >/dev/null 2>&1 && rg -n 'TODO|FIXME' . --glob '!node_modules/**' --glob '!.next/**' --glob '!dist/**' 2>/dev/null || grep -rn -e 'TODO' -e 'FIXME' . --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist 2>/dev/null) | head -n 24 || true",
    );
    todoSection = todoRaw ? `## TODO_FIXME\n${todoRaw}` : "## TODO_FIXME\nNo TODO/FIXME markers found in the scanned subset.";
  } catch (error) {
    todoSection = `## TODO_FIXME\nSearch failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }

  trace.push("Thinking: Initial investigation complete. I will now synthesize the 10 biggest issues from the evidence collected above.");

  const context = [
    `Task: ${input.task}`,
    "Repository investigation evidence:",
    "",
    ...fileSections,
    ...folderSections,
    todoSection,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  return { context, trace };
}
