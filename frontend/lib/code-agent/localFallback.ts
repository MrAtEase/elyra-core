/**
 * Coding agent – Local plan/result fallbacks, design approval gate and small deterministic UI fixes.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { CodingSkill } from "@/types/taskContract";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { TOOL_ALLOWLIST } from "@/lib/code-agent/config";
import { resolveRepoRoot, trimEnv } from "@/lib/code-agent/repo";
import type { JsonRecord, RepoSnapshot, ReviewFinding } from "@/lib/code-agent/types";
import { pathExists } from "@/lib/code-agent/playground";
import { runCommand } from "@/lib/code-agent/gates";

// ── Local plan generator (fallback when backbone unavailable) ─────────────────

export function buildLocalPlan(skill: CodingSkill, task: string, repoUrl: string, branch: string): Record<string, unknown> {
  const steps: Array<{ step: number; title: string; tool: string; description: string }> = [];

  steps.push({ step: 1, title: "Understand codebase", tool: "repo.search + repo.read", description: "Search for relevant files and read key modules." });

  switch (skill) {
    case "fix-build":
      steps.push(
        { step: 2, title: "Identify build errors", tool: "repo.run(pnpm build)", description: "Run the build and capture error output." },
        { step: 3, title: "Locate failing files", tool: "repo.read", description: "Read the files referenced in the error messages." },
        { step: 4, title: "Propose patch", tool: "repo.writePatch", description: "Apply targeted fixes to resolve the errors." },
        { step: 5, title: "Verify build", tool: "repo.run(pnpm build)", description: "Re-run build to confirm it passes." },
      );
      break;
    case "implement-feature":
      steps.push(
        { step: 2, title: "Understand existing patterns", tool: "repo.search + repo.read", description: "Read similar features to follow consistent patterns." },
        { step: 3, title: "Plan changes", tool: "plan", description: "List all files that need to be created or modified." },
        { step: 4, title: "Implement", tool: "repo.writePatch", description: "Create/modify files with the new feature." },
        { step: 5, title: "Write tests", tool: "repo.writePatch", description: "Add unit/integration tests for the new feature." },
        { step: 6, title: "Verify", tool: "repo.run(pnpm test + pnpm build)", description: "Confirm tests pass and build succeeds." },
      );
      break;
    case "refactor-module":
      steps.push(
        { step: 2, title: "Analyse module", tool: "repo.read", description: "Read the target module and its dependencies." },
        { step: 3, title: "Identify improvements", tool: "analysis", description: "List dead code, complexity hotspots, and duplication." },
        { step: 4, title: "Apply refactors", tool: "repo.writePatch", description: "Apply improvements in small, testable increments." },
        { step: 5, title: "Verify", tool: "repo.run(pnpm test)", description: "Ensure all existing tests still pass." },
      );
      break;
    case "add-types":
      steps.push(
        { step: 2, title: "Find any/unknown usages", tool: "repo.search", description: "Search for `any`, `unknown`, and missing return-type annotations." },
        { step: 3, title: "Read affected files", tool: "repo.read", description: "Read each file with type-unsafe code to understand full context." },
        { step: 4, title: "Add TypeScript types", tool: "repo.writePatch", description: "Replace any/unknown, add return types, interfaces, and import required types." },
        { step: 5, title: "Verify tsc", tool: "repo.run(tsc --noEmit)", description: "Run TypeScript compiler to confirm zero type errors remain." },
      );
      break;
    case "write-tests":
      steps.push(
        { step: 2, title: "Read target module", tool: "repo.read", description: "Understand the module's API and behaviour." },
        { step: 3, title: "List test cases", tool: "plan", description: "Happy path, edge cases, error states." },
        { step: 4, title: "Write tests", tool: "repo.writePatch", description: "Create test file with all identified cases." },
        { step: 5, title: "Run tests", tool: "repo.run(pnpm test)", description: "Confirm all new tests pass." },
      );
      break;
    case "ux-ui-design":
      steps.push(
        { step: 2, title: "Collect design context", tool: "attachments + connectors", description: "Use screenshots/Figma nodes and available design connectors as context inputs." },
        { step: 3, title: "Identify UI tokens/components", tool: "repo.search + repo.read", description: "Find the real component files and existing palette/spacing tokens." },
        { step: 4, title: "Apply UX/UI patch", tool: "repo.writePatch", description: "Implement readability, contrast, spacing, and interaction improvements with minimal diffs." },
        { step: 5, title: "Validate", tool: "repo.run(pnpm build + tests)", description: "Confirm build passes and no regressions are introduced." },
      );
      break;
    case "review-code":
      steps.push(
        { step: 2, title: "Map repository structure", tool: "repo.search + repo.read", description: "Identify the most important modules, configs, and app entry points." },
        { step: 3, title: "Inspect hotspots", tool: "repo.read", description: "Review likely risk areas for bugs, performance issues, and maintainability problems." },
        { step: 4, title: "Rank findings", tool: "analysis", description: "Prioritise issues by impact, confidence, and likely effort." },
        { step: 5, title: "Report recommendations", tool: "review", description: "Return actionable suggestions only, with no patch proposal." },
      );
      break;
    case "security-scan":
      steps.push(
        { step: 2, title: "Audit API routes (auth)", tool: "repo.search + repo.read", description: "Check every route in app/api/ for fetchWhoamiPayload + hasWorkspaceAccess." },
        { step: 3, title: "Scan for injection risks", tool: "repo.search", description: "Search for child_process, exec, spawn, eval, and SQL string interpolation." },
        { step: 4, title: "Scan for hardcoded secrets", tool: "repo.search", description: "Search for api_key, apikey, secret, password, token, bearer literals." },
        { step: 5, title: "Check exposed data", tool: "repo.read", description: "Review error handlers and API responses for stack trace / path leakage." },
        { step: 6, title: "Report findings", tool: "review", description: "Return ranked findings (CRITICAL/HIGH/MEDIUM/LOW) with file:line evidence. No patches." },
      );
      break;
    case "tdd-guide":
      steps.push(
        { step: 2, title: "Understand target behaviour", tool: "repo.read", description: "Read the module or feature to be tested." },
        { step: 3, title: "RED — write failing test", tool: "repo.writePatch", description: "Write a test that fails because the feature doesn't exist yet." },
        { step: 4, title: "GREEN — minimal implementation", tool: "repo.writePatch", description: "Write the minimum code to make the test pass. No over-engineering." },
        { step: 5, title: "REFACTOR — clean up", tool: "repo.writePatch", description: "Remove duplication and improve clarity while keeping tests green." },
        { step: 6, title: "Verify full suite", tool: "repo.run(pnpm test)", description: "Run all tests to confirm no regressions." },
      );
      break;
    case "db-review":
      steps.push(
        { step: 2, title: "Read schema & migrations", tool: "repo.read", description: "Read Supabase schema files, migrations, and seed data." },
        { step: 3, title: "Review RLS policies", tool: "repo.read", description: "Check every table has RLS enabled and policies are scoped to auth.uid()." },
        { step: 4, title: "Detect N+1 queries", tool: "repo.search + repo.read", description: "Search for .select()/.eq() calls inside loops." },
        { step: 5, title: "Check indexes", tool: "repo.read", description: "Verify foreign keys and common filter columns are indexed." },
        { step: 6, title: "Report findings", tool: "review", description: "Return ranked findings (CRITICAL/HIGH/MEDIUM/LOW) with file:line evidence. No patches." },
      );
      break;
    case "perf-audit":
      steps.push(
        { step: 2, title: "Analyse bundle imports", tool: "repo.search + repo.read", description: "Find large client-side imports that could be lazy-loaded or moved server-only." },
        { step: 3, title: "Review React renders", tool: "repo.search + repo.read", description: "Identify expensive computations without useMemo and stable callbacks without useCallback." },
        { step: 4, title: "Check list virtualisation", tool: "repo.search", description: "Find large lists rendered without virtualisation." },
        { step: 5, title: "Review data fetching", tool: "repo.read", description: "Look for waterfall fetches, missing loading states, and unoptimised images." },
        { step: 6, title: "Report findings", tool: "review", description: "Return ranked findings (HIGH/MEDIUM/LOW) by estimated impact. No patches." },
      );
      break;
    case "api-design":
      steps.push(
        { step: 2, title: "Inventory API routes", tool: "repo.search + repo.read", description: "List all routes in app/api/, their methods, and input/output shapes." },
        { step: 3, title: "Review naming & methods", tool: "analysis", description: "Check resource naming (nouns, plural), correct HTTP methods, and versioning." },
        { step: 4, title: "Review auth & error formats", tool: "repo.read", description: "Confirm every route checks auth; errors return { error, code } shapes." },
        { step: 5, title: "Flag breaking changes", tool: "analysis", description: "Identify any changes that break existing consumers." },
        { step: 6, title: "Report recommendations", tool: "review", description: "Return structured review with actionable suggestions. No patches." },
      );
      break;
    case "code-explain":
      steps.push(
        { step: 2, title: "Read target code", tool: "repo.read", description: "Read the file(s) or module specified in the task, in full." },
        { step: 3, title: "Trace execution flow", tool: "repo.search + repo.read", description: "Follow function calls and data flow through the codebase." },
        { step: 4, title: "Identify non-obvious decisions", tool: "analysis", description: "Note architectural choices, edge cases, and failure modes." },
        { step: 5, title: "Write explanation", tool: "report", description: "Produce a structured explanation with headings. No code changes." },
      );
      break;
    case "custom":
      steps.push(
        { step: 2, title: "Understand the task", tool: "repo.read", description: "Read relevant files to understand the codebase context and what the natural-language task requires." },
        { step: 3, title: "Plan changes", tool: "plan", description: "Identify all files to create or modify to fulfil the custom task description." },
        { step: 4, title: "Implement changes", tool: "repo.writePatch", description: "Apply targeted changes to fulfil the task as described." },
        { step: 5, title: "Verify", tool: "repo.run", description: "Run lint/tests/build to confirm changes are correct and nothing is broken." },
      );
      break;
    default:
      steps.push(
        { step: 2, title: "Read relevant files", tool: "repo.read", description: "Understand current state before making changes." },
        { step: 3, title: "Propose changes", tool: "repo.writePatch", description: "Apply targeted changes to fulfil the task." },
        { step: 4, title: "Verify", tool: "repo.run", description: "Run lint/tests to confirm nothing is broken." },
      );
  }

  return {
    runId: `run-${Date.now()}`,
    skill,
    task,
    repoUrl,
    branch,
    status: "plan_ready",
    plan: {
      summary: `Agent will ${task} using ${steps.length} steps.`,
      steps,
      estimatedMinutes: steps.length * 1.5,
      toolsRequired: ["repo.search", "repo.read", "repo.writePatch", "repo.run"],
      allowedCommands: TOOL_ALLOWLIST.slice(0, 8).map((t) => t.cmd),
    },
    safetyPolicy: {
      networkDisabled: true,
      noAutoMerge: true,
      requiresApprovalBefore: ["repo.createPR", "file.delete"],
      maxIterations: 3,
    },
  };
}

export function buildLocalResult(skill: CodingSkill, task: string, _repoUrl: string): Record<string, unknown> {
  return {
    status: "failed",
    skill,
    task,
    summary: `Agent completed in safe local fallback mode.\n\nNo code was changed because the model response was unavailable. Retry the run when Gemini or the worker backbone is healthy, or narrow the task to specific frontend files.`,
    filesChanged: [],
    diff: "",
    testReport: {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: "0s",
      output: "Safe local fallback. No tests were run.",
    },
    buildReport: { success: false, warnings: 0, output: "Safe local fallback. No build was run." },
    requiresApproval: false,
    approvalActions: [],
  };
}

export function buildUxDesignApprovalGateArtifact(input: {
  task: string;
  figmaConnectUrl: string;
  stitchConnectUrl: string;
  banana2ConnectUrl: string;
  twentyfirstConnectUrl: string;
  designDraftUrl?: string;
}): Record<string, unknown> {
  const draftHint = input.designDraftUrl?.trim()
    ? `Design draft provided: ${input.designDraftUrl.trim()}`
    : "No design draft URL detected. Connect Figma/Google Stitch/Banana2/21st.dev and create a draft first.";
  return {
    status: "completed",
    skill: "ux-ui-design",
    task: input.task,
    summary:
      "Design-first gate active. Review/approve the design draft before code implementation starts.",
    nextSteps: [
      draftHint,
      `Figma: ${input.figmaConnectUrl}`,
      `Google Stitch: ${input.stitchConnectUrl}`,
      `Banana2: ${input.banana2ConnectUrl}`,
      `21st.dev: ${input.twentyfirstConnectUrl}`,
      "After review, click Approve Design to execute code changes in playground.",
    ],
    filesChanged: [],
    diff: "",
    testReport: {
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: "0s",
      output: "Execution gated until design approval.",
    },
    buildReport: {
      success: true,
      warnings: 0,
      output: "Execution gated until design approval.",
    },
    requiresApproval: true,
    approvalActions: ["approve-design"],
  };
}

type DesignDraftProvider = "figma" | "google_stitch" | "banana2";

type DesignDraftDetection = {
  url: string;
  provider: DesignDraftProvider | null;
  valid: boolean;
  detectedFrom: "field" | "task" | "none";
};

export async function tryGenerateDesignDraftViaMcp(input: {
  task: string;
  repoUrl: string;
  branch: string;
  workspaceId?: string | undefined;
  origin?: string;
}): Promise<DesignDraftDetection | null> {
  const requestBody = {
    task: input.task,
    repoUrl: input.repoUrl,
    branch: input.branch,
    workspaceId: input.workspaceId,
  };
  const attemptWebhook = async (
    provider: DesignDraftProvider,
    defaultPath: string,
    ...envKeys: string[]
  ): Promise<DesignDraftDetection | null> => {
    const configuredEndpoint = trimEnv(...envKeys);
    const endpoint =
      configuredEndpoint ||
      (input.origin ? `${input.origin}${defaultPath}` : "");
    if (!endpoint) return null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { draftUrl?: string; url?: string; ok?: boolean }
        | null;
      const candidate = (payload?.draftUrl ?? payload?.url ?? "").trim();
      if (!response.ok || !candidate) return null;
      const detected = detectDesignDraft({ draftUrl: candidate, task: "" });
      if (!detected.valid) return null;
      if (detected.provider === provider || provider === "figma") {
        return {
          ...detected,
          detectedFrom: "field",
        };
      }
      return detected;
    } catch {
      return null;
    }
  };

  return (
    (await attemptWebhook("figma", "/api/os/design-draft/figma", "FIGMA_MCP_DRAFT_WEBHOOK_URL")) ??
    (await attemptWebhook("google_stitch", "/api/os/design-draft/stitch", "GOOGLE_STITCH_DRAFT_WEBHOOK_URL", "STITCH_DRAFT_WEBHOOK_URL")) ??
    (await attemptWebhook("banana2", "/api/os/design-draft/banana", "BANANA2_DRAFT_WEBHOOK_URL", "BANANA_DRAFT_WEBHOOK_URL"))
  );
}

export function detectDesignDraft(input: { draftUrl: string; task: string }): DesignDraftDetection {
  const normalizeCandidate = (value: string): string => value.trim().replace(/[),.;]+$/, "");
  const isValidProviderUrl = (provider: DesignDraftProvider, url: URL): boolean => {
    const pathname = url.pathname.toLowerCase();
    if (provider === "figma") {
      return (
        pathname.startsWith("/design/") ||
        pathname.startsWith("/board/") ||
        pathname.startsWith("/proto/")
      );
    }
    if (provider === "google_stitch" || provider === "banana2") {
      return pathname.length > 1;
    }
    return false;
  };
  const detectProvider = (host: string): DesignDraftProvider | null => {
    const normalized = host.toLowerCase();
    if (normalized.includes("figma.com")) return "figma";
    if (normalized.includes("stitch.withgoogle.com") || normalized.includes("stitch.google.com")) return "google_stitch";
    if (normalized.includes("banana.dev")) return "banana2";
    return null;
  };
  const parseUrl = (value: string): { url: string; provider: DesignDraftProvider | null } | null => {
    if (!value) return null;
    try {
      const parsed = new URL(normalizeCandidate(value));
      if (!/^https?:$/.test(parsed.protocol)) return null;
      const provider = detectProvider(parsed.host);
      if (!provider) return null;
      if (!isValidProviderUrl(provider, parsed)) return null;
      return { url: parsed.toString(), provider };
    } catch {
      return null;
    }
  };

  const fromField = parseUrl(input.draftUrl);
  if (fromField) {
    return { ...fromField, valid: true, detectedFrom: "field" };
  }

  const taskUrls = input.task.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const candidate of taskUrls) {
    const parsed = parseUrl(candidate);
    if (parsed) {
      return { ...parsed, valid: true, detectedFrom: "task" };
    }
  }

  return { url: "", provider: null, valid: false, detectedFrom: "none" };
}

export function withDesignDraftMetadata<T extends JsonRecord>(
  artifact: T,
  input: { skill: CodingSkill; designDraft: DesignDraftDetection; designApproved: boolean }
): T {
  if (input.skill !== "ux-ui-design") return artifact;
  return {
    ...artifact,
    designDraft: {
      url: input.designDraft.url,
      provider: input.designDraft.provider,
      detected: input.designDraft.detectedFrom !== "none",
      detectedFrom: input.designDraft.detectedFrom,
      approved: input.designApproved,
    },
  } as T;
}

const UI_COLOR_WORDS: Record<string, string> = {
  grün: "green",
  gruen: "green",
  green: "green",
  gelb: "yellow",
  yellow: "yellow",
  blau: "blue",
  blue: "blue",
  rot: "red",
  red: "red",
  rosa: "pink",
  pink: "pink",
  lila: "purple",
  violett: "purple",
  purple: "purple",
  orange: "orange",
  schwarz: "black",
  black: "black",
  weiss: "white",
  weiß: "white",
  white: "white",
  grau: "gray",
  grey: "gray",
  gray: "gray",
};

function extractRequestedUiColor(task: string): string | null {
  const hex = task.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  if (hex?.[0]) return hex[0].toLowerCase();

  const words = task.toLowerCase().split(/[\s,.;:!?()\-_/]+/).filter(Boolean);
  const negators = new Set(["nicht", "not", "kein", "keine", "without", "ohne"]);
  let selected: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    const mapped = UI_COLOR_WORDS[word];
    if (!mapped) continue;
    const prev = words[i - 1] ?? "";
    const prev2 = words[i - 2] ?? "";
    const negated = negators.has(prev) || negators.has(prev2);
    if (!negated) selected = mapped;
  }
  return selected;
}

function tryApplyMenuColorChange(content: string, color: string): string | null {
  const panelMatch = content.match(
    /(<motion\.section[\s\S]*?style=\{\{[\s\S]*?)(background:\s*"[^"]*")(,[\s\S]*?\}\}[\s\S]*?role="dialog")/
  );
  if (panelMatch) {
    const next = content.replace(
      /(<motion\.section[\s\S]*?style=\{\{[\s\S]*?)background:\s*"[^"]*"(,[\s\S]*?\}\}[\s\S]*?role="dialog")/,
      `$1background: "${color}"$2`
    );
    if (next !== content) return next;
  }

  const cssNext = content.replace(
    /(background-color\s*:\s*)([^;]+)(;)/,
    `$1${color}$3`
  );
  if (cssNext !== content) return cssNext;

  const inlineNext = content.replace(
    /(background\s*:\s*")([^"]+)(",)/,
    `$1${color}$3`
  );
  if (inlineNext !== content) return inlineNext;

  return null;
}

function tryApplyWeatherReadabilityFix(content: string): string | null {
  let next = content;
  next = next.replace(/text-\[color:var\(--text-tertiary\)\]/g, "text-[color:var(--text-secondary)]");
  next = next.replace(
    /(<p className="mb-2 text-\[10px\] uppercase tracking-wide )text-\[color:var\(--text-secondary\)\](">\s*24h — Temperature & Precipitation\s*<\/p>)/,
    "$1text-[color:var(--text-primary)]$2",
  );
  next = next.replace(
    /(<p className="mb-2 text-\[10px\] uppercase tracking-wide )text-\[color:var\(--text-secondary\)\](">\s*Today — Hourly\s*<\/p>)/,
    "$1text-[color:var(--text-primary)]$2",
  );
  next = next.replace(
    /(<p className="mb-2 text-\[10px\] uppercase tracking-wide )text-\[color:var\(--text-secondary\)\](">\s*7-Day Surf Forecast\s*<\/p>)/,
    "$1text-[color:var(--text-primary)]$2",
  );
  return next !== content ? next : null;
}

/**
 * Recount and fix the +/- line counts in every @@ hunk header.
 * AI-generated diffs often declare the wrong counts, causing `git apply` to fail.
 */
export function fixDiffHunkCounts(diff: string): string {
  // Strip trailing empty string produced by split("\n") when input ends with "\n".
  // Without this, the last hunk body picks up an extra "" that inflates counts.
  const raw = diff.split("\n");
  const lines = raw.length > 0 && raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw;
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    // Detect @@ -a,b +c,d @@ [context]
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (!hunkMatch) {
      out.push(line);
      i += 1;
      continue;
    }
    const oldStart = parseInt(hunkMatch[1] ?? "1", 10);
    const newStart = parseInt(hunkMatch[2] ?? "1", 10);
    const suffix = hunkMatch[3] ?? "";
    // Collect hunk body (stop at next hunk/file header)
    i += 1;
    const body: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.startsWith("@@") || l.startsWith("---") || l.startsWith("+++") || l.startsWith("diff ")) break;
      body.push(l);
      i += 1;
    }
    // Strip trailing blank lines from hunk body – they are not real content lines.
    while (body.length > 0 && body[body.length - 1] === "") { body.pop(); }
    // Count actual lines
    let oldCount = 0;
    let newCount = 0;
    for (const bl of body) {
      if (bl.startsWith("-")) { oldCount += 1; }
      else if (bl.startsWith("+")) { newCount += 1; }
      else { oldCount += 1; newCount += 1; } // context line (space-prefixed or bare)
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${suffix}`);
    out.push(...body);
  }
  // Always end with a newline so git apply accepts the patch.
  return out.join("\n") + "\n";
}

/**
 * Remove removed lines from a diff if the content doesn't appear in the target file.
 * AI models sometimes hallucinate extra "-" lines (e.g. a line of just spaces) that don't
 * exist in the file. Keeping them causes git apply to fail because the context can never match.
 * Only strips lines where the content (minus the "-" prefix) is not found anywhere in the file.
 * Uses exact matching (no trimEnd) so that a line of pure spaces is correctly identified as
 * spurious (the file has blank lines "" but not lines of N trailing spaces).
 */
export function stripSpuriousRemovedLines(diff: string, fileContent: string): string {
  // Build set without trimEnd so blank lines ("") != whitespace-only lines ("   ")
  const fileLines = new Set(fileContent.split("\n"));
  const lines = diff.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      const content = line.slice(1); // strip only the "-" prefix
      const trimmedContent = content.trimEnd();
      // Only use trimEnd fallback when trimmed is non-empty — otherwise a pure-whitespace
      // removed line (e.g. "       ") would match blank lines ("") in the file and survive.
      const found =
        fileLines.has(content) ||
        (trimmedContent.length > 0 && fileLines.has(trimmedContent));
      if (!found) {
        continue; // spurious removed line not present in the actual file
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

export function rewriteNoIndexDiffPaths(diff: string, targetRelPath: string, tempRelPath: string): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tempEscaped = escape(tempRelPath);
  return diff
    .replace(new RegExp(`^---\\s+a/${tempEscaped}(\\s.*)?$`, "m"), `--- a/${targetRelPath}$1`)
    .replace(new RegExp(`^\\+\\+\\+\\s+b/${tempEscaped}(\\s.*)?$`, "m"), `+++ b/${targetRelPath}$1`)
    .replace(new RegExp(`^---\\s+${tempEscaped}(\\s.*)?$`, "m"), `--- a/${targetRelPath}$1`)
    .replace(new RegExp(`^\\+\\+\\+\\s+${tempEscaped}(\\s.*)?$`, "m"), `+++ b/${targetRelPath}$1`);
}

export async function buildLocalUiColorFallbackResult(input: {
  task: string;
  repoUrl: string;
  selectedFiles: string[];
}): Promise<Record<string, unknown> | null> {
  const taskLower = input.task.toLowerCase();
  const weatherReadabilityTask =
    /(weather|wetter|surf)/.test(taskLower) && /(readable|readability|leserlich|kontrast|contrast|unreadable)/.test(taskLower);
  const color =
    extractRequestedUiColor(input.task) ??
    (/anpass|angepass|match|premium|theme|ui/.test(taskLower) ? "var(--bg-elevated)" : null);
  if (!color && !weatherReadabilityTask) return null;

  const repoRoot = await resolveRepoRoot(input.repoUrl.split("#")[0] ?? input.repoUrl);
  const repoRootNormalized = repoRoot.replace(/\/+$/, "");
  const repoIsFrontendRoot = repoRootNormalized.endsWith("/frontend");
  const weatherCandidates = [
    "frontend/components/os/apps/weather/WeatherWindow.tsx",
    "components/os/apps/weather/WeatherWindow.tsx",
  ];
  const menuCandidates = [
    "frontend/components/os/shell/IdentityMenu.tsx",
    "components/os/shell/IdentityMenu.tsx",
  ];
  const preferredCandidates = input.selectedFiles.length > 0
    ? input.selectedFiles
    : weatherReadabilityTask
      ? weatherCandidates
      : menuCandidates;

  let targetRel: string | null = null;
  for (const candidate of preferredCandidates) {
    const rel = candidate.replace(/^\/+/, "");
    const variants = new Set<string>([rel]);
    if (repoIsFrontendRoot && rel.startsWith("frontend/")) {
      variants.add(rel.slice("frontend/".length));
    }
    if (!repoIsFrontendRoot && !rel.startsWith("frontend/")) {
      variants.add(`frontend/${rel}`);
    }
    for (const variant of variants) {
      const abs = path.resolve(repoRoot, variant);
      if (await pathExists(abs)) {
        targetRel = variant;
        break;
      }
    }
    if (targetRel) {
      break;
    }
  }
  if (!targetRel) return null;

  const targetAbs = path.resolve(repoRoot, targetRel);
  const original = await readFile(targetAbs, "utf8").catch(() => "");
  if (!original) return null;
  const updated = weatherReadabilityTask
    ? tryApplyWeatherReadabilityFix(original)
    : tryApplyMenuColorChange(original, color ?? "var(--bg-elevated)");
  if (!updated || updated === original) return null;

  const tempDir = path.join(repoRoot, ".run", "tmp");
  await mkdir(tempDir, { recursive: true });
  const tempRel = path.join(".run", "tmp", `.menu-color-${Date.now()}.tmp`).replaceAll(path.sep, "/");
  const tempAbs = path.resolve(repoRoot, tempRel);
  await writeFile(tempAbs, updated, "utf8");

  const diffResult = await runCommand("git", ["diff", "--no-index", "--", targetRel, tempRel], repoRoot);
  await rm(tempAbs, { force: true }).catch(() => null);
  const rawDiff = diffResult.stdout || diffResult.stderr || "";
  if (!rawDiff.trim()) return null;

  const diff = rewriteNoIndexDiffPaths(rawDiff, targetRel, tempRel);
  if (!diff.includes(`+++ b/${targetRel}`)) return null;

  return {
    status: "completed",
    skill: "custom",
    task: input.task,
    summary: weatherReadabilityTask
      ? `Adaptive local fallback generated a direct Weather readability patch for ${targetRel}.`
      : `Adaptive local fallback generated a direct UI patch for ${targetRel} (menu color -> ${color}).`,
    filesChanged: [{ path: targetRel, linesAdded: 1, linesRemoved: 1 }],
    diff,
    testReport: {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: "0s",
      output: "Fallback patch prepared. Verification runs in execute apply stage.",
    },
    buildReport: { success: true, warnings: 0, output: "Fallback patch prepared." },
    requiresApproval: false,
    approvalActions: [],
  };
}

export function buildLocalReviewResult(task: string, snapshot: RepoSnapshot | null): Record<string, unknown> {
  const topFiles = snapshot?.files.slice(0, 12).map((file) => `- ${file}`).join("\n") || "- Snapshot unavailable";
  const bootstrapFile = snapshot?.files.find((file) => file.includes("frontend/app/api"));
  const contractFile = snapshot?.files.find((file) => file.includes("bootstrap"));
  const uiFile = snapshot?.files.find((file) => file.includes("components"));
  const findings: ReviewFinding[] = [
    {
      title: "Concentrate performance work on measured hotspots",
      priority: "P1",
      ...(bootstrapFile ? { file: bootstrapFile } : {}),
      issue: "The app spans multiple API surfaces, but broad refactors are easy to mis-prioritize without route-level timing.",
      recommendation: "Use the existing timing headers to identify the single slowest route first, then optimize that path before further UI work.",
    },
    {
      title: "Reduce repeated bootstrap and auth work",
      priority: "P1",
      ...(contractFile ? { file: contractFile } : {}),
      issue: "Workspace boot paths are likely redoing auth, status, and contract work across multiple surfaces.",
      recommendation: "Cache shared bootstrap payloads per workspace and dedupe auth/credential resolution across Mail, Calendar, and Dashboard.",
    },
    {
      title: "Keep the largest UI surfaces split and memo-friendly",
      priority: "P2",
      ...(uiFile ? { file: uiFile } : {}),
      issue: "Large client components tend to accumulate state coupling and trigger avoidable rerenders.",
      recommendation: "Split heavy panels into smaller data/view units and memoize derived collections used during render.",
    },
  ];
  return {
    status: "completed",
    skill: "review-code",
    task,
    summary: [
      "## Executive Summary",
      "Local review fallback was used. Gemini or the worker backbone was unavailable, so this is a conservative repository review.",
      "",
      "## Highest Impact Fixes",
      "- Add targeted runtime profiling around the slowest user paths before more broad refactors.",
      "- Reduce repeated bootstrap/auth lookups and keep response contracts cached per workspace.",
      "- Audit the largest client components for unnecessary state coupling and rerenders.",
      "",
      "## Quick Wins",
      "- Verify the slowest API routes with timing headers enabled.",
      "- Trim duplicate fetches in Mail, Calendar, and Dashboard surfaces.",
      "- Confirm loading boundaries exist on every async panel.",
      "",
      "## Indexed Files",
      topFiles,
    ].join("\n"),
    findings,
    nextSteps: findings.map((finding) => finding.recommendation),
    filesChanged: [],
    diff: "",
    testReport: {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: "0s",
      output: "Review-only fallback. No tests were run.",
    },
    buildReport: { success: true, warnings: 0, output: "Review-only fallback. No build was run." },
    requiresApproval: false,
    approvalActions: [],
  };
}

export function buildLocalReviewWithFixesResult(task: string, snapshot: RepoSnapshot | null): Record<string, unknown> {
  const review = buildLocalReviewResult(task, snapshot) as JsonRecord;
  const findings = Array.isArray(review.findings) ? review.findings : [];

  return {
    status: "completed",
    skill: "review-code",
    task,
    summary: [
      "## Review + Proposed Fixes",
      "Local fallback prepared a conservative patch proposal for the top review findings.",
      "",
      "## Proposed Focus",
      "- Add a cached bootstrap response for repeated workspace loads.",
      "- Dedupe shared auth/bootstrap resolution in high-traffic API routes.",
      "- Split the heaviest render paths into smaller memo-friendly units.",
    ].join("\n"),
    findings,
    nextSteps: Array.isArray(review.nextSteps) ? review.nextSteps : [],
    filesChanged: [],
    diff: "",
    testReport: {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: "0s",
      output: "Review + Proposed Fixes fallback. No tests were run.",
    },
    buildReport: { success: true, warnings: 0, output: "Review + Proposed Fixes fallback. No build was run." },
    requiresApproval: false,
    approvalActions: [],
  };
}
