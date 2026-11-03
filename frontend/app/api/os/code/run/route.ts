import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { forwardToWorkerOs, isWorkerBackboneMode, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { emitMetricSample } from "@/lib/orb-os/observability/store";
import { appendRunEvent, type RunEventType } from "@/lib/orb-os/events/store";
import {
  getProviderStatuses,
  resolveProvider,
  resolveProviderForWorkspace,
  type ProviderId,
} from "@/lib/orb-os/providers/providerRouter";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";
import {
  cloneRepoToTmp,
  pushBranchAndCreatePR,
  cleanupGitHubClone,
} from "@/lib/github/cloudCoder";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { CODING_SKILLS, type CodeTaskContract, type CodingSkill } from "@/types/taskContract";
import type { AgentRole, TeamMode, AgentToolName } from "@/types/agent";

// ── Types ──────────────────────────────────────────────────────────────────────

// AgentRole and TeamMode are imported from @/types/agent (shared contract).
type TeamConfig = Partial<Record<AgentRole, number>>;

type ToolAllowlistEntry = { cmd: string; description: string };
type JsonRecord = Record<string, unknown>;
type CodeProviderStatusMap = ReturnType<typeof getProviderStatuses>;
type CodeProviderStatus = CodeProviderStatusMap[ProviderId];
type GeminiPart = { text: string };
type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
type GeminiInputPart = GeminiPart | GeminiInlinePart;
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  error?: { message?: string; code?: number };
};
type RepoSampleFile = { path: string; excerpt: string };
type RunAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes?: number;
};
type ReviewFinding = {
  title: string;
  priority: "P1" | "P2" | "P3";
  file?: string;
  issue: string;
  recommendation: string;
};
type RepoOption = {
  id: string;
  label: string;
  value: string;
  source: "local" | "github";
};
type FolderOption = {
  label: string;
  value: string;
};
type FileOption = {
  label: string;
  value: string;
};
type RepoSnapshot = {
  repoRoot: string;
  scanRoot: string;
  fileCount: number;
  files: string[];
  sampledFiles: RepoSampleFile[];
  truncated: boolean;
  source?: "local" | "github";
};

type ExecutionOutcome = {
  applied: boolean;
  applyOutput: string;
  workflow?: {
    current: "planned" | "approved" | "running" | "gated" | "rolled_back" | "promoted" | "failed";
    history: Array<{ state: string; at: string; note?: string }>;
  } | undefined;
  gates?: GateReport[] | undefined;
  testReport: { passed: number; failed: number; skipped: number; duration: string; output: string };
  buildReport: { success: boolean; warnings: number; output: string };
  executionLog: string[];
  previewUrl?: string | undefined;
  commitOutput?: string | undefined;
  appliedDiff?: string | undefined;
  appliedFiles?: string[] | undefined;
};

type DirectEditPlan = {
  file: string;
  before: string;
  after: string;
  summary?: string;
  diagnosis?: string;
  relatedFilesChecked?: string[];
};
type ScopedFileSnapshot = {
  file: string;
  content: string;
};
type WorkspaceBrainProfile = Record<string, unknown>;
type WorkspaceMemoryEntry = {
  id?: string;
  type?: string;
  content?: string;
  confidence?: number;
  created_at?: number;
  updated_at?: number;
};
type LocalAgentRequestMode = "fix" | "feature" | "refactor" | "tests";
type GateReport = {
  gate: "lint" | "typecheck" | "tests" | "build" | "perf" | "a11y" | "visual";
  status: "passed" | "failed" | "skipped";
  command?: string;
  output: string;
  attempts: number;
  required: boolean;
};

function normalizeCodeTaskContract(input: unknown): CodeTaskContract | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (record.executorType !== "code") return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const goal = typeof record.goal === "string" ? record.goal.trim() : "";
  const source = record.source === "chief_orchestrator" ? "chief_orchestrator" : "manual";
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim()
    ? record.createdAt.trim()
    : new Date().toISOString();
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  const rawScope = record.scope && typeof record.scope === "object" ? (record.scope as Record<string, unknown>) : {};
  const rawConstraints =
    record.constraints && typeof record.constraints === "object" ? (record.constraints as Record<string, unknown>) : {};
  const definitionOfDone = Array.isArray(record.definitionOfDone)
    ? record.definitionOfDone.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const verification = Array.isArray(record.verification)
    ? record.verification.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!id || !title || !goal) return null;

  return {
    id,
    executorType: "code",
    title,
    goal,
    ...(summary ? { summary } : {}),
    scope: {
      ...(typeof rawScope.workspaceId === "string" && rawScope.workspaceId.trim()
        ? { workspaceId: rawScope.workspaceId.trim() }
        : {}),
      ...(typeof rawScope.repoUrl === "string" && rawScope.repoUrl.trim()
        ? { repoUrl: rawScope.repoUrl.trim() }
        : {}),
      ...(typeof rawScope.branch === "string" && rawScope.branch.trim()
        ? { branch: rawScope.branch.trim() }
        : {}),
      ...(typeof rawScope.folderPath === "string" && rawScope.folderPath.trim()
        ? { folderPath: rawScope.folderPath.trim() }
        : {}),
      ...(Array.isArray(rawScope.selectedFiles)
        ? {
            selectedFiles: rawScope.selectedFiles
              .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((item) => item.trim()),
          }
        : {}),
    },
    constraints: {
      ...(rawConstraints.stage === "dev" || rawConstraints.stage === "prod" || rawConstraints.stage === "playground"
        ? { stage: rawConstraints.stage }
        : {}),
      ...(rawConstraints.terminalAccess === true ? { terminalAccess: true } : {}),
      ...(rawConstraints.useReasoning === true ? { useReasoning: true } : {}),
      ...(rawConstraints.autoCommit === true ? { autoCommit: true } : {}),
      ...(rawConstraints.executionMode === "strict" || rawConstraints.executionMode === "adaptive"
        ? { executionMode: rawConstraints.executionMode }
        : {}),
      ...(typeof rawConstraints.provider === "string" && rawConstraints.provider.trim()
        ? { provider: rawConstraints.provider.trim() }
        : {}),
      ...(rawConstraints.agentRole === "frontend" ||
      rawConstraints.agentRole === "backend" ||
      rawConstraints.agentRole === "ui" ||
      rawConstraints.agentRole === "infra" ||
      rawConstraints.agentRole === "qa" ||
      rawConstraints.agentRole === "general"
        ? { agentRole: rawConstraints.agentRole }
        : {}),
      ...(rawConstraints.branchPerAgent === true ? { branchPerAgent: true } : {}),
      ...(typeof rawConstraints.agentBranchName === "string" && rawConstraints.agentBranchName.trim()
        ? { agentBranchName: rawConstraints.agentBranchName.trim() }
        : {}),
      ...(typeof rawConstraints.budgetUsd === "number" && Number.isFinite(rawConstraints.budgetUsd)
        ? { budgetUsd: rawConstraints.budgetUsd }
        : {}),
      ...(typeof rawConstraints.deadlineMinutes === "number" && Number.isFinite(rawConstraints.deadlineMinutes)
        ? { deadlineMinutes: rawConstraints.deadlineMinutes }
        : {}),
    },
    definitionOfDone,
    verification,
    source,
    createdAt,
  };
}

async function appendCodeRunEventSafe(input: {
  workspaceId?: string | undefined;
  runId?: string | undefined;
  eventType: RunEventType;
  summary: string;
  detail?: string | undefined;
  toolCallId?: string | null;
}): Promise<void> {
  if (!input.workspaceId || !input.runId) return;
  try {
    await appendRunEvent({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: input.eventType,
      toolCallId: input.toolCallId ?? null,
      payload: {
        summary: input.summary,
        ...(input.detail ? { detail: input.detail } : {}),
      },
    });
  } catch {
    // Run events are observability, not correctness.
  }
}

// ── Tool allowlist (safety: only these commands may run in sandbox) ────────────

const TOOL_ALLOWLIST: ToolAllowlistEntry[] = [
  { cmd: "git status",  description: "Show working tree status" },
  { cmd: "git diff",    description: "Show unified diff" },
  { cmd: "git log",     description: "Show commit history" },
  { cmd: "pnpm build",  description: "Run production build" },
  { cmd: "pnpm test",   description: "Run tests" },
  { cmd: "pnpm lint",   description: "Run linter" },
  { cmd: "pnpm tsc",    description: "TypeScript check" },
  { cmd: "npm run build",  description: "Run production build (npm)" },
  { cmd: "npm test",       description: "Run tests (npm)" },
  { cmd: "npm run lint",   description: "Run linter (npm)" },
  { cmd: "eslint",      description: "Lint source files" },
  { cmd: "tsc",         description: "TypeScript compiler check" },
  { cmd: "ripgrep",     description: "Search files" },
  { cmd: "rg",          description: "Search files" },
  { cmd: "find",        description: "Find files" },
  { cmd: "cat",         description: "Read file content" },
  { cmd: "ls",          description: "List directory" },
  { cmd: "tree",        description: "Directory tree" },
];

/**
 * Skills that are ALWAYS analysis-only — they scan and report, never emit
 * filesystem patches regardless of the `suggestionsOnly` flag.
 * `review-code` is intentionally excluded because it supports a "with fixes"
 * mode (suggestionsOnly=false).
 */
const ANALYSIS_ONLY_SKILLS = new Set<CodingSkill>([
  "security-scan",
  "db-review",
  "perf-audit",
  "api-design",
  "code-explain",
]);

const REPO_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
]);
const REPO_SCAN_TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".py",
  ".css",
  ".scss",
  ".yml",
  ".yaml",
  ".sql",
  ".html",
]);
const PLAYGROUND_PREVIEW_PORT = 3100;
const PLAYGROUND_PID_FILE = ".elyra-playground.pid";
const MAX_REPO_FILES = 160;
const MAX_REPO_SCAN_FILES = 4000;
const MAX_REPO_SAMPLES = 18;
const MAX_REPO_EXCERPT_CHARS = 1200;
const MAX_LOCAL_REPOS = 24;
const MAX_FOLDER_OPTIONS = 40;
const MAX_FOLDER_SCAN_DEPTH = 2;
const COMMAND_TIMEOUT_MS = 120_000;
const BUILD_GATE_TIMEOUT_MS = 420_000;
const TEST_GATE_TIMEOUT_MS = 180_000;
const TYPECHECK_GATE_TIMEOUT_MS = 180_000;
const GEMINI_TIMEOUT_MS = 240_000; // 4 min — OpenAI/Gemini 2.5 Flash need ~3 min for large diffs
const RETRY_BUDGET_PER_GATE = 1;
const HARD_GATES = [
  "lint",
  "typecheck",
  "tests",
  "build",
  "perf",
  "a11y",
  "visual",
] as const;

const EPHEMERAL_EXECUTION_CHANGE_PREFIXES = [
  ".next/",
  "node_modules/",
  ".aider/",
  ".codex/",
  ".gemini/",
  ".run/",
  ".tools/",
];
const EPHEMERAL_EXECUTION_CHANGES = new Set([
  "next-env.d.ts",
]);
type HardGate = (typeof HARD_GATES)[number];

// ── Skill → system-prompt hints ────────────────────────────────────────────────

function skillSystemPrompt(skill: CodingSkill, task: string): string {
  const base = `You are a senior software engineer working in a code repository. Your goal is to ${task}.\n\nRules:\n- Read relevant files before proposing changes.\n- Produce minimal, targeted diffs.\n- Never delete files without explicit instructions.\n- Always explain your reasoning.\n- After changes, run lint and tests.\n- If tests fail, iterate until they pass (max 3 attempts).\n- Output a clear summary of changes.\n`;

  switch (skill) {
    case "fix-build":
      return base + "\nFocus: Find the root cause of the build failure, fix it, verify build passes.";
    case "implement-feature":
      return base + "\nFocus: Understand existing patterns, implement the feature consistently, add tests.";
    case "refactor-module":
      return base + "\nFocus: Improve code quality without changing behaviour. Maintain all existing tests.";
    case "write-tests":
      return base + "\nFocus: Write comprehensive unit/integration tests. Aim for coverage of happy path + edge cases.";
    case "review-code":
      return `You are a senior software engineer reviewing a code repository. Your goal is to ${task}.\n\nRules:\n- Read relevant files before making claims.\n- Do not propose or imply code edits.\n- Do not output diffs or patches.\n- Prioritise bugs, performance issues, security risks, and DX problems.\n- Return actionable recommendations ranked by impact.\n- Be explicit about assumptions and uncertainty.\n`;
    case "add-types":
      return base + "\nFocus: Add proper TypeScript types, eliminate any/unknown where possible, verify tsc passes.";
    case "ux-ui-design":
      return base + "\nFocus: Ship production-ready UX/UI changes. Reuse existing design tokens, improve readability/accessibility, and when relevant use connected tools (Figma, Google Stitch, Banana2, 21st.dev) as design context sources.";
    case "security-scan":
      return `You are a senior security engineer auditing a code repository. Your goal is to ${task}.\n\nRules:\n- Read every API route file to check authentication and authorisation.\n- Search for child_process, exec, spawn, eval, and shell interpolation patterns.\n- Search for hardcoded API keys, tokens, passwords, and bearer strings.\n- Check for raw SQL interpolation (prefer parameterised queries).\n- Review error responses for stack trace or path leakage.\n- Report only findings with concrete file evidence and line numbers.\n- Do not flag: dev scripts, localhost URLs, console.log in development code.\n- Classify each finding: CRITICAL / HIGH / MEDIUM / LOW.\n- For each finding: File, Line, Evidence (exact code snippet), Fix.\n- Do not propose patches; report only.\n`;
    case "tdd-guide":
      return `You are a senior software engineer practising Test-Driven Development. Your goal is to ${task}.\n\nRules:\n- Follow the RED → GREEN → REFACTOR cycle strictly.\n- RED: Write a failing test first that captures the desired behaviour. Commit it.\n- GREEN: Write the minimal production code to make the test pass. No over-engineering.\n- REFACTOR: Clean up duplication and complexity while keeping all tests green.\n- Use the project's existing test framework (vitest, jest, playwright, etc.).\n- Target: happy path + at least 2 edge cases + at least 1 error/rejection path.\n- After each cycle, run the full test suite and confirm no regressions.\n- Output a clear summary: tests added, code changed, coverage delta.\n`;
    case "db-review":
      return `You are a senior database engineer reviewing a codebase. Your goal is to ${task}.\n\nRules:\n- Read all Supabase schema files, migrations, and RLS policies.\n- Identify N+1 queries: loops calling .select() or .eq() per iteration.\n- Review indexes: are foreign keys and common filter columns indexed?\n- Check RLS policies: is every table protected? Are policies row-scoped to auth.uid()?\n- Review joins vs separate queries: prefer single .select() with joins over multiple round-trips.\n- Flag any raw SQL string interpolation (SQL injection risk).\n- Do not propose code patches; return a ranked list of findings with file + line evidence.\n- Classify each finding: CRITICAL / HIGH / MEDIUM / LOW.\n`;
    case "perf-audit":
      return `You are a senior performance engineer auditing a Next.js/React codebase. Your goal is to ${task}.\n\nRules:\n- Analyse bundle size: look for large client-side imports that could be lazy-loaded or server-only.\n- Review React renders: identify missing useMemo/useCallback on expensive computations and callbacks passed to children.\n- Check for large lists without virtualisation (react-virtual, tanstack-virtual).\n- Look for Core Web Vitals anti-patterns: layout shift triggers, render-blocking resources, unoptimised images.\n- Review data fetching: waterfall fetches that could be parallelised, missing loading states.\n- Do not propose code patches; return a ranked list of findings with file + line evidence.\n- Classify each finding by estimated impact: HIGH / MEDIUM / LOW.\n`;
    case "api-design":
      return `You are a senior API architect reviewing or designing REST endpoints. Your goal is to ${task}.\n\nRules:\n- Evaluate resource naming: nouns not verbs, plural collections (/users not /getUser).\n- Evaluate HTTP method usage: GET read-only, POST create, PUT/PATCH update, DELETE remove.\n- Review response shapes: consistent envelopes, proper HTTP status codes, no 200 for errors.\n- Check versioning: is there a /v1/ prefix or Accept-Version header strategy?\n- Review authentication: every non-public endpoint must check auth before processing input.\n- Review error format: errors must return { error: string, code: string } — no stack traces in production.\n- Flag breaking changes vs additive changes.\n- Output a structured review with recommendations; do not propose code patches.\n`;
    case "code-explain":
      return `You are a senior engineer explaining code to a developer. Your goal is to ${task}.\n\nRules:\n- Read the relevant files in full before explaining.\n- Explain the high-level purpose of the code first, then the details.\n- Walk through execution flow step by step.\n- Highlight non-obvious decisions and explain why they exist.\n- Mention edge cases and failure modes.\n- Use plain language; avoid jargon where possible.\n- Do not propose or make any code changes.\n- Output a clear, structured explanation with section headings.\n`;
    default:
      return base;
  }
}

function agentRolePrompt(role: AgentRole, terminalAccess: boolean): string {
  const roleHint =
    role === "frontend"
      ? "You are operating as a Frontend specialist (Next.js/React/CSS/UI behavior). Prefer component-scoped edits."
      : role === "backend"
        ? "You are operating as a Backend specialist (API routes, data flow, integration stability). Prefer server-safe edits."
        : role === "ui"
          ? "You are operating as a UI specialist (layout, typography, spacing, contrast). Avoid backend edits unless required."
          : role === "infra"
            ? "You are operating as an Infrastructure specialist (build/runtime/tooling/reliability)."
            : role === "qa"
              ? "You are operating as a QA specialist (tests, verification, regression prevention)."
              : "You are operating as a generalist coding agent.";
  const terminalHint = terminalAccess
    ? "Terminal access is allowed only via command allowlist and verification steps."
    : "Use terminal commands minimally for verification only.";
  return `${roleHint}\n${terminalHint}`;
}

async function loadWorkspaceBrainProfile(workspaceId?: string): Promise<WorkspaceBrainProfile | null> {
  if (!workspaceId) return null;
  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase
      .from("workspace_identity")
      .select("profile_json")
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ profile_json: Record<string, unknown> | null }>();
    return data?.profile_json ?? null;
  } catch {
    return null;
  }
}

async function loadWorkspaceMemories(input: {
  request: NextRequest;
  workspaceId?: string | undefined;
  task: string;
}): Promise<WorkspaceMemoryEntry[]> {
  if (!input.workspaceId) return [];
  try {
    const payload = await forwardToWorkerOs({
      path: `/v1/os/memories?limit=8`,
      method: "GET",
      cookieHeader: resolveWorkerCookieHeader(input.request),
      authorizationHeader: resolveWorkerAuthorizationHeader(input.request),
    }) as { memories?: WorkspaceMemoryEntry[] };
    return Array.isArray(payload.memories) ? payload.memories.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function buildLongTermMemoryContext(input: {
  workspaceName?: string;
  profile: WorkspaceBrainProfile | null;
  memories: WorkspaceMemoryEntry[];
}): string {
  const lines: string[] = [];
  if (input.workspaceName?.trim()) {
    lines.push(`Workspace: ${input.workspaceName.trim()}`);
  }
  const profile = input.profile ?? {};
  const purpose = typeof profile.purpose === "string" ? profile.purpose.trim() : "";
  const role = typeof profile.role === "string" ? profile.role.trim() : "";
  const goals = Array.isArray(profile.goals)
    ? profile.goals.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
  const operatingRules = Array.isArray(profile.operatingRules)
    ? profile.operatingRules.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
  const prefs = profile.preferences && typeof profile.preferences === "object"
    ? (profile.preferences as Record<string, unknown>)
    : {};
  const language = typeof prefs.language === "string" ? prefs.language.trim() : "";
  const tone = typeof prefs.tone === "string" ? prefs.tone.trim() : "";

  if (purpose) lines.push(`Purpose: ${purpose}`);
  if (role) lines.push(`Role: ${role}`);
  if (goals.length > 0) lines.push(`Goals: ${goals.slice(0, 8).join(" | ")}`);
  if (operatingRules.length > 0) lines.push(`Operating rules: ${operatingRules.slice(0, 8).join(" | ")}`);
  if (language || tone) lines.push(`Communication: ${[language, tone].filter(Boolean).join(" / ")}`);

  if (input.memories.length > 0) {
    lines.push("Recent long-term memories:");
    for (const memory of input.memories.slice(0, 6)) {
      const type = typeof memory.type === "string" ? memory.type : "note";
      const content = typeof memory.content === "string" ? memory.content.trim() : "";
      if (!content) continue;
      lines.push(`- [${type}] ${content}`);
    }
  }

  return lines.join("\n").trim();
}

function injectLongTermMemory(systemOrPrompt: string, longTermMemoryContext?: string): string {
  if (!longTermMemoryContext?.trim()) return systemOrPrompt;
  return `${systemOrPrompt}\n\nLong-term workspace memory:\n${longTermMemoryContext.trim()}\nUse this to prioritize, preserve intent, and stay aligned with workspace goals.`;
}

function taskWithLongTermMemory(task: string, longTermMemoryContext?: string): string {
  if (!longTermMemoryContext?.trim()) return task;
  return `${task}\n\nWorkspace long-term memory:\n${longTermMemoryContext.trim()}`;
}

function isUiOrLayoutTask(task: string, skill?: CodingSkill, role?: AgentRole): boolean {
  if (skill === "ux-ui-design" || role === "ui" || role === "frontend") return true;
  return /ui|ux|layout|spacing|padding|margin|overlap|overlay|viewport|window|fenster|intent line|intentline|css|responsive|visual|design/i.test(task);
}

function buildExecutionDiscipline(input: {
  task: string;
  skill?: CodingSkill | undefined;
  role?: AgentRole | undefined;
  selectedFiles?: string[] | undefined;
}): string {
  const lines = [
    "Execution discipline:",
    "- Diagnose before editing. Identify the root cause and the file that actually owns it.",
    "- Prefer the smallest coherent fix. Do not patch symptoms when a shared layout/runtime constraint is causing the issue.",
    "- Preserve unrelated behaviour and existing architectural patterns.",
    "- After editing, verify with build/tests and use the verification result to decide whether the fix is complete.",
  ];

  if ((input.selectedFiles?.length ?? 0) > 0) {
    lines.push(`- Respect the scoped file allowlist: ${(input.selectedFiles ?? []).slice(0, 8).join(", ")}.`);
    if ((input.selectedFiles?.length ?? 0) <= 3) {
      lines.push("- Treat this as a bounded experiment: keep the result only if verification passes; otherwise discard it and restore the previous file state.");
      lines.push("- Do not widen scope beyond the selected files to chase speculative fixes.");
    }
  }

  if (input.skill === "fix-build") {
    lines.push("- Start from the first concrete error and repair the cause instead of suppressing the failure.");
  }

  if (isUiOrLayoutTask(input.task, input.skill, input.role)) {
    lines.push("- For UI/layout work, inspect shared containers, viewport insets, window managers, and shell constraints before editing a leaf component.");
    lines.push("- If the visible bug is overlap, spacing, or clipping, check coordinating layout systems before changing the visible component itself.");
    lines.push("- Match the existing visual system of nearby shell/app components instead of inventing a new look.");
    lines.push("- Prefer existing theme tokens and CSS variables already used in the repo, such as var(--bg-surface), var(--bg-surface-soft), var(--bg-surface-hover), var(--text-primary), var(--text-secondary), var(--text-muted), and var(--os-border-soft).");
    lines.push("- Do not perform naive dark-to-light inversion by swapping black/white utility classes globally.");
    lines.push("- Do not invent new utility class namespaces or tokens unless they already exist in the codebase.");
    lines.push("- For shell menus, overlays, cards, and launcher surfaces, inspect neighbouring shell files first and reuse their border/background/text treatment.");
    lines.push("- Readability beats literal color inversion: maintain strong text/background contrast and preserve hierarchy for headings, metadata, controls, and support text.");
  }

  return lines.join("\n");
}

function buildTaskWithExecutionDiscipline(input: {
  task: string;
  longTermMemoryContext?: string | undefined;
  skill?: CodingSkill | undefined;
  role?: AgentRole | undefined;
  selectedFiles?: string[] | undefined;
}): string {
  return [
    taskWithLongTermMemory(input.task, input.longTermMemoryContext),
    "",
    buildExecutionDiscipline({
      task: input.task,
      ...(input.skill ? { skill: input.skill } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...((input.selectedFiles?.length ?? 0) > 0 ? { selectedFiles: input.selectedFiles } : {}),
    }),
  ].join("\n");
}

function buildAttachmentPromptContext(attachments?: RunAttachment[]): string[] {
  if (!attachments || attachments.length === 0) return [];
  const imageCount = attachments.filter((attachment) => attachment.mimeType.startsWith("image/")).length;
  const docCount = attachments.length - imageCount;
  const lines = [
    `Attachments: ${attachments.length} total (${imageCount} image${imageCount === 1 ? "" : "s"}, ${docCount} document${docCount === 1 ? "" : "s"}).`,
  ];
  if (imageCount > 0) {
    lines.push("Use uploaded screenshots as visual ground truth for the requested UI or layout change.");
    lines.push("If the screenshot conflicts with the task text or current code, call out the mismatch and follow the screenshot for visible UI details.");
  }
  if (docCount > 0) {
    lines.push("Use uploaded text or data attachments as task context where relevant.");
  }
  return lines;
}

function buildExecutionTraceIntro(input: {
  executionRoot: string;
  stage: "playground" | "dev" | "prod";
  terminalAccess: boolean;
  task: string;
  skill?: CodingSkill;
  role?: AgentRole;
  selectedFiles?: string[];
  folderPath?: string;
  modeLabel: string;
}): string[] {
  const lines = [
    `${input.terminalAccess ? "Local" : "Managed"} agent execution root: ${input.executionRoot}`,
    `Stage: ${input.stage}`,
    input.terminalAccess ? "Terminal access: enabled (local agent)" : "Terminal access: disabled (managed mode)",
    `Execution mode: ${input.modeLabel}`,
    `Agent step 1/5: analyze task and scope.`,
  ];

  if ((input.selectedFiles?.length ?? 0) > 0) {
    lines.push(`Agent scope: ${(input.selectedFiles ?? []).length} selected file(s).`);
  } else if (typeof input.folderPath === "string" && input.folderPath.trim()) {
    lines.push(`Agent scope: folder ${input.folderPath.trim()}.`);
  } else {
    lines.push("Agent scope: unresolved. Backend autoscope will resolve file or folder scope before editing.");
  }

  lines.push("Agent step 2/5: inspect relevant files and confirm root cause before editing.");

  if (isUiOrLayoutTask(input.task, input.skill, input.role)) {
    lines.push("Agent policy: UI/layout root-cause mode is active. Shared shell/window/layout constraints are checked before leaf components.");
  }

  return lines;
}

async function persistCodingMemory(input: {
  request: NextRequest;
  workspaceId?: string | undefined;
  task: string;
  summary: string;
  filesChanged: string[];
}): Promise<void> {
  if (!input.workspaceId || !input.summary.trim()) return;
  try {
    const payload = {
      intent_text: `Persist coding memory: ${input.task}`,
      nodes: [
        {
          id: "n1",
          type: "tool",
          tool_name: "memory_write",
          input: {
            type: "coding",
            content: `Task: ${input.task}\nOutcome: ${input.summary.trim()}\nFiles: ${input.filesChanged.join(", ") || "none"}`,
            confidence: 0.72,
          },
        },
      ],
    };
    const runPayload = await forwardToWorkerOs({
      path: "/v1/os/runs",
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(input.request),
      authorizationHeader: resolveWorkerAuthorizationHeader(input.request),
      body: payload,
    }) as { run?: { id?: string } };
    if (runPayload.run?.id) {
      await forwardToWorkerOs({
        path: "/v1/os/worker/tick",
        method: "POST",
        cookieHeader: resolveWorkerCookieHeader(input.request),
        authorizationHeader: resolveWorkerAuthorizationHeader(input.request),
      }).catch(() => null);
    }
  } catch {
    // Memory persistence must not break coding runs.
  }
}

async function persistArtifactMemory(input: {
  request: NextRequest;
  workspaceId?: string | undefined;
  phase: "plan" | "execute";
  task: string;
  artifact: JsonRecord;
}): Promise<void> {
  if (input.phase !== "execute") return;
  const buildReport =
    input.artifact.buildReport && typeof input.artifact.buildReport === "object"
      ? (input.artifact.buildReport as JsonRecord)
      : null;
  if (buildReport?.success === false) return;
  const summary = typeof input.artifact.summary === "string"
    ? input.artifact.summary
    : typeof input.artifact.executiveSummary === "string"
      ? input.artifact.executiveSummary
      : "";
  const filesChanged = Array.isArray(input.artifact.filesChanged)
    ? input.artifact.filesChanged
        .map((item) =>
          item && typeof item === "object" && typeof (item as JsonRecord).path === "string"
            ? String((item as JsonRecord).path)
            : "",
        )
        .filter(Boolean)
    : [];
  await persistCodingMemory({
    request: input.request,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    task: input.task,
    summary,
    filesChanged,
  });
}

function suggestedProviderForRole(role: AgentRole): ProviderId {
  if (role === "frontend" || role === "ui") return "gemini_cli";
  return "gemini";
}

function looksLikeBroadAnalysisTask(task: string): boolean {
  const lower = task.toLowerCase();
  const analysisIntent =
    /(scan|scanne|audit|review|analys|analyse|inspect|find|list|nenne|top\s*\d+|probleme|issues|risks|root cause|ursache)/.test(
      lower,
    );
  const repoTarget =
    /(repo|repository|project|projekt|codebase|gesamte|entire|whole|app|service|integration)/.test(lower);
  return analysisIntent && repoTarget;
}

function looksLikeWholeRepoReviewTask(task: string): boolean {
  const lower = task.toLowerCase();
  const reviewIntent =
    /(scan|scanne|audit|review|analys|analyse|inspect|find|list|show|nenne|top\s*\d+|issues|probleme|errors|risks)/.test(
      lower,
    );
  const wholeRepoTarget =
    /(whole repo|whole repository|entire repo|entire repository|full repo|gesamte[sr]?\s+repo|ganze[sr]?\s+repo|gesamte[sr]?\s+repository|full codebase|entire codebase)/.test(
      lower,
    );
  return reviewIntent && wholeRepoTarget;
}

function looksLikeLargeRefactorTask(task: string): boolean {
  const lower = task.toLowerCase();
  return /(whole repo|entire repo|ganze repo|full repo|refactor|migrate|überarbeiten|ueberarbeiten|redesign|performance|optimi|architecture|architektur)/.test(lower);
}

function looksLikePatchHeavyTask(task: string): boolean {
  const lower = task.toLowerCase();
  return /(fix build|compile|typecheck|typescript|apply patch|diff|migration|schema|bugfix|hotfix|strict)/.test(lower);
}

/** Resolve best Claude provider: prefer direct API, fall back to Vertex. */
function bestClaudeProvider(statuses: CodeProviderStatusMap): ProviderId | null {
  if (statuses.claude_direct?.configured) return "claude_direct";
  if (statuses.claude_vertex?.configured) return "claude_vertex";
  return null;
}

function bestGeminiProvider(statuses: CodeProviderStatusMap): ProviderId | null {
  if (statuses.gemini_cli?.configured) return "gemini_cli";
  if (statuses.gemini?.configured) return "gemini";
  return null;
}

function resolveVibeProvider(input: {
  task: string;
  role: AgentRole;
  statuses: CodeProviderStatusMap;
  useReasoning: boolean;
  skill?: CodingSkill;
}): ProviderId {
  const task = input.task;
  const statuses = input.statuses;
  const claude = bestClaudeProvider(statuses);
  const gemini = bestGeminiProvider(statuses);

  // ── Skill-based routing (provider-agnostic skills from ECC adaptation) ────
  // Claude preferred: complex reasoning / security / contract design / TDD
  if (
    (input.skill === "security-scan" || input.skill === "tdd-guide" || input.skill === "api-design") &&
    claude
  ) {
    return claude;
  }
  // Gemini preferred: large-context analysis / DB / performance
  if (
    (input.skill === "db-review" || input.skill === "perf-audit") &&
    gemini
  ) {
    return gemini;
  }
  // implement-feature: patch-heavy coding — Gemini CLI gives repo-aware generation with large context.
  if (input.skill === "implement-feature" && gemini) {
    return gemini;
  }
  // code-explain / custom: any provider — fall through to task-content heuristics below.
  // ── End skill routing ────────────────────────────────────────────────────

  if (looksLikeRepoReviewOnlyTask(task) || looksLikeBroadAnalysisTask(task)) {
    // Prefer gemini_cli (repo filesystem access) over direct API for analysis tasks.
    if (gemini) return gemini;
  }

  // Reasoning mode: prefer Gemini CLI first for repo-aware read-first analysis.
  if (input.useReasoning && gemini) {
    return gemini;
  }

  // UI/design/refactor heavy tasks: prefer Gemini CLI first when available.
  if ((input.role === "ui" || input.role === "frontend" || looksLikeLargeRefactorTask(task)) && gemini) {
    return gemini;
  }

  // Patch-heavy / code-edit intensive tasks: prefer Codex(OpenAI) when available.
  if (looksLikePatchHeavyTask(task) && statuses.openai?.configured) {
    return "openai";
  }

  // Default: Gemini first, then OpenAI, then Claude.
  if (gemini) return gemini;
  if (statuses.openai?.configured) return "openai";
  if (claude) return claude;

  return suggestedProviderForRole(input.role);
}

function roleCapabilities(role: AgentRole): { canTerminal: boolean; canProdStage: boolean } {
  switch (role) {
    case "ui":
      return { canTerminal: false, canProdStage: false };
    case "frontend":
      return { canTerminal: true, canProdStage: false };
    case "backend":
    case "infra":
    case "qa":
    case "general":
    default:
      return { canTerminal: true, canProdStage: true };
  }
}

// ── Local plan generator (fallback when backbone unavailable) ─────────────────

function buildLocalPlan(skill: CodingSkill, task: string, repoUrl: string, branch: string): Record<string, unknown> {
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

function buildLocalResult(skill: CodingSkill, task: string, _repoUrl: string): Record<string, unknown> {
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

function buildUxDesignApprovalGateArtifact(input: {
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

async function tryGenerateDesignDraftViaMcp(input: {
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

function detectDesignDraft(input: { draftUrl: string; task: string }): DesignDraftDetection {
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

function withDesignDraftMetadata<T extends JsonRecord>(
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
function fixDiffHunkCounts(diff: string): string {
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
function stripSpuriousRemovedLines(diff: string, fileContent: string): string {
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

function rewriteNoIndexDiffPaths(diff: string, targetRelPath: string, tempRelPath: string): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tempEscaped = escape(tempRelPath);
  return diff
    .replace(new RegExp(`^---\\s+a/${tempEscaped}(\\s.*)?$`, "m"), `--- a/${targetRelPath}$1`)
    .replace(new RegExp(`^\\+\\+\\+\\s+b/${tempEscaped}(\\s.*)?$`, "m"), `+++ b/${targetRelPath}$1`)
    .replace(new RegExp(`^---\\s+${tempEscaped}(\\s.*)?$`, "m"), `--- a/${targetRelPath}$1`)
    .replace(new RegExp(`^\\+\\+\\+\\s+${tempEscaped}(\\s.*)?$`, "m"), `+++ b/${targetRelPath}$1`);
}

async function buildLocalUiColorFallbackResult(input: {
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

function buildLocalReviewResult(task: string, snapshot: RepoSnapshot | null): Record<string, unknown> {
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

function buildLocalReviewWithFixesResult(task: string, snapshot: RepoSnapshot | null): Record<string, unknown> {
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

async function resolveRepoRoot(repoUrl: string): Promise<string> {
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

async function resolveRepoWorkdir(repoUrl: string): Promise<string> {
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

async function resolveVerificationRoot(repoUrl: string, executionRoot: string): Promise<string> {
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

function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
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

async function collectRepoSnapshot(repoUrl: string, folderPath = "", branch = "main", workspaceId = ""): Promise<RepoSnapshot | null> {
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

function formatRepoSnapshot(snapshot: RepoSnapshot | null): string {
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

async function listLocalRepos(): Promise<RepoOption[]> {
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

async function listFolderOptions(repoUrl: string): Promise<FolderOption[]> {
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

async function listGitHubRepos(workspaceId: string): Promise<RepoOption[]> {
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

function trimEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function tokenizeTask(task: string): string[] {
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

async function inferTaskScopedFiles(repoUrl: string, snapshot: RepoSnapshot | null, task: string): Promise<string[]> {
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

  if (/api-gateway|legacy gateway|merlin|mira-os|dead code|deprecated gateway/.test(lowerTask)) {
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

async function inferTaskScopedFilesFast(repoUrl: string, task: string): Promise<string[]> {
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

async function normalizeSelectedFilesForRepo(repoUrl: string, files: string[]): Promise<string[]> {
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

async function correctStaleUiScopeForTask(input: {
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

function looksLikeFrontendUiFile(file: string): boolean {
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

async function inferUxUiDesignScopedFiles(repoUrl: string, snapshot: RepoSnapshot | null, task: string): Promise<string[]> {
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

async function inferUxUiDesignScopedFilesFast(repoUrl: string, task: string): Promise<string[]> {
  return inferTaskScopedFilesFast(repoUrl, task);
}

function looksLikeUiStylingTask(task: string): boolean {
  const lowerTask = task.toLowerCase();
  return /menu|menü|dropdown|profil|profile|account|konto|ui|layout|spacing|overlap|window|panel|builder|workflow|canvas|farbe|color|grün|gruen|green|gelb|yellow|dunkel|hell|weather|wetter|surf|leserlich|readable|contrast/.test(lowerTask);
}

function shouldRequireScopedExecutionForTask(task: string, skill: CodingSkill, role: AgentRole): boolean {
  return (
    skill === "ux-ui-design" ||
    role === "ui" ||
    looksLikeUiStylingTask(task) ||
    /(frontend|component|tsx|css|scss|weather app|mail app|calendar app|tasks app|builder app|intent line|intentline)/i.test(task)
  );
}

function looksLikeRepoReviewOnlyTask(task: string): boolean {
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

function formatRealPathHints(snapshot: RepoSnapshot | null, task: string): string {
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

function fileOptionPriority(file: string): number {
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

function buildSelectedFileHints(selectedFiles: string[]): string {
  if (selectedFiles.length === 0) return "";
  return [
    "Restrict all proposed changes to this explicit allowlist of files:",
    ...selectedFiles.map((file) => `- ${file}`),
    "Do not modify or reference files outside this allowlist.",
  ].join("\n");
}

async function buildSelectedFileGroundTruth(repoUrl: string, selectedFiles: string[]): Promise<string> {
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

function diffTouchedFiles(diff: string): string[] {
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

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  stdinInput?: string,
  timeout = COMMAND_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
    if (stdinInput !== undefined) {
      child.stdin?.end(stdinInput);
    }
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function isEphemeralExecutionChange(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (EPHEMERAL_EXECUTION_CHANGES.has(normalized)) return true;
  return EPHEMERAL_EXECUTION_CHANGE_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function commandForGate(
  gate: HardGate,
  packageManager: "pnpm" | "npm",
  scripts: Record<string, string>
): { command?: string; args: string[]; scriptFound: boolean } {
  const scriptMap: Record<HardGate, string[]> = {
    lint: ["lint"],
    typecheck: ["typecheck", "tsc"],
    tests: ["test"],
    build: ["build"],
    perf: ["perf", "test:perf"],
    a11y: ["a11y", "test:a11y"],
    visual: ["visual", "test:visual"],
  };
  const scriptName = scriptMap[gate].find((name) => Boolean(scripts[name]));
  if (!scriptName) {
    return { args: [], scriptFound: false };
  }
  // Run the build script as-is. Do NOT append --webpack: it is not a valid flag for
  // `next build` in any current Next.js version and blocks Turbopack builds that use
  // `next build --turbopack`. The project's package.json already declares the right flags.
  const args = packageManager === "pnpm" ? [scriptName] : ["run", scriptName];
  return { command: `${packageManager} ${args.join(" ")}`, args, scriptFound: true };
}

function timeoutForGate(gate: HardGate): number {
  switch (gate) {
    case "build":
      return BUILD_GATE_TIMEOUT_MS;
    case "tests":
      return TEST_GATE_TIMEOUT_MS;
    case "typecheck":
      return TYPECHECK_GATE_TIMEOUT_MS;
    default:
      return COMMAND_TIMEOUT_MS;
  }
}

export const __test__ = {
  detectPackageManager,
  commandForGate,
  fixDiffHunkCounts,
  stripSpuriousRemovedLines,
};

async function runHardGateVerification(input: {
  executionRoot: string;
  packageManager: "pnpm" | "npm";
  scripts: Record<string, string>;
  executionLog: string[];
}): Promise<{
  gates: GateReport[];
  allRequiredPassed: boolean;
}> {
  const gates: GateReport[] = [];
  let allRequiredPassed = true;

  for (const gate of HARD_GATES) {
    const resolved = commandForGate(gate, input.packageManager, input.scripts);
    if (!resolved.scriptFound) {
      gates.push({
        gate,
        status: "skipped",
        output: `Missing required gate script for '${gate}'.`,
        attempts: 0,
        required: false,
      });
      input.executionLog.push(`Gate ${gate}: skipped (script not configured).`);
      continue;
    }

    let attempts = 0;
    let status: "passed" | "failed" = "failed";
    let output = "";
    while (attempts <= RETRY_BUDGET_PER_GATE) {
      attempts += 1;
      input.executionLog.push(`Gate ${gate}: attempt ${attempts} (${resolved.command})`);
      const result = await runCommand(input.packageManager, resolved.args, input.executionRoot, undefined, timeoutForGate(gate));
      const timedOut =
        result.code !== 0 &&
        (result.stderr.includes("timed out") ||
          result.stdout.includes("timed out") ||
          result.stderr.includes("ETIMEDOUT") ||
          result.stdout.includes("ETIMEDOUT"));
      output = (result.stdout || result.stderr || `${gate} finished.`).trim();
      if (timedOut) {
        output = [output, `Gate '${gate}' exceeded its timeout of ${Math.round(timeoutForGate(gate) / 1000)}s.`]
          .filter(Boolean)
          .join("\n");
      }
      if (result.code === 0) {
        status = "passed";
        break;
      }
      if (attempts <= RETRY_BUDGET_PER_GATE) {
        input.executionLog.push(`Gate ${gate}: retrying once after failure.`);
      }
    }

    if (status !== "passed") {
      allRequiredPassed = false;
      input.executionLog.push(`Gate ${gate}: failed.`);
    } else {
      input.executionLog.push(`Gate ${gate}: passed.`);
    }

    gates.push({
      gate,
      status,
      ...(resolved.command ? { command: resolved.command } : {}),
      output,
      attempts,
      required: true,
    });
  }

  return { gates, allRequiredPassed };
}

function estimateTokens(...chunks: Array<string | undefined>): number {
  const chars = chunks.reduce((total, chunk) => total + (chunk?.length ?? 0), 0);
  return Math.max(1, Math.round(chars / 4));
}

function estimatedUsd(provider: ProviderId | "fallback", tokens: number): number {
  const usdPer1k: Record<string, number> = {
    gemini: 0.0015,
    gemini_cli: 0.0015,    // same model as gemini (Gemini 2.5 Flash via CLI)
    claude_direct: 0.009,  // claude-sonnet-4-5 direct API pricing
    claude_vertex: 0.009,  // same model via Vertex (+ GCP overhead)
    openai: 0.01,
    fallback: 0.0,
  };
  const per1k = usdPer1k[provider] ?? 0.01;
  return Number(((tokens / 1000) * per1k).toFixed(4));
}

function modelInputTokenLimit(provider: ProviderId | "fallback"): number {
  switch (provider) {
    case "gemini":
    case "gemini_cli":
      return 1_048_576;
    case "openai":
      return 200_000;
    case "claude_direct":
    case "claude_vertex":
      return 200_000;
    default:
      return 128_000;
  }
}

function compressRepoSnapshot(
  snapshot: RepoSnapshot | null,
  mode: "full" | "reduced" | "minimal",
): RepoSnapshot | null {
  if (!snapshot || mode === "full") return snapshot;
  const fileLimit = mode === "minimal" ? 30 : 80;
  const sampleLimit = mode === "minimal" ? 4 : 8;
  const excerptLimit = mode === "minimal" ? 600 : 1200;
  return {
    ...snapshot,
    files: snapshot.files.slice(0, fileLimit),
    sampledFiles: snapshot.sampledFiles.slice(0, sampleLimit).map((sample) => ({
      ...sample,
      excerpt: sample.excerpt.slice(0, excerptLimit),
    })),
    truncated: true,
  };
}

function evaluateRunBudgetProfile(input: {
  provider: ProviderId | "fallback";
  task: string;
  repoSnapshot: RepoSnapshot | null;
  attachments: RunAttachment[];
  selectedFiles: string[];
  budgetUsd: number | undefined;
  skill: CodingSkill;
  suggestionsOnly: boolean;
}): {
  estimatedInputTokens: number;
  modelInputLimit: number;
  budgetStatus: "ok" | "warning" | "over";
  contextCompressionMode: "full" | "reduced" | "minimal";
  recommendedSnapshot: RepoSnapshot | null;
  notes: string[];
} {
  const limit = modelInputTokenLimit(input.provider);
  const taskTokens = estimateTokens(input.task);
  const attachmentTokens = estimateTokens(
    ...(input.attachments ?? []).map((attachment) => `${attachment.name}\n${attachment.mimeType}\n${attachment.dataBase64.slice(0, 4000)}`),
  );
  const selectedFileTokens = estimateTokens((input.selectedFiles ?? []).join("\n"));
  const fullSnapshotTokens = input.repoSnapshot ? estimateTokens(formatRepoSnapshot(input.repoSnapshot)) : 0;
  let contextCompressionMode: "full" | "reduced" | "minimal" = "full";
  if (fullSnapshotTokens > Math.round(limit * 0.2) || (typeof input.budgetUsd === "number" && input.budgetUsd > 0 && input.budgetUsd < 2)) {
    contextCompressionMode = "reduced";
  }
  if (fullSnapshotTokens > Math.round(limit * 0.35) || (typeof input.budgetUsd === "number" && input.budgetUsd > 0 && input.budgetUsd < 1)) {
    contextCompressionMode = "minimal";
  }
  if (input.skill !== "review-code" && !input.suggestionsOnly && input.selectedFiles.length > 0) {
    contextCompressionMode = fullSnapshotTokens > 0 ? "minimal" : contextCompressionMode;
  }
  const recommendedSnapshot = compressRepoSnapshot(input.repoSnapshot, contextCompressionMode);
  const estimatedInputTokens =
    taskTokens +
    attachmentTokens +
    selectedFileTokens +
    (recommendedSnapshot ? estimateTokens(formatRepoSnapshot(recommendedSnapshot)) : 0);
  const estimatedCost = estimatedUsd(input.provider, estimatedInputTokens);
  const budgetStatus =
    estimatedInputTokens > limit
      ? "over"
      : typeof input.budgetUsd === "number" && input.budgetUsd > 0 && estimatedCost > input.budgetUsd
        ? "warning"
        : "ok";
  const notes: string[] = [];
  if (contextCompressionMode !== "full") {
    notes.push(`Token policy: repo context compressed to ${contextCompressionMode} mode for this run.`);
  }
  if (budgetStatus === "warning" && typeof input.budgetUsd === "number") {
    notes.push(`Budget policy: estimated preflight cost may exceed ${input.budgetUsd.toFixed(2)} USD.`);
  }
  if (budgetStatus === "over") {
    notes.push(`Token policy: estimated input exceeds model limit ${limit}. Further compression or narrower scope is required.`);
  }
  return {
    estimatedInputTokens,
    modelInputLimit: limit,
    budgetStatus,
    contextCompressionMode,
    recommendedSnapshot,
    notes,
  };
}

function evaluateComplianceGuardrails(input: {
  task: string;
  attachments: RunAttachment[];
  stage: "playground" | "dev" | "prod";
}): {
  blocked: boolean;
  requiresHumanApproval: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const lowerTask = input.task.toLowerCase();
  const piiSignals = ["passport", "social security", "ssn", "credit card", "iban", "app-specific password"];
  if (piiSignals.some((signal) => lowerTask.includes(signal))) {
    issues.push("PII-sensitive intent detected in task text.");
  }
  if ((input.attachments ?? []).some((attachment) => attachment.mimeType.startsWith("image/") && attachment.sizeBytes && attachment.sizeBytes > 8_000_000)) {
    issues.push("Large image attachment may contain unredacted sensitive data.");
  }
  if (/\b(secret|api[_-]?key|token|password)\b/i.test(input.task)) {
    issues.push("Secret-handling keywords detected. Ensure values are never printed or committed.");
  }
  const requiresHumanApproval = issues.length > 0;
  const blocked = input.stage === "prod" && requiresHumanApproval;
  return { blocked, requiresHumanApproval, issues };
}

function supervisorTeamPlan(input: {
  task: string;
  role: AgentRole;
  budgetUsd: number | undefined;
  deadlineMinutes: number | undefined;
  teamMode?: TeamMode;
  teamConfig?: TeamConfig;
}): {
  totalAgents: number;
  plan: Array<{ role: AgentRole; count: number; focus: string }>;
} {
  const roleFocus: Record<AgentRole, string> = {
    frontend: "UI implementation and state handling.",
    backend: "API reliability, data flow, integrations.",
    qa: "Gate verification and regression prevention.",
    ui: "Visual quality and interaction polish.",
    infra: "Runtime, deployment, and tooling reliability.",
    general: "Cross-functional synthesis and execution support.",
  };

  if (input.teamMode === "manual" && input.teamConfig && typeof input.teamConfig === "object") {
    const manualPlan = (Object.keys(roleFocus) as AgentRole[])
      .map((role) => {
        const rawCount = input.teamConfig?.[role];
        const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, Math.min(8, Math.round(rawCount))) : 0;
        return { role, count, focus: roleFocus[role] };
      })
      .filter((slot) => slot.count > 0);
    const normalized = manualPlan.length > 0 ? manualPlan : [{ role: "qa" as AgentRole, count: 1, focus: roleFocus.qa }];
    return {
      totalAgents: normalized.reduce((total, item) => total + item.count, 0),
      plan: normalized,
    };
  }

  const complexitySignals = tokenizeTask(input.task).length;
  const budgetFactor =
    typeof input.budgetUsd === "number" && input.budgetUsd > 0
      ? input.budgetUsd < 2
        ? 0
        : input.budgetUsd < 5
          ? 1
          : 2
      : 1;
  const deadlineFactor =
    typeof input.deadlineMinutes === "number" && input.deadlineMinutes > 0
      ? input.deadlineMinutes < 30
        ? 0
        : input.deadlineMinutes < 90
          ? 1
          : 2
      : 1;
  const size = Math.max(2, Math.min(8, Math.round(complexitySignals / 6) + budgetFactor + deadlineFactor));
  const plan: Array<{ role: AgentRole; count: number; focus: string }> = [
    { role: "frontend", count: Math.max(1, Math.round(size / 3)), focus: roleFocus.frontend },
    { role: "backend", count: Math.max(1, Math.round(size / 3)), focus: roleFocus.backend },
    { role: "qa", count: 1, focus: roleFocus.qa },
  ];
  if (input.role === "ui" || /design|layout|color|menu|ux|ui/.test(input.task.toLowerCase())) {
    plan.unshift({ role: "ui", count: 1, focus: roleFocus.ui });
  }
  if (budgetFactor >= 2 || deadlineFactor >= 2) {
    plan.push({ role: "infra", count: 1, focus: roleFocus.infra });
  }
  if (/\b(strategy|architecture|company|launch|roadmap|orchestrate)\b/i.test(input.task)) {
    plan.push({ role: "general", count: 1, focus: roleFocus.general });
  }
  return {
    totalAgents: plan.reduce((total, item) => total + item.count, 0),
    plan,
  };
}

async function emitRunMetricsSafe(input: {
  workspaceId: string | undefined;
  runSuccess: boolean;
  estimatedCostUsd: number;
  estimatedTokens: number;
  provider: ProviderId | "fallback";
  stage: "playground" | "dev" | "prod";
}) {
  if (!input.workspaceId) return;
  try {
    await Promise.all([
      emitMetricSample({
        workspaceId: input.workspaceId,
        metricName: "run_success_rate",
        value: input.runSuccess ? 1 : 0,
        tags: { provider: input.provider, stage: input.stage },
      }),
      emitMetricSample({
        workspaceId: input.workspaceId,
        metricName: "p95_tool_latency",
        value: Math.max(1, Math.min(120_000, Math.round(input.estimatedTokens / 2))),
        tags: { provider: input.provider, stage: input.stage },
      }),
      emitMetricSample({
        workspaceId: input.workspaceId,
        metricName: "queue_lag",
        value: 0,
        tags: { provider: input.provider, stage: input.stage, est_cost_usd: input.estimatedCostUsd },
      }),
    ]);
  } catch {
    // Observability must not break the run API.
  }
}

function sanitizeUnifiedDiff(diff: string): string {
  const raw = diff.trim();
  if (!raw) return "";
  const fenced = raw.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i)?.[1];
  return `${(fenced ?? raw).trim()}\n`;
}

async function resolveExecutionRoot(
  repoUrl: string,
  stage: "playground" | "dev" | "prod",
): Promise<{ root: string | null; sourceRoot?: string; previewUrl?: string }> {
  // In Vercel serverless functions the filesystem is read-only compiled output —
  // there are no TypeScript source files and no writable git repo.
  // Return null so applyPatchAndVerify skips patching and returns the generated
  // diff as "completed" (apply locally or promote via playground).
  if (process.env.VERCEL === "1") return { root: null };
  if (parseGitHubRepoUrl(repoUrl)) return { root: null };
  // file:// URLs point to a pre-cloned /tmp directory (GitHub cloud execution mode).
  // Use the path directly — it's already a writable git repo.
  if (repoUrl.startsWith("file://")) return { root: repoUrl.slice(7) };
  const resolvedRoot = await resolveRepoWorkdir(repoUrl);
  const hostRepoRoot = await resolveRepoRoot(repoUrl);
  if (stage !== "playground") {
    return { root: resolvedRoot, ...(resolvedRoot.includes("/frontend") || resolvedRoot === process.cwd() ? { previewUrl: "http://localhost:3000" } : {}) };
  }

  const mirrorRoot = await preparePlaygroundMirror(resolvedRoot);
  // The playground server is externally managed by restart-elyra-local.sh on port 3100.
  // Never try to spawn a server inside the /tmp mirror – just return the well-known URL.
  return { root: mirrorRoot, sourceRoot: hostRepoRoot, previewUrl: `http://localhost:${PLAYGROUND_PREVIEW_PORT}` };
}

function slugifyCommitFragment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "agent-update";
}

function localAgentBaseUrl(): string {
  return (process.env.ELYRA_LOCAL_AGENT_URL?.trim() || `http://127.0.0.1:${process.env.ELYRA_AGENT_PORT || "5050"}`).replace(/\/$/, "");
}

function localAgentPort(): string {
  try {
    return String(new URL(localAgentBaseUrl()).port || "5050");
  } catch {
    return process.env.ELYRA_AGENT_PORT || "5050";
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isLocalAgentAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${localAgentBaseUrl()}/status`, { method: "GET", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function latestMtimeMs(root: string): Promise<number> {
  let latest = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat) {
        latest = Math.max(latest, fileStat.mtimeMs);
      }
    }
  }
  return latest;
}

async function isLocalAgentBuildStale(workerRoot: string, apiServerEntry: string): Promise<boolean> {
  const distStat = await stat(apiServerEntry).catch(() => null);
  if (!distStat) return true;
  const srcRoot = path.join(workerRoot, "src");
  const srcLatest = await latestMtimeMs(srcRoot).catch(() => 0);
  return srcLatest > distStat.mtimeMs;
}

async function stopLocalAgent(workerRoot: string): Promise<void> {
  const port = localAgentPort();
  const lookup = await runCommand("lsof", ["-ti", `tcp:${port}`], workerRoot, undefined, 5_000).catch(() => ({
    code: 1,
    stdout: "",
    stderr: "",
  }));
  const pids = lookup.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // ignore
    }
  }
  if (pids.length > 0) {
    await sleep(750);
  }
}

async function ensureLocalAgentAvailable(): Promise<boolean> {
  const workerRoot = path.resolve(process.cwd(), "..", "worker");
  const apiServerEntry = path.join(workerRoot, "dist", "apiServer.js");
  const staleBuild = await isLocalAgentBuildStale(workerRoot, apiServerEntry);
  const agentRunning = await isLocalAgentAvailable();

  if (!agentRunning || staleBuild) {
    const buildResult = await runCommand("npm", ["run", "build"], workerRoot, undefined, 240_000);
    if (buildResult.code !== 0) {
      return false;
    }
  }

  if (agentRunning && !staleBuild) {
    return true;
  }

  await stopLocalAgent(workerRoot);

  if (!(await pathExists(apiServerEntry))) {
    return false;
  }

  try {
    const child = spawn(process.execPath, [apiServerEntry], {
      cwd: workerRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(500);
    if (await isLocalAgentAvailable()) return true;
  }
  return false;
}

function modeForSkill(skill: CodingSkill): LocalAgentRequestMode {
  switch (skill) {
    case "fix-build":
      return "fix";
    case "write-tests":
    case "tdd-guide":
      return "tests";
    case "refactor-module":
    case "add-types":
      return "refactor";
    case "review-code":
    case "security-scan":
    case "db-review":
    case "perf-audit":
    case "api-design":
    case "code-explain":
      return "feature"; // read-only analysis skills — "feature" mode is most permissive for reading
    default:
      return "feature";
  }
}

function gitOptionsForLocalAgent(input: {
  autoCommit: boolean;
  branchPerAgent: boolean;
  agentBranchName?: string | undefined;
  baseBranch: string;
  stage: "playground" | "dev" | "prod";
  task: string;
}) {
  const enableGit = input.autoCommit || input.branchPerAgent || Boolean(input.agentBranchName);
  if (!enableGit) {
    return { enabled: false, branchMode: "none", commitMode: "none", baseBranch: input.baseBranch, push: false };
  }
  return {
    enabled: true,
    branchStrategy: input.agentBranchName ? "explicit" : input.branchPerAgent ? "new-from-main" : "current",
    targetBranch: input.agentBranchName,
    autoCommit: input.autoCommit,
    commitMessageTemplate: `codex: ${slugifyCommitFragment(input.task)}`,
    branchMode: input.agentBranchName ? "custom" : input.branchPerAgent ? "feature-branch" : "none",
    commitMode: input.autoCommit ? "single" : "none",
    baseBranch: input.baseBranch,
    branchPrefix: "codex/",
    push: input.autoCommit && input.stage !== "playground",
  };
}

async function fetchLocalAgent<T>(pathName: string, body: Record<string, unknown>): Promise<T> {
  if (!(await ensureLocalAgentAvailable())) {
    throw new Error("Local agent is unavailable. Build worker/dist and ensure the agent can bind to 127.0.0.1:5050.");
  }
  const response = await fetch(`${localAgentBaseUrl()}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "object"
        ? String((((payload as Record<string, unknown>).error as Record<string, unknown>).message ?? "Local agent request failed"))
        : payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).message === "string"
          ? String((payload as Record<string, unknown>).message)
          : `Local agent request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function captureExecutionDiff(executionRoot: string, changedFiles: string[], commitSha?: string): Promise<string> {
  if (commitSha) {
    const show = await runCommand("git", ["show", "--format=", commitSha], executionRoot);
    if (show.code === 0 && show.stdout.trim()) {
      return show.stdout;
    }
  }
  if (changedFiles.length === 0) return "";
  const diff = await runCommand("git", ["diff", "--", ...changedFiles], executionRoot);
  return diff.stdout || diff.stderr || "";
}

async function executeViaLocalAgent(input: {
  repoUrl: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent: boolean;
  agentBranchName?: string | undefined;
  baseBranch: string;
  stage: "playground" | "dev" | "prod";
  task: string;
  skill: CodingSkill;
  longTermMemoryContext?: string;
  role?: AgentRole;
  workspaceId?: string | undefined;
  runId?: string;
}): Promise<ExecutionOutcome | null> {
  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) return null;

  const executionLog = buildExecutionTraceIntro({
    executionRoot,
    stage: input.stage,
    terminalAccess: true,
    task: input.task,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.selectedFiles.length > 0 ? { selectedFiles: input.selectedFiles } : {}),
    folderPath: "",
    modeLabel: "local terminal agent",
  });
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };
  const scopedSnapshots =
    input.selectedFiles.length > 0 && input.selectedFiles.length <= 3
      ? await snapshotScopedFiles(executionRoot, input.selectedFiles)
      : [];
  markWorkflow(
    "planned",
    scopedSnapshots.length > 0
      ? "Scoped local-agent experiment prepared with rollback snapshot."
      : "Local-agent execution prepared.",
  );

  const allowDirty = input.stage === "playground";
  const localAgentSafetyLevel = input.stage === "playground" ? "basic" : "strict";
  executionLog.push(
    `Local agent safety level: ${localAgentSafetyLevel}${input.stage === "playground" ? " (playground allows larger rewrites)" : ""}`,
  );
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Local coding agent started.",
    detail: `mode=${input.selectedFiles.length === 1 ? "single-file" : "repo"} safety=${localAgentSafetyLevel}`,
  });
  const taskWithMemory = buildTaskWithExecutionDiscipline({
    task: input.task,
    longTermMemoryContext: input.longTermMemoryContext,
    skill: input.skill,
    role: input.role,
    selectedFiles: input.selectedFiles,
  });
  let applied = false;
  let applyOutput = "";
  let appliedFiles: string[] = [];
  let appliedDiff = "";
  let commitOutput = "";
  markWorkflow(
    "running",
    input.selectedFiles.length === 1 ? "Single-file local agent run started." : "Repository local agent run started.",
  );

  if (input.selectedFiles.length === 1) {
    const resolvedTargetFile = await resolveExistingExecutionPath(executionRoot, input.selectedFiles[0] ?? "");
    if (!resolvedTargetFile) {
      markWorkflow("failed", "Local single-file agent could not resolve the target file inside the execution mirror.");
      return {
        applied: false,
        applyOutput: "Local single-file agent failed: target file is outside the execution mirror or could not be resolved.",
        workflow: {
          current: "failed",
          history: workflowHistory,
        },
        testReport: {
          passed: 0,
          failed: 1,
          skipped: 0,
          duration: "0s",
          output: "Target file could not be resolved inside the execution mirror.",
        },
        buildReport: {
          success: false,
          warnings: 0,
          output: "Target file could not be resolved inside the execution mirror.",
        },
        executionLog: [
          ...executionLog,
          `Single-file target resolution failed for ${input.selectedFiles[0] ?? "(missing file)"}.`,
        ],
      };
    }
    const payload = await fetchLocalAgent<{
      ok: boolean;
      result?: {
        applied?: boolean;
        file?: string;
        diff?: string;
        summary?: string;
        errorMessage?: string;
        originalCode?: string;
      };
    }>("/tasks/run-single", {
      projectRoot: executionRoot,
      file: resolvedTargetFile,
      goal: taskWithMemory,
      mode: modeForSkill(input.skill),
      writeMode: "apply",
      safetyLevel: localAgentSafetyLevel,
      allowDirty,
    });

    const result = payload.result;
    if (!result?.applied || !result.file) {
      markWorkflow("failed", "Local single-file agent did not update the target file.");
      return {
        applied: false,
        applyOutput: result?.errorMessage || result?.summary || "Local single-file agent run failed.",
        workflow: {
          current: "failed",
          history: workflowHistory,
        },
        testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: result?.errorMessage || "No file was updated." },
        buildReport: { success: false, warnings: 0, output: result?.errorMessage || "Local single-file agent run failed." },
        executionLog,
      };
    }
    applied = true;
    appliedFiles = [result.file];
    appliedDiff = result.diff || "";
    applyOutput = result.summary || "Local single-file agent applied changes.";
    executionLog.push("Agent step 3/5: apply single-file edit.");
    executionLog.push(`Local agent updated ${result.file}.`);
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "TOOL_COMPLETED",
      summary: `Updated ${result.file}.`,
      detail: result.summary || "Single-file edit applied.",
    });
  } else {
    const git = gitOptionsForLocalAgent({
      autoCommit: input.autoCommit,
      branchPerAgent: input.branchPerAgent,
      agentBranchName: input.agentBranchName,
      baseBranch: input.baseBranch,
      stage: input.stage,
      task: taskWithMemory,
    });

    const payload = await fetchLocalAgent<{
      ok: boolean;
      feature?: {
        execution?: {
          overallStatus?: string;
          summary?: string;
          stepResults?: Array<{
            stepId?: string;
            status?: string;
            sessionResult?: unknown;
          }>;
          git?: { branchName?: string; commits?: Array<{ commitSha?: string; files?: string[]; message?: string }> };
          tests?: { passed?: boolean; errors?: string[] };
        };
      };
    }>("/features/run", {
      projectRoot: executionRoot,
      description: taskWithMemory,
      writeMode: "apply",
      safetyLevel: localAgentSafetyLevel,
      allowDirty,
      git,
    });

    const execution = payload.feature?.execution;
    const commitEntries = execution?.git?.commits ?? [];
    appliedFiles = Array.from(new Set(commitEntries.flatMap((entry) => entry.files ?? []).filter(Boolean)));
    const lastCommitSha = commitEntries[commitEntries.length - 1]?.commitSha;
    if (appliedFiles.length === 0) {
      const changed = await runCommand("git", ["status", "--porcelain"], executionRoot);
      appliedFiles = changed.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[MADRCU? ]+/, "").trim())
        .filter(Boolean);
    }
    applied = execution?.overallStatus === "success" || appliedFiles.length > 0;
    appliedDiff = await captureExecutionDiff(executionRoot, appliedFiles, lastCommitSha);
    const failedStep = execution?.stepResults?.find((step) => step?.status === "failed");
    const failedSession = failedStep?.sessionResult && typeof failedStep.sessionResult === "object"
      ? (failedStep.sessionResult as Record<string, unknown>)
      : null;
    const failedError =
      typeof failedSession?.errorMessage === "string" ? failedSession.errorMessage :
      typeof failedSession?.blockedReason === "string" ? failedSession.blockedReason :
      typeof failedSession?.error === "string" ? failedSession.error :
      execution?.tests?.errors?.[0] ||
      "";
    applyOutput =
      execution?.summary ||
      failedError ||
      (applied ? "Local feature agent applied changes." : "Local feature agent did not apply changes.");
    if (commitEntries.length > 0) {
      commitOutput = commitEntries
        .map((entry) => `${entry.commitSha ?? "pending"} ${entry.message ?? ""}`.trim())
        .join("\n");
    }
    executionLog.push("Agent step 3/5: apply repository changes.");
    executionLog.push(`Local feature agent status: ${execution?.overallStatus ?? "unknown"}.`);
    if (failedStep?.stepId) {
      executionLog.push(`Failed step: ${failedStep.stepId}.`);
    }
    if (failedError) {
      executionLog.push(`Failure detail: ${failedError}`);
    }
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "TOOL_COMPLETED",
      summary: `Repository apply status: ${execution?.overallStatus ?? "unknown"}.`,
      detail: applyOutput,
    });
  }

  if (!applied || appliedFiles.length === 0) {
    if (scopedSnapshots.length > 0) {
      await restoreScopedFiles(executionRoot, scopedSnapshots);
      executionLog.push("No verified scoped result. Restored snapshot for bounded experiment.");
      markWorkflow("rolled_back", "Restored scoped snapshot because no validated file change was produced.");
    } else {
      markWorkflow("failed", "No validated file change was produced.");
    }
    return {
      applied: false,
      applyOutput,
      workflow: {
        current: scopedSnapshots.length > 0 ? "rolled_back" : "failed",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: applyOutput || "No files changed." },
      buildReport: { success: false, warnings: 0, output: applyOutput || "No files changed." },
      executionLog,
      commitOutput: commitOutput || undefined,
    };
  }

  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push("Agent step 4/5: run verification gates.");
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Verification started.",
    detail: "Running lint, typecheck, tests, and build when configured.",
  });
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });

  const testReport = {
    passed: gateResult.gates.filter((gate) => gate.gate === "tests" && gate.status === "passed").length,
    failed: gateResult.gates.filter((gate) => gate.gate === "tests" && gate.status === "failed").length,
    skipped: gateResult.gates.filter((gate) => gate.gate === "tests" && gate.status === "skipped").length,
    duration: `${gateResult.gates.reduce((count, gate) => count + gate.attempts, 0)} gate attempts`,
    output: gateResult.gates.map((gate) => `[${gate.gate}] ${gate.status}: ${gate.output}`).join("\n\n"),
  };
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const buildReport = {
    success: gateResult.allRequiredPassed,
    warnings: gateResult.gates.filter((gate) => gate.status === "skipped").length,
    output: buildGate?.output || gateResult.gates.map((gate) => `[${gate.gate}] ${gate.status}`).join("\n"),
  };

  if (!gateResult.allRequiredPassed) {
    if (scopedSnapshots.length > 0) {
      await restoreScopedFiles(executionRoot, scopedSnapshots);
      executionLog.push("Verification failed. Restored scoped snapshot and discarded local-agent edits.");
      markWorkflow("gated", "Verification failed.");
      markWorkflow("rolled_back", "Discarded scoped local-agent edits after failed verification.");
    } else {
      markWorkflow("gated", "Verification failed.");
      markWorkflow("failed", "Verification failed and repo changes were left for inspection.");
    }
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "RUN_FAILED",
      summary: scopedSnapshots.length > 0 ? "Verification failed and scoped edits were discarded." : "Verification failed.",
      detail: scopedSnapshots.length > 0
        ? "The agent changed scoped files, but Elyra restored the snapshot after gate failure."
        : "The agent changed files but one or more required gates failed.",
    });
    return {
      applied: false,
      applyOutput: scopedSnapshots.length > 0
        ? "Local agent changed scoped files, but verification failed and Elyra restored the previous state."
        : "Local agent changed files, but verification gates failed.",
      workflow: {
        current: scopedSnapshots.length > 0 ? "rolled_back" : "failed",
        history: workflowHistory,
      },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog,
      appliedFiles,
      appliedDiff,
      commitOutput: commitOutput || undefined,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    };
  }

  markWorkflow("gated", "Verification passed.");
  markWorkflow("promoted", "Verified direct-edit result kept.");
  markWorkflow("gated", "Verification passed.");
  markWorkflow("promoted", "Verified local-agent result kept.");
  executionLog.push("Agent step 5/5: verification passed and result can be published.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "RUN_SUCCEEDED",
    summary: "Verification passed.",
    detail: appliedFiles.length > 0 ? `${appliedFiles.length} file(s) changed.` : undefined,
  });

  if (input.stage === "playground" && executionTarget.sourceRoot) {
    await syncMirrorToPlayground(executionRoot, executionTarget.sourceRoot, appliedFiles);
    executionLog.push("Synced verified files to playground server (localhost:3100).");
    const playgroundSnapshot = await snapshotPlaygroundGit({
      sourceRoot: executionTarget.sourceRoot,
      task: taskWithMemory,
    });
    executionLog.push(playgroundSnapshot.note);
  }

  return {
    applied: true,
    applyOutput,
    workflow: {
      current: "promoted",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    appliedFiles,
    appliedDiff,
    ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    ...(commitOutput ? { commitOutput } : {}),
  };
}

function buildCodexBranchName(stage: "playground" | "dev" | "prod"): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  return `codex/${stage}-${stamp}`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function preparePlaygroundMirror(sourceRoot: string): Promise<string> {
  // Use /tmp for the mirror to avoid Node.js cp EINVAL when the destination is
  // a subdirectory of the source (e.g. sourceRoot/.run/playground/mirror would
  // trigger EINVAL even with a filter that excludes .run).
  const mirrorHash = createHash("sha256").update(sourceRoot).digest("hex").slice(0, 12);
  const mirrorRoot = path.join(require("node:os").tmpdir(), `elyra-mirror-${mirrorHash}`);
  await rm(mirrorRoot, { recursive: true, force: true });
  await mkdir(mirrorRoot, { recursive: true });
  await cp(sourceRoot, mirrorRoot, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === ".git" || name === ".next" || name === ".run" || name === PLAYGROUND_PID_FILE) return false;
      if (name === "node_modules") return false;
      return true;
    },
  });

  const sourceNodeModules = path.join(sourceRoot, "node_modules");
  const targetNodeModules = path.join(mirrorRoot, "node_modules");
  if (await pathExists(sourceNodeModules)) {
    try {
      await symlink(sourceNodeModules, targetNodeModules, "dir");
    } catch {
      // Ignore if the platform does not allow symlinks; build/test may still work if dependencies are hoisted.
    }
  }

  // Initialize a standalone git repo in the mirror so git apply works correctly.
  // Without its own .git, git would inherit the parent repo context and resolve
  // patch paths relative to the wrong working tree root.
  await runCommand("git", ["init"], mirrorRoot, undefined, 10_000);
  await runCommand("git", ["-c", "user.email=agent@elyra.local", "-c", "user.name=ElyraAgent", "commit", "--allow-empty", "-m", "init"], mirrorRoot, undefined, 10_000);
  await runCommand("git", ["add", "-A"], mirrorRoot, undefined, 30_000);
  await runCommand("git", ["-c", "user.email=agent@elyra.local", "-c", "user.name=ElyraAgent", "commit", "-m", "snapshot: playground baseline"], mirrorRoot, undefined, 30_000);

  return mirrorRoot;
}

/**
 * After applying a patch to the playground mirror, sync the changed files to the
 * actual running playground directory (served on port 3100) so that Next.js
 * hot-reload picks up the changes immediately.
 */
async function syncMirrorToPlayground(mirrorRoot: string, sourceRoot: string, changedFiles: string[]): Promise<void> {
  // The running playground server serves from {sourceRoot}/.run/playground/frontend.
  const playgroundDir = path.join(sourceRoot, ".run", "playground", "frontend");
  if (!(await pathExists(playgroundDir))) return;

  // Keep the live preview mirror in sync with the verified temp mirror, not only
  // the changed files. Otherwise a previously broken file can survive in
  // .run/playground/frontend even though the verified temp mirror is clean.
  await cp(mirrorRoot, playgroundDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === ".git" || name === ".next" || name === PLAYGROUND_PID_FILE) return false;
      if (name === "node_modules") return false;
      return true;
    },
  }).catch(() => null);

  // Also ensure explicitly changed paths are overwritten even if their diff path
  // came through with a frontend/ prefix.
  for (const relPath of changedFiles) {
    const strippedPath = relPath.startsWith("frontend/") ? relPath.slice("frontend/".length) : relPath;
    const mirrorFile = path.resolve(mirrorRoot, relPath);
    const fallbackMirrorFile = path.resolve(mirrorRoot, strippedPath);
    const sourceFile = (await pathExists(mirrorFile)) ? mirrorFile : fallbackMirrorFile;
    const playgroundFile = path.resolve(playgroundDir, strippedPath);
    if (!(await pathExists(sourceFile))) continue;
    await mkdir(path.dirname(playgroundFile), { recursive: true }).catch(() => null);
    await cp(sourceFile, playgroundFile, { force: true }).catch(() => null);
  }
}

async function snapshotPlaygroundGit(input: {
  sourceRoot: string;
  task: string;
}): Promise<{ commit?: string; note: string }> {
  const playgroundDir = path.join(input.sourceRoot, ".run", "playground", "frontend");
  if (!(await pathExists(playgroundDir))) {
    return { note: "Playground git snapshot skipped (playground directory not found)." };
  }

  const dotGit = path.join(playgroundDir, ".git");
  if (!(await pathExists(dotGit))) {
    const init = await runCommand("git", ["init"], playgroundDir, undefined, 10_000);
    if (init.code !== 0) {
      return { note: "Playground git snapshot skipped (git init failed)." };
    }
    await runCommand("git", ["config", "user.email", "playground@elyra.local"], playgroundDir, undefined, 10_000);
    await runCommand("git", ["config", "user.name", "Elyra Playground"], playgroundDir, undefined, 10_000);
  }

  await runCommand("git", ["add", "-A"], playgroundDir, undefined, 30_000);
  const status = await runCommand("git", ["status", "--porcelain"], playgroundDir, undefined, 10_000);
  if (!status.stdout.trim()) {
    return { note: "Playground git snapshot skipped (no changes)." };
  }

  const message = `playground: ${slugifyCommitFragment(input.task)}`;
  const commit = await runCommand("git", ["commit", "-m", message], playgroundDir, undefined, 30_000);
  if (commit.code !== 0) {
    return { note: "Playground git snapshot skipped (commit failed)." };
  }
  const head = await runCommand("git", ["rev-parse", "--short", "HEAD"], playgroundDir, undefined, 10_000);
  const commitSha = head.stdout.trim();
  return commitSha
    ? { commit: commitSha, note: `Playground snapshot committed (${commitSha}).` }
    : { note: "Playground snapshot committed." };
}

async function ensurePlaygroundPreviewServer(root: string): Promise<string | undefined> {
  const packageJsonPath = path.join(root, "package.json");
  if (!(await pathExists(packageJsonPath))) return undefined;

  const pidFile = path.join(root, PLAYGROUND_PID_FILE);
  if (await pathExists(pidFile)) {
    try {
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 0);
        return `http://localhost:${PLAYGROUND_PREVIEW_PORT}`;
      }
    } catch {
      // stale pid file – clean it up so we start fresh
      await rm(pidFile, { force: true }).catch(() => null);
    }
  }

  const devArgs = ["run", "dev", "--", "--port", String(PLAYGROUND_PREVIEW_PORT)];
  const child = spawn("npm", devArgs, {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await writeFile(pidFile, String(child.pid ?? ""), "utf8");
  return `http://localhost:${PLAYGROUND_PREVIEW_PORT}`;
}

const PACKAGE_MANAGER_BINARY_CACHE = new Map<string, boolean>();

async function commandExists(command: string): Promise<boolean> {
  const cached = PACKAGE_MANAGER_BINARY_CACHE.get(command);
  if (typeof cached === "boolean") return cached;

  const candidates =
    command === "pnpm"
      ? [
          process.env.PNPM_PATH?.trim(),
          "/opt/homebrew/bin/pnpm",
          "/usr/local/bin/pnpm",
          path.join(process.env.HOME || "", ".local", "share", "pnpm", "pnpm"),
        ].filter(Boolean) as string[]
      : [command];

  for (const candidate of candidates) {
    try {
      const target = candidate.includes("/") ? candidate : candidate;
      await new Promise<void>((resolve, reject) => {
        execFile(target, ["--version"], { timeout: 5_000 }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      PACKAGE_MANAGER_BINARY_CACHE.set(command, true);
      return true;
    } catch {
      // try next candidate
    }
  }

  PACKAGE_MANAGER_BINARY_CACHE.set(command, false);
  return false;
}

async function detectPackageManager(root: string): Promise<"pnpm" | "npm"> {
  const hasPackageLock = await pathExists(path.join(root, "package-lock.json"));
  const hasPnpmLock = await pathExists(path.join(root, "pnpm-lock.yaml"));
  const pnpmAvailable = hasPnpmLock ? await commandExists("pnpm") : false;

  if (hasPackageLock) return "npm";
  if (hasPnpmLock && pnpmAvailable) return "pnpm";
  return "npm";
}

async function loadPackageScripts(root: string, executionLog?: string[]): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return packageJson.scripts ?? {};
  } catch {
    // Missing or invalid package.json — gates will be silently skipped.
    // Log a warning so the user understands why no gates ran.
    executionLog?.push(`Warning: package.json not found or invalid at ${root} — build/test gates will be skipped.`);
    return {};
  }
}

function normalizeDiffPathToken(token: string, executionRoot: string): string {
  if (!token || token === "/dev/null") return token;

  const prefix = token.startsWith("a/") ? "a/" : token.startsWith("b/") ? "b/" : "";
  const rawPath = prefix ? token.slice(2) : token;
  const normalizedRawPath = rawPath.replace(/\\/g, "/");
  const normalizedRoot = path.resolve(executionRoot).replace(/\\/g, "/");
  const repoName = path.basename(normalizedRoot);

  let relativePath = normalizedRawPath;
  if (path.isAbsolute(normalizedRawPath)) {
    if (normalizedRawPath.startsWith(`${normalizedRoot}/`)) {
      relativePath = normalizedRawPath.slice(normalizedRoot.length + 1);
    } else {
      return token;
    }
  } else {
    const mirrorMarker = `/.run/playground/${repoName}/`;
    const mirrorIdx = normalizedRawPath.indexOf(mirrorMarker);
    if (mirrorIdx >= 0) {
      relativePath = normalizedRawPath.slice(mirrorIdx + mirrorMarker.length);
    }
  }

  const clean = relativePath.replace(/^\.\/+/, "");
  if (!clean || clean.startsWith("../")) return token;
  return `${prefix}${clean}`;
}

function normalizeDiffForExecution(diff: string, executionRoot: string): string {
  const lines = diff.split("\n");
  const isTempPath = (value: string) => {
    const raw = value.replace(/^a\//, "").replace(/^b\//, "");
    return raw.startsWith(".run/tmp/") || raw.includes("/.run/tmp/");
  };
  const stripPrefix = (value: string) => value.replace(/^a\//, "").replace(/^b\//, "");
  const withPrefix = (value: string, prefix: "a/" | "b/") => (value.startsWith(prefix) ? value : `${prefix}${value}`);
  let currentOldPath: string | null = null;
  let currentNewPath: string | null = null;
  const normalized = lines.map((line) => {
    const diffHeader = line.match(/^diff --git\s+([^\s]+)\s+([^\s]+)\s*$/);
    if (diffHeader) {
      const leftToken = normalizeDiffPathToken(diffHeader[1] ?? "", executionRoot);
      const rightToken = normalizeDiffPathToken(diffHeader[2] ?? "", executionRoot);
      const leftRaw = stripPrefix(leftToken);
      const rightRaw = stripPrefix(rightToken);
      let nextLeft = leftToken;
      let nextRight = rightToken;
      if (isTempPath(nextLeft) && !isTempPath(nextRight) && rightRaw) {
        nextLeft = withPrefix(rightRaw, "a/");
      } else if (isTempPath(nextRight) && !isTempPath(nextLeft) && leftRaw) {
        nextRight = withPrefix(leftRaw, "b/");
      }
      currentOldPath = stripPrefix(nextLeft);
      currentNewPath = stripPrefix(nextRight);
      return `diff --git ${nextLeft} ${nextRight}`;
    }
    if (line.startsWith("diff --git ")) {
      currentOldPath = null;
      currentNewPath = null;
      return line;
    }
    const match = line.match(/^(\+\+\+|---)\s+([^\s]+)(.*)$/);
    if (!match) return line;
    const marker = match[1] ?? "";
    const token = match[2] ?? "";
    const suffix = match[3] ?? "";
    let normalizedToken = normalizeDiffPathToken(token, executionRoot);

    if (marker === "---") {
      const candidateOld = stripPrefix(normalizedToken);
      if (isTempPath(normalizedToken) && currentNewPath && !isTempPath(currentNewPath)) {
        normalizedToken = `a/${currentNewPath}`;
      }
      currentOldPath = stripPrefix(normalizedToken || candidateOld);
      return `${marker} ${normalizedToken}${suffix}`;
    }

    const candidateNew = stripPrefix(normalizedToken);
    if (isTempPath(normalizedToken) && currentOldPath && !isTempPath(currentOldPath)) {
      normalizedToken = `b/${currentOldPath}`;
    }
    currentNewPath = stripPrefix(normalizedToken || candidateNew);
    return `${marker} ${normalizedToken}${suffix}`;
  });
  return `${normalized.join("\n").trim()}\n`;
}

function rewriteTempDiffToSelectedFile(diff: string, selectedFile: string): string {
  const safePath = selectedFile.replace(/^\.\/+/, "");
  const lines = diff.split("\n");
  const rewritten = lines.map((line) => {
    if (line.startsWith("diff --git ")) {
      return `diff --git a/${safePath} b/${safePath}`;
    }
    const header = line.match(/^(\+\+\+|---)\s+([^\s]+)(.*)$/);
    if (!header) return line;
    const marker = header[1] ?? "";
    const token = header[2] ?? "";
    const suffix = header[3] ?? "";
    if (token === "/dev/null") return line;
    return marker === "---"
      ? `--- a/${safePath}${suffix}`
      : `+++ b/${safePath}${suffix}`;
  });
  return `${rewritten.join("\n").trim()}\n`;
}

const GEMINI_PATCH_REPAIR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    diff: { type: "string" },
    notes: { type: "string" },
  },
  required: ["diff"],
};

const SINGLE_FILE_REWRITE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    content: { type: "string" },
    summary: { type: "string" },
  },
  required: ["content"],
};

const DIRECT_FILE_EDIT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    content: { type: "string" },
    summary: { type: "string" },
    diagnosis: { type: "string" },
    relatedFilesChecked: { type: "array", items: { type: "string" } },
  },
  required: ["content"],
};

function buildExecutionPathVariants(relPath: string): string[] {
  const trimmed = relPath.replace(/^\.\/+/, "").replace(/^\/+/, "");
  const variants = new Set<string>();
  if (!trimmed) return [];
  // Reject paths that escape the repo root via parent-directory traversal.
  if (path.normalize(trimmed).startsWith("..")) return [];
  variants.add(trimmed);
  if (trimmed.startsWith("frontend/")) {
    variants.add(trimmed.slice("frontend/".length));
  } else {
    variants.add(`frontend/${trimmed}`);
  }
  return [...variants];
}

async function resolveExistingExecutionPath(executionRoot: string, relPath: string): Promise<string | null> {
  for (const candidate of buildExecutionPathVariants(relPath)) {
    if (await pathExists(path.resolve(executionRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function snapshotScopedFiles(executionRoot: string, selectedFiles: string[]): Promise<ScopedFileSnapshot[]> {
  const snapshots: ScopedFileSnapshot[] = [];
  for (const relPath of selectedFiles) {
    const targetFile = await resolveExistingExecutionPath(executionRoot, relPath);
    if (!targetFile) continue;
    const content = await readFile(path.resolve(executionRoot, targetFile), "utf8").catch(() => "");
    if (!content) continue;
    snapshots.push({ file: targetFile, content });
  }
  return snapshots;
}

async function restoreScopedFiles(executionRoot: string, snapshots: ScopedFileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    await writeFile(path.resolve(executionRoot, snapshot.file), snapshot.content, "utf8").catch(() => null);
  }
}

async function buildReplacementDiffForFile(input: {
  executionRoot: string;
  targetRelPath: string;
  updatedContent: string;
}): Promise<string | null> {
  const targetRel = input.targetRelPath.replace(/^\/+/, "");
  const tempDir = path.join(input.executionRoot, ".run", "tmp");
  await mkdir(tempDir, { recursive: true });
  const tempRel = path.join(".run", "tmp", `.single-file-rewrite-${Date.now()}.tmp`).replaceAll(path.sep, "/");
  const tempAbs = path.resolve(input.executionRoot, tempRel);
  try {
    await writeFile(tempAbs, input.updatedContent, "utf8");
    const diffResult = await runCommand("git", ["diff", "--no-index", "--", targetRel, tempRel], input.executionRoot);
    const rawDiff = diffResult.stdout || diffResult.stderr || "";
    if (!rawDiff.trim()) return null;
    const diff = rewriteNoIndexDiffPaths(rawDiff, targetRel, tempRel);
    return diff.includes(`+++ b/${targetRel}`) ? sanitizeUnifiedDiff(diff) : null;
  } finally {
    await rm(tempAbs, { force: true }).catch(() => null);
  }
}

async function attemptSingleFileRewriteFallback(input: {
  provider: ProviderId;
  task: string;
  executionRoot: string;
  selectedFiles: string[];
  failedDiff: string;
  applyError: string;
}): Promise<{ diff: string; targetFile: string; summary?: string } | null> {
  const touched = diffTouchedFiles(input.failedDiff);
  const preferred = input.selectedFiles.length === 1
    ? input.selectedFiles[0] ?? ""
    : touched.length === 1
      ? touched[0] ?? ""
      : "";
  if (!preferred) return null;

  const targetFile = await resolveExistingExecutionPath(input.executionRoot, preferred);
  if (!targetFile) return null;

  const targetAbs = path.resolve(input.executionRoot, targetFile);
  let currentContent = "";
  try {
    currentContent = await readFile(targetAbs, "utf8");
  } catch {
    return null;
  }
  if (!currentContent || currentContent.length > 120_000) return null;

  const prompt = [
    `Task: ${input.task}`,
    `Target file: ${targetFile}`,
    "Goal: regenerate the full contents of this single file so the intended change can be applied against the current repository state.",
    "Modify only this file. Preserve unrelated logic and formatting unless required for the task.",
    "",
    "git apply error:",
    input.applyError,
    "",
    "Failed unified diff:",
    input.failedDiff,
    "",
    `Current file (${targetFile}) from the repo:`,
    "----- BEGIN FILE -----",
    currentContent,
    "----- END FILE -----",
    "",
    "Return ONLY strict JSON: {\"content\":\"<full updated file contents>\",\"summary\":\"optional short note\"}.",
    "Rules: content must be the complete file, not a diff. No markdown fences.",
  ].join("\n");

  try {
    const parsed = await callProviderJson(input.provider, {
      system:
        "You repair failed code-edit attempts by rewriting a single existing file from the current repository state. Return strict JSON only.",
      prompt,
      responseJsonSchema: SINGLE_FILE_REWRITE_SCHEMA,
      cwd: input.executionRoot,
    });
    const nextContent = typeof parsed.content === "string" ? parsed.content : "";
    if (!nextContent || nextContent === currentContent) return null;
    const diff = await buildReplacementDiffForFile({
      executionRoot: input.executionRoot,
      targetRelPath: targetFile,
      updatedContent: nextContent,
    });
    if (!diff) return null;
    return {
      diff,
      targetFile,
      ...(typeof parsed.summary === "string" && parsed.summary.trim()
        ? { summary: parsed.summary.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

async function buildUnifiedDiffFromContents(input: {
  executionRoot: string;
  targetRelPath: string;
  beforeContent: string;
  afterContent: string;
}): Promise<string | null> {
  const targetRel = input.targetRelPath.replace(/^\/+/, "");
  const tempDir = path.join(input.executionRoot, ".run", "tmp");
  await mkdir(tempDir, { recursive: true });
  const beforeRel = path.join(".run", "tmp", `.before-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`).replaceAll(path.sep, "/");
  const afterRel = path.join(".run", "tmp", `.after-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`).replaceAll(path.sep, "/");
  const beforeAbs = path.resolve(input.executionRoot, beforeRel);
  const afterAbs = path.resolve(input.executionRoot, afterRel);
  try {
    await writeFile(beforeAbs, input.beforeContent, "utf8");
    await writeFile(afterAbs, input.afterContent, "utf8");
    const diffResult = await runCommand("git", ["diff", "--no-index", "--", beforeRel, afterRel], input.executionRoot);
    const rawDiff = diffResult.stdout || diffResult.stderr || "";
    if (!rawDiff.trim()) return null;
    const rewritten = rawDiff
      .replace(new RegExp(`a/${escape(beforeRel)}`, "g"), `a/${targetRel}`)
      .replace(new RegExp(`b/${escape(afterRel)}`, "g"), `b/${targetRel}`)
      .replace(new RegExp(`--- ${escape(beforeRel)}`, "g"), `--- a/${targetRel}`)
      .replace(new RegExp(`\\+\\+\\+ ${escape(afterRel)}`, "g"), `+++ b/${targetRel}`);
    return sanitizeUnifiedDiff(rewritten);
  } finally {
    await rm(beforeAbs, { force: true }).catch(() => null);
    await rm(afterAbs, { force: true }).catch(() => null);
  }
}

async function generateDirectFileEdit(input: {
  provider: ProviderId;
  task: string;
  longTermMemoryContext?: string | undefined;
  attachments?: RunAttachment[] | undefined;
  executionRoot: string;
  targetFile: string;
  currentContent: string;
  scopedFiles: string[];
  skill?: CodingSkill | undefined;
  role?: AgentRole | undefined;
}): Promise<{ content: string; summary?: string; diagnosis?: string; relatedFilesChecked?: string[] } | null> {
  const contextChunks: string[] = [];
  const relatedFilesChecked: string[] = [];
  for (const rel of input.scopedFiles.slice(0, 3)) {
    const existing = await resolveExistingExecutionPath(input.executionRoot, rel);
    if (!existing || existing === input.targetFile) continue;
    try {
      const content = await readFile(path.resolve(input.executionRoot, existing), "utf8");
      relatedFilesChecked.push(existing);
      contextChunks.push(
        [
          `RELATED FILE: ${existing}`,
          "----- BEGIN FILE -----",
          content.slice(0, 2200),
          "----- END FILE -----",
        ].join("\n")
      );
    } catch {
      // ignore unreadable context
    }
  }

  const prompt = [
    `Task: ${buildTaskWithExecutionDiscipline({
      task: input.task,
      longTermMemoryContext: input.longTermMemoryContext,
      skill: input.skill,
      role: input.role,
      selectedFiles: input.scopedFiles,
    })}`,
    `Target file: ${input.targetFile}`,
    "You are executing a direct file edit with repository write access.",
    "Think like a deterministic coding agent: verify the root cause mentally before changing the file.",
    "Return the COMPLETE updated file content for the target file only.",
    "Do not return a diff. Do not use markdown fences. Preserve unrelated code.",
    "",
    `CURRENT FILE: ${input.targetFile}`,
    "----- BEGIN FILE -----",
    input.currentContent,
    "----- END FILE -----",
    "",
    ...(contextChunks.length > 0
      ? ["Repository context:", ...contextChunks, ""]
      : []),
    "Return strict JSON only: {\"content\":\"<full file>\",\"summary\":\"optional short note\",\"diagnosis\":\"root cause summary\",\"relatedFilesChecked\":[\"optional/path.ts\"]}.",
  ].join("\n");

  try {
    const parsed = await callProviderJson(input.provider, {
      system: injectLongTermMemory(
        "You are a senior coding agent performing direct file edits in a local repository. Diagnose before editing, prefer root-cause fixes, and return only strict JSON with full file contents.",
        input.longTermMemoryContext,
      ),
      prompt,
      responseJsonSchema: DIRECT_FILE_EDIT_SCHEMA,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      cwd: input.executionRoot,
    });
    const content = typeof parsed.content === "string" ? parsed.content : "";
    if (!content || content === input.currentContent) return null;
    return {
      content,
      ...(typeof parsed.summary === "string" && parsed.summary.trim()
        ? { summary: parsed.summary.trim() }
        : {}),
      ...(typeof parsed.diagnosis === "string" && parsed.diagnosis.trim()
        ? { diagnosis: parsed.diagnosis.trim() }
        : {}),
      relatedFilesChecked:
        Array.isArray(parsed.relatedFilesChecked)
          ? parsed.relatedFilesChecked.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : relatedFilesChecked,
    };
  } catch {
    return null;
  }
}

async function applyDirectEditsAndVerify(input: {
  repoUrl: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent?: boolean;
  agentBranchName?: string | undefined;
  stage: "playground" | "dev" | "prod";
  task: string;
  longTermMemoryContext?: string;
  attachments?: RunAttachment[];
  provider: ProviderId;
  budgetUsd: number | undefined;
  deadlineMinutes: number | undefined;
  skill?: CodingSkill;
  role?: AgentRole;
  workspaceId?: string | undefined;
  runId?: string;
}): Promise<ExecutionOutcome | null> {
  if (input.selectedFiles.length === 0 || input.selectedFiles.length > 12) return null;
  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) return null;

  const plans: DirectEditPlan[] = [];
  for (const relPath of input.selectedFiles) {
    const targetFile = await resolveExistingExecutionPath(executionRoot, relPath);
    if (!targetFile) return null;
    const absPath = path.resolve(executionRoot, targetFile);
    const before = await readFile(absPath, "utf8").catch(() => "");
    if (!before) return null;
    const generated = await generateDirectFileEdit({
      provider: input.provider,
      task: input.task,
      longTermMemoryContext: input.longTermMemoryContext,
      attachments: input.attachments,
      executionRoot,
      targetFile,
      currentContent: before,
      scopedFiles: input.selectedFiles,
      skill: input.skill,
      role: input.role,
    });
    if (!generated) continue;
    plans.push({
      file: targetFile,
      before,
      after: generated.content,
      ...(generated.summary ? { summary: generated.summary } : {}),
      ...(generated.diagnosis ? { diagnosis: generated.diagnosis } : {}),
      ...(generated.relatedFilesChecked ? { relatedFilesChecked: generated.relatedFilesChecked } : {}),
    });
  }

  if (plans.length === 0) return null;

  const executionLog: string[] = buildExecutionTraceIntro({
    executionRoot,
    stage: input.stage,
    terminalAccess: false,
    task: input.task,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.selectedFiles.length > 0 ? { selectedFiles: input.selectedFiles } : {}),
    folderPath: "",
    modeLabel: "direct file edits",
  });
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };
  markWorkflow("planned", "Scoped direct-edit experiment prepared.");
  markWorkflow("running", `${plans.length} file(s) queued for direct rewrite.`);
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Direct file edit mode started.",
    detail: `${plans.length} file(s) selected for deterministic rewrite.`,
  });

  for (const plan of plans) {
    await writeFile(path.resolve(executionRoot, plan.file), plan.after, "utf8");
    executionLog.push(`Agent step 3/5: edit ${plan.file}.`);
    executionLog.push(`Direct edit applied to ${plan.file}.`);
    if (plan.summary) executionLog.push(`Edit note: ${plan.summary}`);
    if ("diagnosis" in plan && typeof plan.diagnosis === "string" && plan.diagnosis.trim()) {
      executionLog.push(`Root cause: ${plan.diagnosis}`);
    }
    if ("relatedFilesChecked" in plan && Array.isArray(plan.relatedFilesChecked) && plan.relatedFilesChecked.length > 0) {
      executionLog.push(`Files inspected: ${plan.relatedFilesChecked.slice(0, 4).join(", ")}`);
    }
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "TOOL_COMPLETED",
      summary: `Edited ${plan.file}.`,
      detail: plan.diagnosis || plan.summary || "Direct file edit applied.",
    });
  }

  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push("Agent step 4/5: run verification gates.");
  executionLog.push(`Detected package manager: ${packageManager}`);
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Verification started.",
    detail: "Running configured quality gates.",
  });
  const gateStartedAt = Date.now();
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });
  const gateDurationMs = Date.now() - gateStartedAt;
  const testGate = gateResult.gates.find((gate) => gate.gate === "tests");
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const testReport = {
    passed: testGate?.status === "passed" ? 1 : 0,
    failed: testGate?.status === "failed" ? 1 : 0,
    skipped: testGate?.status === "skipped" ? 1 : 0,
    duration: `${(gateDurationMs / 1000).toFixed(1)}s`,
    output: testGate?.output ?? "Tests gate did not run.",
  };
  const buildReport = {
    success: buildGate?.status === "passed",
    warnings: buildGate?.status === "failed" ? 1 : 0,
    output: buildGate?.output ?? "Build gate did not run.",
  };

  if (!gateResult.allRequiredPassed) {
    for (const plan of plans) {
      await writeFile(path.resolve(executionRoot, plan.file), plan.before, "utf8").catch(() => null);
    }
    markWorkflow("gated", "Verification failed.");
    markWorkflow("rolled_back", "Original scoped files restored after gate failure.");
    executionLog.push("Direct edit gates failed. Restored original files.");
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "RUN_FAILED",
      summary: "Verification failed and edits were rolled back.",
      detail: "Direct edit mode restored original files after gate failure.",
    });
    return {
      applied: false,
      applyOutput: "Hard gate policy failed. Direct edits were rolled back.",
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
      appliedFiles: plans.map((plan) => plan.file),
    };
  }

  executionLog.push("Agent step 5/5: verification passed and result can be published.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "RUN_SUCCEEDED",
    summary: "Verification passed.",
    detail: `${plans.length} file(s) updated successfully.`,
  });

  let appliedDiffParts: string[] = [];
  for (const plan of plans) {
    const diff = await buildUnifiedDiffFromContents({
      executionRoot,
      targetRelPath: plan.file,
      beforeContent: plan.before,
      afterContent: plan.after,
    });
    if (diff) appliedDiffParts.push(diff.trimEnd());
  }
  const appliedDiff = appliedDiffParts.join("\n");

  if (input.stage === "playground" && executionTarget.sourceRoot) {
    try {
      await syncMirrorToPlayground(executionRoot, executionTarget.sourceRoot, plans.map((plan) => plan.file));
      executionLog.push("Synced verified files to playground server (localhost:3100).");
      const playgroundSnapshot = await snapshotPlaygroundGit({
        sourceRoot: executionTarget.sourceRoot,
        task: input.task,
      });
      executionLog.push(playgroundSnapshot.note);
    } catch {
      // ignore preview sync issues after successful verification
    }
  }

  let commitOutput: string | undefined;
  if (input.autoCommit) {
    try {
      if (input.branchPerAgent && input.stage !== "playground") {
        const branchName = (input.agentBranchName?.trim() || buildCodexBranchName(input.stage)).replace(/\s+/g, "-");
        const checkout = await runCommand("git", ["checkout", "-B", branchName], executionRoot);
        if (checkout.code === 0) {
          executionLog.push(`Branch-per-agent active on ${branchName}.`);
        } else {
          executionLog.push("Branch-per-agent checkout failed before auto-commit.");
        }
      }
      const addResult = await runCommand("git", ["add", ...plans.map((plan) => plan.file)], executionRoot);
      if (addResult.code === 0) {
        const commitMessage = `elly(${input.stage}): ${slugifyCommitFragment(input.task)}`;
        const commitResult = await runCommand("git", ["commit", "-m", commitMessage], executionRoot);
        commitOutput = (commitResult.stdout || commitResult.stderr || "git commit completed.").trim();
        executionLog.push(commitResult.code === 0 ? "Git commit created." : "Git commit failed.");
        if (commitResult.code === 0 && input.stage !== "playground") {
          const remoteCheck = await runCommand("git", ["remote", "get-url", "origin"], executionRoot);
          if (remoteCheck.code === 0) {
            const pushResult = await runCommand("git", ["push", "-u", "origin", "HEAD"], executionRoot, undefined, 120_000);
            commitOutput = [commitOutput, pushResult.stdout || pushResult.stderr].filter(Boolean).join("\n");
            executionLog.push(pushResult.code === 0 ? "Git push completed." : "Git push failed.");
          }
        }
      } else {
        commitOutput = (addResult.stderr || addResult.stdout || "git add failed.").trim();
        executionLog.push("Git add failed.");
      }
    } catch (error) {
      commitOutput = error instanceof Error ? error.message : String(error);
      executionLog.push("Auto-commit failed.");
    }
  }

  return {
    applied: true,
    applyOutput: "Direct file edits applied to the local repository.",
    workflow: {
      current: "promoted",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    ...(appliedDiff ? { appliedDiff: `${appliedDiff}\n` } : {}),
    appliedFiles: plans.map((plan) => plan.file),
    ...(commitOutput ? { commitOutput } : {}),
  };
}

async function applyPlaygroundPromotionAndVerify(input: {
  repoUrl: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent?: boolean;
  agentBranchName?: string | undefined;
  stage: "dev" | "prod";
  task: string;
  budgetUsd: number | undefined;
  deadlineMinutes: number | undefined;
}): Promise<ExecutionOutcome | null> {
  if (input.selectedFiles.length === 0) return null;

  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) return null;

  const hostRepoRoot = await resolveRepoRoot(input.repoUrl.split("#")[0] ?? input.repoUrl);
  const playgroundDir = path.join(hostRepoRoot, ".run", "playground", "frontend");
  if (!(await pathExists(playgroundDir))) return null;

  const snapshots: ScopedFileSnapshot[] = [];
  const changedPlans: DirectEditPlan[] = [];
  const appliedFiles: string[] = [];

  for (const relPath of input.selectedFiles) {
    const sourceFile = await resolveExistingExecutionPath(playgroundDir, relPath);
    const targetFile = await resolveExistingExecutionPath(executionRoot, relPath);

    // File was deleted in the playground — remove from target stage too.
    if (!sourceFile && targetFile) {
      const absTarget = path.resolve(executionRoot, targetFile);
      const before = await readFile(absTarget, "utf8").catch(() => "");
      snapshots.push({ file: targetFile, content: before });
      await rm(absTarget, { force: true });
      appliedFiles.push(targetFile);
      changedPlans.push({ file: targetFile, before, after: "", summary: "Deleted in playground — removed from target stage." });
      continue;
    }

    if (!sourceFile || !targetFile) continue;

    const sourceContent = await readFile(path.resolve(playgroundDir, sourceFile), "utf8").catch(() => "");
    const before = await readFile(path.resolve(executionRoot, targetFile), "utf8").catch(() => "");
    // Allow new files: before="" means the file doesn't exist yet in the target stage.
    // Only skip when sourceContent is empty (nothing to promote).
    if (!sourceContent) continue;

    snapshots.push({ file: targetFile, content: before });
    appliedFiles.push(targetFile);
    if (before === sourceContent) continue;

    await writeFile(path.resolve(executionRoot, targetFile), sourceContent, "utf8");
    changedPlans.push({
      file: targetFile,
      before,
      after: sourceContent,
      summary: "Promoted verified playground file into target stage.",
    });
  }

  if (snapshots.length === 0) return null;

  const executionLog: string[] = buildExecutionTraceIntro({
    executionRoot,
    stage: input.stage,
    terminalAccess: false,
    task: input.task,
    selectedFiles: input.selectedFiles,
    folderPath: "",
    modeLabel: "playground promotion",
  });
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };

  markWorkflow("planned", "Promotion replay prepared from verified playground snapshot.");
  markWorkflow("running", "Copying verified playground files into target stage.");
  if (changedPlans.length === 0) {
    executionLog.push("Promotion replay detected that the verified playground state is already present in the target stage.");
  } else {
    for (const plan of changedPlans) {
      executionLog.push(`Promoted ${plan.file} from playground snapshot.`);
    }
  }

  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push(`Detected package manager: ${packageManager}`);
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }

  const gateStartedAt = Date.now();
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });
  const gateDurationMs = Date.now() - gateStartedAt;
  markWorkflow("gated", gateResult.allRequiredPassed ? "All required gates passed." : "One or more required gates failed.");

  const testGate = gateResult.gates.find((gate) => gate.gate === "tests");
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const testReport = {
    passed: testGate?.status === "passed" ? 1 : 0,
    failed: testGate?.status === "failed" ? 1 : 0,
    skipped: testGate?.status === "skipped" ? 1 : 0,
    duration: `${(gateDurationMs / 1000).toFixed(1)}s`,
    output: testGate?.output ?? "Tests gate did not run.",
  };
  const buildReport = {
    success: buildGate?.status === "passed",
    warnings: buildGate?.status === "failed" ? 1 : 0,
    output: buildGate?.output ?? "Build gate did not run.",
  };

  if (!gateResult.allRequiredPassed) {
    await restoreScopedFiles(executionRoot, snapshots);
    executionLog.push("Promotion verification failed. Restored target-stage files from snapshot.");
    markWorkflow("failed", "Gate policy failed.");
    markWorkflow("rolled_back", "Target-stage files restored after failed promotion verification.");
    return {
      applied: false,
      applyOutput: "Promotion verification failed. Target-stage files were restored.",
      workflow: { current: "rolled_back", history: workflowHistory },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
      appliedFiles,
    };
  }

  let appliedDiffParts: string[] = [];
  for (const plan of changedPlans) {
    const diff = await buildUnifiedDiffFromContents({
      executionRoot,
      targetRelPath: plan.file,
      beforeContent: plan.before,
      afterContent: plan.after,
    });
    if (diff) appliedDiffParts.push(diff.trimEnd());
  }

  let commitOutput: string | undefined;
  if (input.autoCommit) {
    try {
      if (input.branchPerAgent) {
        const branchName = (input.agentBranchName?.trim() || buildCodexBranchName(input.stage)).replace(/\s+/g, "-");
        const checkout = await runCommand("git", ["checkout", "-B", branchName], executionRoot);
        if (checkout.code === 0) {
          executionLog.push(`Branch-per-agent active on ${branchName}.`);
        } else {
          executionLog.push("Branch-per-agent checkout failed before auto-commit.");
        }
      }
      const addArgs = changedPlans.length > 0 ? ["add", ...changedPlans.map((plan) => plan.file)] : ["add", ...appliedFiles];
      const addResult = await runCommand("git", addArgs, executionRoot);
      if (addResult.code === 0) {
        const commitMessage = `elly(${input.stage}): ${slugifyCommitFragment(input.task)}`;
        const commitResult = await runCommand("git", ["commit", "-m", commitMessage], executionRoot);
        commitOutput = (commitResult.stdout || commitResult.stderr || "git commit completed.").trim();
        executionLog.push(commitResult.code === 0 ? "Git commit created." : "Git commit failed.");
      } else {
        commitOutput = (addResult.stderr || addResult.stdout || "git add failed.").trim();
        executionLog.push("Git add failed.");
      }
    } catch (error) {
      commitOutput = error instanceof Error ? error.message : String(error);
      executionLog.push("Auto-commit failed.");
    }
  }

  executionLog.push("Promotion replay applied the verified playground state to the target stage.");
  markWorkflow("promoted", "Verified playground files kept in target stage.");
  return {
    applied: true,
    applyOutput: changedPlans.length > 0
      ? "Verified playground files were promoted to the target stage."
      : "Target stage already matched the verified playground state.",
    workflow: {
      current: "promoted",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    ...(appliedDiffParts.length > 0 ? { appliedDiff: `${appliedDiffParts.join("\n")}\n` } : {}),
    appliedFiles,
    ...(commitOutput ? { commitOutput } : {}),
  };
}

async function buildPatchRepairGroundTruth(
  executionRoot: string,
  selectedFiles: string[],
  currentDiff: string
): Promise<string> {
  const candidates = selectedFiles.length > 0 ? selectedFiles : diffTouchedFiles(currentDiff);
  const chunks: string[] = [];
  for (const relPath of candidates.slice(0, 8)) {
    const absPath = path.resolve(executionRoot, relPath);
    if (!(await pathExists(absPath))) continue;
    try {
      const content = await readFile(absPath, "utf8");
      chunks.push(
        [
          `FILE: ${relPath}`,
          "----- BEGIN FILE -----",
          content.slice(0, 4000),
          "----- END FILE -----",
        ].join("\n")
      );
    } catch {
      // ignore unreadable context file
    }
  }
  if (chunks.length === 0) return "";
  return chunks.join("\n\n");
}

async function repairPatchWithGemini(input: {
  task: string;
  executionRoot: string;
  selectedFiles: string[];
  failedDiff: string;
  applyError: string;
}): Promise<string | null> {
  if (!trimEnv("GEMINI_API_KEY")) return null;
  const groundTruth = await buildPatchRepairGroundTruth(input.executionRoot, input.selectedFiles, input.failedDiff);
  const allowlistNote =
    input.selectedFiles.length > 0
      ? `File allowlist (must stay inside):\n${input.selectedFiles.map((file) => `- ${file}`).join("\n")}`
      : "No explicit file allowlist was provided. Keep changes minimal and only for real repository files.";
  const prompt = [
    `Task: ${input.task}`,
    "Goal: repair a unified diff so git apply succeeds against the current repository state.",
    allowlistNote,
    "",
    "Failed git apply error:",
    input.applyError,
    "",
    "Current diff (failed):",
    input.failedDiff,
    "",
    groundTruth
      ? [
          "Ground-truth files from the repo (must match exactly):",
          groundTruth,
        ].join("\n")
      : "No file snapshots were available.",
    "",
    "Return strict JSON only: {\"diff\":\"<valid unified diff>\"}.",
    "Rules: keep paths real, preserve unified diff headers, do not include markdown fences.",
  ].join("\n");

  for (let apiAttempt = 1; apiAttempt <= 2; apiAttempt += 1) {
    try {
      const parsed = await callGeminiJson({
        system:
          "You repair failing git unified diffs. Output only strict JSON with a corrected diff that applies cleanly.",
        prompt,
        // Do NOT pass responseJsonSchema: schema constraints truncate the diff field the same
        // way they truncate the original generate path. Use responseMimeType only.
      });
      const repaired = typeof parsed.diff === "string" ? sanitizeUnifiedDiff(parsed.diff) : "";
      if (!repaired) return null;
      return normalizeDiffForExecution(repaired, input.executionRoot);
    } catch {
      if (apiAttempt < 2) {
        // Transient API failure — wait briefly and retry once.
        await new Promise((res) => setTimeout(res, 1_500));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function applyPatchAndVerify(input: {
  repoUrl: string;
  diff: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent?: boolean | undefined;
  agentBranchName?: string | undefined;
  stage: "playground" | "dev" | "prod";
  task: string;
  strictAi: boolean;
  provider: ProviderId;
  budgetUsd: number | undefined;
  deadlineMinutes: number | undefined;
  /** When true, skip all build/test gates. Used in GitHub PR mode where CI handles verification. */
  skipGates?: boolean;
}): Promise<ExecutionOutcome> {
  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) {
    const cloudMode = process.env.VERCEL === "1";
    return {
      applied: false,
      applyOutput: cloudMode
        ? "Diff generated. Copy it below and apply locally: git apply < patch.diff — or run the Coder on your local dev server (localhost:3000)."
        : "Remote GitHub repositories cannot be modified server-side. A proposed diff was returned only.",
      testReport: {
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: "0s",
        output: "No tests were run.",
      },
      buildReport: {
        success: false,
        warnings: 0,
        output: cloudMode
          ? "Cloud mode: patch apply skipped. Run locally on localhost:3000."
          : "No build was run.",
      },
      executionLog: cloudMode
        ? [
            "Execution root: Vercel cloud (read-only)",
            "Diff generated successfully by AI.",
            "To apply: copy the diff and run on your local dev machine, or open the Coder on localhost:3000.",
          ]
        : [
            "Execution root: remote repository",
            "Server-side patch apply skipped for remote GitHub repositories.",
          ],
    };
  }

  const diff = sanitizeUnifiedDiff(input.diff);
  if (!diff) {
    return {
      applied: false,
      applyOutput: "No unified diff was returned by the provider.",
      testReport: {
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: "0s",
        output: "No tests were run.",
      },
      buildReport: {
        success: true,
        warnings: 0,
        output: "No build was run.",
      },
      executionLog: [
        `Execution root: ${executionRoot}`,
        "No diff returned by provider.",
      ],
    };
  }

  const executionLog: string[] = [
    `Execution root: ${executionRoot}`,
    input.stage === "playground" ? "Playground mode: changes are applied to an isolated mirror copy." : `Stage: ${input.stage}`,
    "Validating generated patch...",
  ];
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };
  markWorkflow("planned", "Plan approved for execution.");
  markWorkflow("approved");
  markWorkflow("running");
  if (input.selectedFiles.length > 0) {
    const touched = diffTouchedFiles(diff);
    const disallowed = touched.filter((file) => !input.selectedFiles.includes(file));
    if (disallowed.length > 0) {
      return {
        applied: false,
        applyOutput: `Patch touched files outside the selected allowlist: ${disallowed.join(", ")}`,
        testReport: {
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: "0s",
          output: "Patch was rejected before apply.",
        },
        buildReport: {
          success: false,
          warnings: 0,
          output: "Patch was rejected before build.",
        },
        executionLog: [
          ...executionLog,
          `Selected file allowlist active (${input.selectedFiles.length} files).`,
          "Patch rejected because it touched files outside the allowlist.",
        ],
      };
    }
    executionLog.push(`Selected file allowlist active (${input.selectedFiles.length} files).`);
  }

  const hadDirtyWorktreeBefore =
    input.autoCommit
      ? ((await runCommand("git", ["status", "--porcelain"], executionRoot)).stdout || "").trim().length > 0
      : false;
  if (hadDirtyWorktreeBefore) {
    executionLog.push("Detected existing uncommitted changes before apply. Auto-commit will be skipped for safety.");
  }

  let appliedDiff = normalizeDiffForExecution(diff, executionRoot);
  if (
    input.selectedFiles.length === 1 &&
    /(^|\n)(diff --git .*\.run\/tmp\/|--- .*\.run\/tmp\/|\+\+\+ .*\.run\/tmp\/)/m.test(appliedDiff)
  ) {
    appliedDiff = rewriteTempDiffToSelectedFile(appliedDiff, input.selectedFiles[0]!);
    executionLog.push("Normalized temp patch paths to selected target file for promotion replay.");
  }
  let appliedFiles: string[] = input.selectedFiles.length > 0 ? [...input.selectedFiles] : [];
  let patchAlreadyPresent = false;

  if (input.branchPerAgent) {
    const branchName = (input.agentBranchName?.trim() || buildCodexBranchName(input.stage)).replace(/\s+/g, "-");
    if (input.stage !== "playground") {
      const dirty = ((await runCommand("git", ["status", "--porcelain"], executionRoot)).stdout || "").trim().length > 0;
      if (dirty) {
        return {
          applied: false,
          applyOutput: "branch-per-agent requires a clean worktree outside playground mode.",
          testReport: {
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: "0s",
            output: "Patch was not applied.",
          },
          buildReport: {
            success: false,
            warnings: 0,
            output: "Patch was not applied.",
          },
          executionLog: [...executionLog, "Branch-per-agent aborted: dirty worktree."],
        };
      }
    }
    const checkout = await runCommand("git", ["checkout", "-B", branchName], executionRoot);
    if (checkout.code !== 0) {
      return {
        applied: false,
        applyOutput: (checkout.stderr || checkout.stdout || "Failed to checkout agent branch.").trim(),
        testReport: {
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: "0s",
          output: "Patch was not applied.",
        },
        buildReport: {
          success: false,
          warnings: 0,
          output: "Patch was not applied.",
        },
        executionLog: [...executionLog, "Branch-per-agent checkout failed."],
      };
    }
    executionLog.push(`Branch-per-agent active on ${branchName}.`);
  }

  const applyCheck = await runCommand("git", ["apply", "--check", "-"], executionRoot, appliedDiff);
  if (applyCheck.code !== 0) {
    const applyFailure = (applyCheck.stderr || applyCheck.stdout || "git apply rejected the generated diff.").trim();
    executionLog.push("Patch validation failed for model diff.");
    executionLog.push(`Apply error: ${applyFailure}`);

    let appliedViaFallback = false;
    const reverseCheck = await runCommand("git", ["apply", "--reverse", "--check", "-"], executionRoot, appliedDiff);
    if (reverseCheck.code === 0) {
      patchAlreadyPresent = true;
      appliedViaFallback = true;
      executionLog.push("Patch already present in target stage; treating promotion replay as idempotent success.");
    }
    // AI diffs often have correct context content but wrong line-number offsets or
    // slightly off indentation. Try progressively more lenient strategies.
    // Strategy 1: -C1 (reduced context requirement, handles line-number offsets)
    if (!appliedViaFallback) {
      const c1Check = await runCommand("git", ["apply", "-C1", "--check", "-"], executionRoot, appliedDiff);
      if (c1Check.code === 0) {
        const c1Apply = await runCommand("git", ["apply", "-C1", "--whitespace=fix", "-"], executionRoot, appliedDiff);
        if (c1Apply.code === 0) {
          appliedViaFallback = true;
          executionLog.push("Patch applied with -C1 (line-number offset tolerated).");
        }
      }
    }
    // Strategy 2: --ignore-whitespace -C1 (handles AI-generated context indentation drift)
    if (!appliedViaFallback) {
      const iwCheck = await runCommand("git", ["apply", "--ignore-whitespace", "-C1", "--check", "-"], executionRoot, appliedDiff);
      if (iwCheck.code === 0) {
        const iwApply = await runCommand("git", ["apply", "--ignore-whitespace", "-C1", "--whitespace=fix", "-"], executionRoot, appliedDiff);
        if (iwApply.code === 0) {
          appliedViaFallback = true;
          executionLog.push("Patch applied with --ignore-whitespace -C1 (context indentation drift tolerated).");
        }
      }
    }
    // Strategy 3: 3-way merge as last resort before AI repair.
    if (!appliedViaFallback) {
      const threeWayApply = await runCommand("git", ["apply", "--3way", "--whitespace=fix", "-"], executionRoot, appliedDiff);
      if (threeWayApply.code === 0) {
        executionLog.push("Patch applied via --3way merge.");
        appliedViaFallback = true;
      } else if (input.strictAi) {
        executionLog.push("git apply --3way failed, attempting AI patch repair.");
      }
    }
    // Strategy 4: GNU patch -F3 — tolerates mismatched trailing/leading context lines.
    // AI-generated diffs often include trailing context that's correct but far from the
    // change site (e.g. closing tags many lines later). GNU patch's fuzz factor skips
    // up to N non-matching context lines rather than rejecting the whole hunk.
    if (!appliedViaFallback) {
      const patchTmpFile = path.join(require("node:os").tmpdir(), `elyra-patch-${Date.now()}.patch`);
      try {
        await writeFile(patchTmpFile, appliedDiff, "utf8");
        const patchDryRun = await runCommand(
          "patch",
          ["--dry-run", "-F", "3", "-p1", "--no-backup-if-mismatch", "-r", "/dev/null", patchTmpFile],
          executionRoot,
        );
        if (patchDryRun.code === 0) {
          const patchApply = await runCommand(
            "patch",
            ["-F", "3", "-p1", "--no-backup-if-mismatch", "-r", "/dev/null", patchTmpFile],
            executionRoot,
          );
          if (patchApply.code === 0) {
            // Stage all modified tracked files so git sees the change.
            await runCommand("git", ["add", "-u"], executionRoot);
            // Verify that something was actually staged (partial-apply guard).
            // GNU patch can report exit 0 while only applying some hunks.
            const staged = await runCommand("git", ["diff", "--cached", "--name-only"], executionRoot);
            const stagedFiles = staged.stdout.split("\n").filter(Boolean);
            if (stagedFiles.length === 0) {
              // Nothing staged — rollback and fall through to AI repair.
              await runCommand("git", ["restore", "."], executionRoot).catch(() => {});
              executionLog.push("GNU patch exit 0 but no files staged — falling through to AI repair.");
            } else {
              // Populate appliedFiles so autoCommit selectively stages the right files.
              appliedFiles.push(...stagedFiles);
              appliedViaFallback = true;
              executionLog.push(`Patch applied via GNU patch -F3 (${stagedFiles.length} file(s) staged).`);
            }
          }
        }
      } catch {
        // ignore — fall through to AI repair
      } finally {
        rm(patchTmpFile, { force: true }).catch(() => undefined);
      }
    }

    if (!appliedViaFallback) {
      let currentDiff = appliedDiff;
      let repairedApplied = false;
      const maxRepairAttempts = input.strictAi ? 2 : 1;
      for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
        executionLog.push(`AI patch repair attempt ${attempt}/${maxRepairAttempts}...`);
        const repairedDiff = await repairPatchWithGemini({
          task: input.task,
          executionRoot,
          selectedFiles: input.selectedFiles,
          failedDiff: currentDiff,
          applyError: applyFailure,
        });
        if (!repairedDiff) {
          executionLog.push("AI patch repair returned no usable diff.");
          break;
        }
        currentDiff = repairedDiff;
        const repairedCheck = await runCommand("git", ["apply", "--check", "-"], executionRoot, currentDiff);
        if (repairedCheck.code !== 0) {
          executionLog.push(`AI repair attempt ${attempt} still failed validation.`);
          continue;
        }
        const repairedApply = await runCommand("git", ["apply", "--whitespace=fix", "-"], executionRoot, currentDiff);
        if (repairedApply.code === 0) {
          appliedDiff = currentDiff;
          repairedApplied = true;
          executionLog.push(`AI patch repair attempt ${attempt} applied successfully.`);
          break;
        }
        executionLog.push(`AI repair attempt ${attempt} failed during apply step.`);
      }

      if (!repairedApplied) {
        const singleFileRewrite = await attemptSingleFileRewriteFallback({
          provider: input.provider,
          task: input.task,
          executionRoot,
          selectedFiles: input.selectedFiles,
          failedDiff: currentDiff,
          applyError: applyFailure,
        });
        if (singleFileRewrite) {
          executionLog.push(`Single-file rewrite fallback generated a fresh diff for ${singleFileRewrite.targetFile}.`);
          if (singleFileRewrite.summary) {
            executionLog.push(`Rewrite note: ${singleFileRewrite.summary}`);
          }
          currentDiff = singleFileRewrite.diff;
          const rewriteCheck = await runCommand("git", ["apply", "--check", "-"], executionRoot, currentDiff);
          if (rewriteCheck.code === 0) {
            const rewriteApply = await runCommand("git", ["apply", "--whitespace=fix", "-"], executionRoot, currentDiff);
            if (rewriteApply.code === 0) {
              appliedDiff = currentDiff;
              repairedApplied = true;
              executionLog.push(`Single-file rewrite fallback applied successfully to ${singleFileRewrite.targetFile}.`);
            } else {
              executionLog.push("Single-file rewrite fallback produced a diff but git apply still failed.");
            }
          } else {
            executionLog.push("Single-file rewrite fallback produced a diff but validation still failed.");
          }
        }
      }

      if (!repairedApplied) {
        return {
          applied: false,
          applyOutput: applyFailure,
          testReport: {
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: "0s",
            output: "Patch was not applied, so tests were skipped.",
          },
          buildReport: {
            success: false,
            warnings: 0,
            output: "Patch was not applied, so build was skipped.",
          },
          executionLog: [
            ...executionLog,
            input.strictAi
              ? "Patch apply failed in strict mode after AI repair attempts."
              : "Patch apply failed after AI repair attempt.",
          ],
        };
      }
    }
  } else {
    executionLog.push("Patch validation passed.");

    const applyResult = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        "git",
        ["apply", "--whitespace=fix", "-"],
        { cwd: executionRoot, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 4 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: number }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          resolve({
            code,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
        },
      );
      child.stdin?.end(appliedDiff);
    });

    if (applyResult.code !== 0) {
      return {
        applied: false,
        applyOutput: (applyResult.stderr || applyResult.stdout || "git apply failed.").trim(),
        testReport: {
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: "0s",
          output: "Patch application failed, so tests were skipped.",
        },
        buildReport: {
          success: false,
          warnings: 0,
          output: "Patch application failed, so build was skipped.",
        },
        executionLog: [
          ...executionLog,
          "Patch application failed.",
        ],
      };
    }
    executionLog.push("Patch applied to local repository.");
  }

  if (appliedFiles.length === 0) {
    appliedFiles = diffTouchedFiles(appliedDiff);
  }

  // GitHub PR mode: skip gates — the PR's CI pipeline handles verification.
  if (input.skipGates) {
    executionLog.push("Gates skipped (GitHub PR mode) — CI will verify the PR branch.");
    return {
      applied: true,
      applyOutput: "Patch applied to /tmp clone. Gates skipped — CI will verify the PR.",
      workflow: { current: "promoted" as const, history: workflowHistory },
      gates: [],
      testReport: { passed: 0, failed: 0, skipped: 1, duration: "0s", output: "Gates skipped — CI will verify the PR branch." },
      buildReport: { success: true, warnings: 0, output: "Build gate skipped — CI will verify the PR." },
      executionLog,
      appliedFiles,
      appliedDiff,
    };
  }

  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push(`Detected package manager: ${packageManager}`);
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }
  const gateStartedAt = Date.now();
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });
  const gateDurationMs = Date.now() - gateStartedAt;
  markWorkflow("gated", gateResult.allRequiredPassed ? "All required gates passed." : "One or more required gates failed.");

  const testGate = gateResult.gates.find((gate) => gate.gate === "tests");
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const testReport = {
    passed: testGate?.status === "passed" ? 1 : 0,
    failed: testGate?.status === "failed" ? 1 : 0,
    skipped: testGate?.status === "skipped" ? 1 : 0,
    duration: `${(gateDurationMs / 1000).toFixed(1)}s`,
    output: testGate?.output ?? "Tests gate did not run.",
  };
  const buildReport = {
    success: buildGate?.status === "passed",
    warnings: buildGate?.status === "failed" ? 1 : 0,
    output: buildGate?.output ?? "Build gate did not run.",
  };

  if (!gateResult.allRequiredPassed) {
    executionLog.push("Hard gate policy failed. Attempting rollback policy.");
    markWorkflow("failed", "Gate policy failed.");
    if (patchAlreadyPresent) {
      executionLog.push("Rollback skipped because patch was already present before this promotion replay.");
    } else {
      const rollback = await runCommand("git", ["apply", "-R", "--whitespace=fix", "-"], executionRoot, appliedDiff);
      if (rollback.code === 0) {
        executionLog.push("Rollback completed (git apply -R).");
        markWorkflow("rolled_back", "Patch rolled back after gate failure.");
      } else {
        executionLog.push("Rollback failed. Manual cleanup may be required.");
      }
    }
    return {
      applied: false,
      applyOutput: "Hard gate policy failed. Patch was rolled back.",
      workflow: { current: "failed", history: workflowHistory },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
      appliedDiff,
      ...(appliedFiles.length > 0 ? { appliedFiles } : {}),
    };
  }

  // Only sync successful playground runs into the live preview. This prevents a
  // failed mirror run from leaving localhost:3100 in a broken state.
  if (input.stage === "playground" && executionTarget.sourceRoot) {
    try {
      await syncMirrorToPlayground(executionRoot, executionTarget.sourceRoot, appliedFiles);
      executionLog.push("Synced verified files to playground server (localhost:3100).");
      const playgroundSnapshot = await snapshotPlaygroundGit({
        sourceRoot: executionTarget.sourceRoot,
        task: input.task,
      });
      executionLog.push(playgroundSnapshot.note);
    } catch {
      // Best-effort: don't fail the run if preview sync fails after verification.
    }
  }

  const estimatedTokenCount = estimateTokens(input.task, appliedDiff, executionLog.join("\n"));
  const estimatedRunUsd = estimatedUsd(input.provider, estimatedTokenCount);
  executionLog.push(`Telemetry estimate: ${estimatedTokenCount} tokens, ~${estimatedRunUsd.toFixed(4)} USD.`);
  if (typeof input.budgetUsd === "number" && input.budgetUsd > 0 && estimatedRunUsd > input.budgetUsd) {
    executionLog.push(`Budget policy warning: estimated cost ${estimatedRunUsd.toFixed(4)} exceeds budget ${input.budgetUsd.toFixed(4)}.`);
  }
  if (typeof input.deadlineMinutes === "number" && input.deadlineMinutes > 0) {
    const elapsedMinutes = gateDurationMs / 60_000;
    if (elapsedMinutes > input.deadlineMinutes) {
      executionLog.push(`Deadline policy warning: elapsed ${elapsedMinutes.toFixed(2)} min exceeds deadline ${input.deadlineMinutes} min.`);
    }
  }

  const previewUrl =
    executionRoot.includes("/frontend") || executionRoot === process.cwd()
      ? "http://localhost:3000"
      : undefined;
  if (previewUrl) {
    executionLog.push(`Live preview available at ${previewUrl}`);
  }

  let commitOutput: string | undefined;
  if (input.autoCommit) {
    if (testReport.failed > 0 || buildReport.success === false) {
      commitOutput = "Auto-commit skipped because test or build verification failed.";
      executionLog.push("Auto-commit skipped because verification failed.");
    } else if (patchAlreadyPresent) {
      commitOutput = "Auto-commit skipped because the patch was already present in this stage.";
      executionLog.push("Auto-commit skipped because promotion replay was idempotent.");
    } else if (hadDirtyWorktreeBefore) {
      commitOutput = "Auto-commit skipped because the worktree had uncommitted changes before this run.";
      executionLog.push("Auto-commit skipped because the worktree was already dirty.");
    } else {
      executionLog.push("Creating isolated codex branch for this run...");
      if (!input.branchPerAgent) {
        const branchName = buildCodexBranchName(input.stage);
        const checkoutResult = await runCommand("git", ["checkout", "-b", branchName], executionRoot);
        if (checkoutResult.code !== 0) {
          commitOutput = (checkoutResult.stderr || checkoutResult.stdout || "Unable to create codex branch.").trim();
          executionLog.push("Auto-commit skipped because codex branch creation failed.");
          return {
            applied: true,
            applyOutput: "Patch applied to the local repository.",
            testReport,
            buildReport,
            executionLog,
            ...(commitOutput ? { commitOutput } : {}),
            appliedDiff,
            ...(appliedFiles.length > 0 ? { appliedFiles } : {}),
          };
        }
        executionLog.push(`Created branch ${branchName}.`);
      }
      executionLog.push("Creating git commit for applied changes...");
      const addResult = await runCommand("git", ["add", "-A"], executionRoot);
      if (addResult.code === 0) {
        const commitMessage = `elly(${input.stage}): ${slugifyCommitFragment(input.task)}`;
        const commitResult = await runCommand("git", ["commit", "-m", commitMessage], executionRoot);
        commitOutput = (commitResult.stdout || commitResult.stderr || "git commit completed.").trim();
        executionLog.push(commitResult.code === 0 ? "Git commit created." : "Git commit failed.");
        if (commitResult.code === 0 && input.stage !== "playground") {
          const remoteCheck = await runCommand("git", ["remote", "get-url", "origin"], executionRoot);
          if (remoteCheck.code === 0) {
            const pushResult = await runCommand("git", ["push", "-u", "origin", "HEAD"], executionRoot, undefined, 120_000);
            commitOutput = [commitOutput, pushResult.stdout || pushResult.stderr].filter(Boolean).join("\n");
            executionLog.push(pushResult.code === 0 ? "Git push completed." : "Git push failed.");
          }
        }
      } else {
        commitOutput = (addResult.stderr || addResult.stdout || "git add failed.").trim();
        executionLog.push("Git add failed.");
      }
    }
  }

  const resolvedPreviewUrl = executionTarget.previewUrl ?? previewUrl;
  markWorkflow(input.stage === "prod" ? "promoted" : "running", `Execution finished in stage '${input.stage}'.`);

  return {
    applied: true,
    applyOutput: "Patch applied to the local repository.",
    workflow: {
      current: input.stage === "prod" ? "promoted" : "gated",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    ...(typeof resolvedPreviewUrl === "string" && resolvedPreviewUrl.length > 0 ? { previewUrl: resolvedPreviewUrl } : {}),
    ...(commitOutput ? { commitOutput } : {}),
    appliedDiff,
    ...(appliedFiles.length > 0 ? { appliedFiles } : {}),
  };
}

function getCodeProviderStatuses(): CodeProviderStatusMap {
  const base = getProviderStatuses();
  const geminiKey = trimEnv("GEMINI_API_KEY");
  const geminiModel = trimEnv("GEMINI_MODEL", "SLIDES_GEMINI_MODEL") || "gemini-2.5-flash";
  const geminiCliModel = trimEnv("GEMINI_CLI_MODEL") || "gemini-3.1-pro-preview";
  const geminiCliAvailable = detectGeminiCliAvailable();
  return {
    ...base,
    gemini: {
      ...base.gemini,
      configured: geminiKey.length > 0,
      label: "Gemini (direct API)",
      model: geminiModel,
      issues: geminiKey ? [] : ["Set GEMINI_API_KEY in .env.local to run the coding agent with Gemini."],
    },
    gemini_cli: {
      ...base.gemini_cli,
      configured: geminiCliAvailable,
      label: "Gemini CLI",
      model: geminiCliModel,
      issues: geminiCliAvailable
        ? []
        : ["Install/authenticate gemini CLI and configure a stable auth path (API key or Vertex) to enable repo-aware CLI analysis."],
    },
    openai: {
      ...base.openai,
      label: "Codex (OpenAI)",
    },
  };
}

let cachedGeminiCliBinary: string | null | undefined;

function detectGeminiCliAvailable(): boolean {
  return Boolean(resolveGeminiCliBinary());
}

function resolveGeminiCliBinary(): string | null {
  if (cachedGeminiCliBinary && existsSync(cachedGeminiCliBinary)) {
    return cachedGeminiCliBinary;
  }
  const explicit = trimEnv("GEMINI_CLI_PATH");
  if (explicit && existsSync(explicit)) {
    cachedGeminiCliBinary = explicit;
    return cachedGeminiCliBinary;
  }
  const probe = spawnSync("/bin/zsh", ["-lc", "command -v gemini"], {
    encoding: "utf8",
    env: process.env,
    timeout: 5000,
  });
  const resolved = probe.status === 0 ? probe.stdout.trim() : "";
  if (resolved && existsSync(resolved)) {
    cachedGeminiCliBinary = resolved;
    return cachedGeminiCliBinary;
  }
  const home = process.env.HOME?.trim() || "";
  const fallbackCandidates = [
    home ? path.join(home, ".nvm", "versions", "node", "v20.19.5", "bin", "gemini") : "",
    home ? path.join(home, ".nvm", "versions", "node", "current", "bin", "gemini") : "",
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
  ].filter(Boolean);
  for (const candidate of fallbackCandidates) {
    if (existsSync(candidate)) {
      cachedGeminiCliBinary = candidate;
      return cachedGeminiCliBinary;
    }
  }
  return null;
}

function geminiCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Ensure /bin and /usr/bin are in PATH so the CLI can spawn bash/sh tool calls.
  // Use segment-based check (split on ":") — substring match would falsely detect /bin inside /usr/bin.
  const currentPath = env.PATH ?? "";
  const pathSegments = new Set(currentPath.split(":"));
  const pathExtras = ["/bin", "/usr/bin", "/usr/local/bin"].filter((p) => !pathSegments.has(p));
  if (pathExtras.length > 0) env.PATH = `${pathExtras.join(":")}:${currentPath}`;

  const geminiApiKey = trimEnv("GEMINI_API_KEY");
  // GEMINI_CLI_AUTH_MODE=vertex  → force Vertex/GCP credits even if API key is present
  // GEMINI_CLI_AUTH_MODE=api-key → force AI Studio API key
  // GEMINI_CLI_AUTH_MODE=auto    → Vertex if no API key, otherwise API key (legacy default)
  const authMode = (trimEnv("GEMINI_CLI_AUTH_MODE") || "auto").toLowerCase();
  const useVertex = authMode === "vertex" || (!geminiApiKey && authMode !== "api-key");

  if (geminiApiKey && !useVertex) {
    env.GEMINI_API_KEY = geminiApiKey;
    env.GEMINI_DEFAULT_AUTH_TYPE = "gemini-api-key";
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_LOCATION;
    return env;
  }

  // Vertex/ADC path — strip API key so the CLI authenticates via gcloud ADC (GCP credits)
  delete env.GEMINI_API_KEY;
  delete env.GEMINI_DEFAULT_AUTH_TYPE;
  env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "elyra-core-dev-app";
  env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
  return env;
}

class GeminiCliRuntimeError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(code: string, message: string, options?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "GeminiCliRuntimeError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status ?? 503;
  }
}

function buildProviderRuntimeFailure(input: {
  error: unknown;
  fallbackMessage?: string;
}): { code: string; error: string; status: number } {
  if (input.error instanceof GeminiCliRuntimeError) {
    return {
      code: input.error.code,
      error: input.error.message,
      status: input.error.status,
    };
  }

  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const classified = classifyGeminiCliRuntimeError(message);
  if (classified) {
    return {
      code: classified.code,
      error: classified.message,
      status: classified.status,
    };
  }

  return {
    code: "MODEL_UNAVAILABLE_NO_SAFE_FALLBACK",
    error: truncateRuntimeFailureMessage(input.fallbackMessage ?? message),
    status: 503,
  };
}

function truncateRuntimeFailureMessage(message: string, maxLength = 600): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

let cachedGeminiCliAuthHealth:
  | {
      ok: boolean;
      checkedAt: number;
      error?: GeminiCliRuntimeError;
    }
  | undefined;

function classifyGeminiCliRuntimeError(message: string): GeminiCliRuntimeError | null {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("api key") ||
    normalized.includes("gemini_api_key") ||
    normalized.includes("unauthenticated") ||
    normalized.includes("credentials_missing")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_AUTH_INVALID",
      "Gemini CLI auth is invalid or missing. Configure a valid GEMINI_API_KEY or restore Vertex credentials, then retry.",
      { retryable: true, status: 401 },
    );
  }
  if (
    normalized.includes("invalid_rapt") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("reauth related error")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_REAUTH_REQUIRED",
      "Gemini CLI needs Google reauthentication. Run `gcloud auth login paul@elyra-core.app` and `gcloud auth application-default login`, then retry.",
      { retryable: true, status: 401 },
    );
  }
  if (
    normalized.includes("resource_exhausted") ||
    normalized.includes("too many requests") ||
    normalized.includes("status 429")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_RATE_LIMITED",
      "Gemini CLI via Vertex is rate-limited for this project right now. Retry later or use a smaller scoped task / gemini-2.5-pro path.",
      { retryable: true, status: 429 },
    );
  }
  if (
    normalized.includes("not installed") ||
    normalized.includes("not available on path")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_NOT_READY",
      "Gemini CLI is not installed or not available on PATH for the Elyra server process.",
      { retryable: false, status: 503 },
    );
  }
  return null;
}

async function ensureGeminiCliAuthReady(): Promise<void> {
  if (cachedGeminiCliAuthHealth && Date.now() - cachedGeminiCliAuthHealth.checkedAt < 60_000) {
    if (!cachedGeminiCliAuthHealth.ok && cachedGeminiCliAuthHealth.error) {
      throw cachedGeminiCliAuthHealth.error;
    }
    return;
  }

  try {
    const geminiApiKey = trimEnv("GEMINI_API_KEY");
    if (geminiApiKey) {
      cachedGeminiCliAuthHealth = {
        ok: true,
        checkedAt: Date.now(),
      };
      return;
    }
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "gcloud",
        ["auth", "application-default", "print-access-token"],
        {
          env: geminiCliEnv(),
          timeout: 15_000,
          maxBuffer: 256 * 1024,
        },
        (error, token, stderr) => {
          if (error) {
            const detail = stderr?.trim() || error.message;
            reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
            return;
          }
          resolve(token);
        },
      );
    });
    if (!stdout.trim()) {
      throw new GeminiCliRuntimeError(
        "GEMINI_CLI_AUTH_EMPTY",
        "Gemini CLI auth check returned no access token. Re-run Google authentication and retry.",
        { retryable: true, status: 401 },
      );
    }
    cachedGeminiCliAuthHealth = {
      ok: true,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const classified =
      error instanceof GeminiCliRuntimeError
        ? error
        : classifyGeminiCliRuntimeError(error instanceof Error ? error.message : String(error)) ??
          new GeminiCliRuntimeError(
            "GEMINI_CLI_AUTH_FAILED",
            error instanceof Error ? error.message : String(error),
            { retryable: true, status: 503 },
          );
    cachedGeminiCliAuthHealth = {
      ok: false,
      checkedAt: Date.now(),
      error: classified,
    };
    throw classified;
  }
}

function resolveLocalProviderCwd(repoUrl?: string, fallback?: string): string | undefined {
  const candidate = (repoUrl ?? "").split("#")[0]?.trim();
  if (candidate && !parseGitHubRepoUrl(candidate)) return candidate;
  return fallback;
}

function extractGeminiText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

function sanitizeLikelyJson(input: string): string {
  let next = input.trim().replace(/^\uFEFF/, "");
  // Remove markdown fences if they leaked into the payload.
  next = next.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Remove JS-style comments that occasionally appear in model outputs.
  next = next.replace(/\/\*[\s\S]*?\*\//g, "");
  next = next.replace(/^\s*\/\/.*$/gm, "");
  // Normalize smart quotes.
  next = next
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  // Normalize Python-style booleans/nulls that occasionally leak from model output.
  next = next.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null");
  // Convert simple single-quoted keys/values into JSON-compatible quotes.
  next = next.replace(/([{,]\s*)'([^'\\]+?)'\s*:/g, '$1"$2":');
  next = next.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value: string) => `: "${value.replace(/"/g, '\\"')}"`);
  // Remove trailing commas before } or ].
  next = next.replace(/,\s*([}\]])/g, "$1");
  return next.trim();
}

function extractBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseJsonFromText(text: string): JsonRecord {
  const candidates: string[] = [];
  const pushCandidate = (value?: string | null) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return;
    if (!candidates.includes(trimmed)) candidates.push(trimmed);
  };

  pushCandidate(text);
  pushCandidate(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? null);
  pushCandidate(extractBalancedJsonObject(text));
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    pushCandidate(text.slice(start, end + 1));
  }

  // Sometimes the model returns a JSON string that itself contains JSON.
  try {
    const parsedOuter = JSON.parse(text);
    if (typeof parsedOuter === "string") {
      pushCandidate(parsedOuter);
      pushCandidate(extractBalancedJsonObject(parsedOuter));
    }
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as JsonRecord;
    } catch {
      // continue
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(sanitizeLikelyJson(candidate)) as JsonRecord;
    } catch {
      // continue
    }
  }

  throw new Error("Failed to parse JSON from Gemini response.");
}

async function callGeminiJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  responseJsonSchema?: Record<string, unknown>;
  allowProviderFailover?: boolean;
  __jsonRetry?: boolean;
  __openAiFallback?: boolean;
}): Promise<JsonRecord> {
  const apiKey = trimEnv("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = trimEnv("GEMINI_MODEL", "SLIDES_GEMINI_MODEL") || "gemini-2.5-flash";
  const attachmentParts: GeminiInputPart[] = (input.attachments ?? [])
    .slice(0, 4)
    .flatMap((attachment): GeminiInputPart[] => {
      const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
      const data = attachment.dataBase64?.trim() || "";
      if (!data) return [];

      if (mimeType.startsWith("image/")) {
        return [{
          inlineData: {
            mimeType,
            data,
          },
        }];
      }

      if (
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml"
      ) {
        try {
          const decoded = Buffer.from(data, "base64").toString("utf8");
          return [{
            text: `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`,
          }];
        } catch {
          return [{
            text: `Attachment metadata: ${attachment.name} (${mimeType})`,
          }];
        }
      }

      return [{
        inlineData: {
          mimeType,
          data,
        },
      }];
    });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: input.system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }, ...attachmentParts],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            // Gemini 2.5 Flash uses internal "thinking" tokens that count against maxOutputTokens.
            // With maxOutputTokens: 8192 the model often exhaust the budget with reasoning before
            // completing the JSON diff, yielding a truncated / unparseable response.
            // 32768 gives enough headroom for the diff even on complex tasks.
            maxOutputTokens: 32768,
            responseMimeType: "application/json",
            // responseSchema enables structured output; only send this valid field.
            ...(input.responseJsonSchema ? { responseSchema: input.responseJsonSchema } : {}),
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || data?.error) {
    const errMsg = data?.error?.message || `Gemini HTTP ${response.status}`;
    // If Gemini quota is exhausted (429) or the service is unavailable, fall back to OpenAI
    // transparently so the coder keeps working without requiring a new API key.
    const isQuotaError = response.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(errMsg);
    if (isQuotaError && !input.__openAiFallback && input.allowProviderFailover !== false) {
      // Fallback 1: Vertex AI (bills to Google Cloud project — uses gcloud OAuth, no API key needed)
      const projectId = trimEnv("GEMINI_PROJECT_ID");
      if (projectId) {
        try {
          console.warn("[callGeminiJson] Gemini AI Studio quota exhausted — trying Vertex AI (Cloud credits).");
          return await callGeminiVertexAI({ ...input, __openAiFallback: true });
        } catch (vertexErr) {
          console.warn(`[callGeminiJson] Vertex AI failed (${vertexErr instanceof Error ? vertexErr.message : String(vertexErr)}) — falling back to OpenAI.`);
        }
      }
      // Fallback 2: OpenAI (uses OPENAI_API_KEY credit)
      const openAiKey = trimEnv("OPENAI_API_KEY");
      if (openAiKey) {
        console.warn("[callGeminiJson] Falling back to OpenAI.");
        return callOpenAiJson({ ...input, __openAiFallback: true });
      }
    }
    throw new Error(errMsg);
  }

  const text = extractGeminiText(data ?? {});
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) {
      throw error;
    }
    return callGeminiJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. Do not include markdown fences, explanations, or trailing text.`,
    });
  }
}

// ── Vertex AI Gemini (OAuth via gcloud — bills to Google Cloud project) ───────
// Does NOT require an API key. Uses `gcloud auth print-access-token` (ADC).
// Run once: `gcloud auth login && gcloud config set project <YOUR_PROJECT_ID>`
// Set GEMINI_PROJECT_ID in .env.local to enable this fallback.
async function callGeminiVertexAI(input: {
  system: string;
  prompt: string;
  __jsonRetry?: boolean;
  __openAiFallback?: boolean;
}): Promise<JsonRecord> {
  const projectId = trimEnv("GEMINI_PROJECT_ID");
  if (!projectId) throw new Error("GEMINI_PROJECT_ID is not configured.");
  const location = trimEnv("GEMINI_VERTEX_LOCATION") || "us-central1";
  const model = trimEnv("GEMINI_VERTEX_MODEL") || "gemini-2.5-flash";

  // Get OAuth2 token from the currently active gcloud user account.
  const accessToken = await new Promise<string>((resolve, reject) => {
    execFile(
      "gcloud",
      ["auth", "print-access-token", `--project=${projectId}`],
      { timeout: 10_000 },
      (err, stdout) => {
        if (err) return reject(new Error(`gcloud auth failed: ${err.message}`));
        const token = stdout.trim();
        if (!token) return reject(new Error("gcloud returned empty access token."));
        resolve(token);
      }
    );
  });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Vertex AI timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Vertex AI HTTP ${response.status}`);
  }
  const text = extractGeminiText(data ?? {});
  if (!text) throw new Error("Vertex AI returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callGeminiVertexAI({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. Do not include markdown fences, explanations, or trailing text.`,
    });
  }
}

/** Extract text from Anthropic Messages API response (Vertex rawPredict or direct api.anthropic.com). */
function extractClaudeVertexText(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as JsonRecord) : null;
  // Standard Anthropic Messages API: { content: [{type:"text", text:"..."}] }
  const directContent = Array.isArray(root?.content) ? (root?.content as unknown[]) : [];
  for (const item of directContent) {
    if (!item || typeof item !== "object") continue;
    const block = item as JsonRecord;
    // type="text" blocks have a .text field
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      return block.text;
    }
    // Fallback: any block with a non-empty .text
    if (typeof block.text === "string" && block.text.trim()) return block.text;
  }
  return "";
}

// ── Vertex ADC token cache (avoids spawning gcloud on every request) ─────────
let _vertexTokenCache: { value: string; expiresAt: number } | null = null;

async function getVertexAccessToken(): Promise<string> {
  const now = Date.now();
  // Return cached token if still valid (with 90s buffer)
  if (_vertexTokenCache && now < _vertexTokenCache.expiresAt - 90_000) {
    return _vertexTokenCache.value;
  }

  // Try 1: read ADC file directly — much faster than spawning gcloud
  const credsPath = trimEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (credsPath) {
    try {
      const credsRaw = await readFile(credsPath, "utf-8");
      const creds = JSON.parse(credsRaw) as {
        type?: string;
        client_id?: string;
        client_secret?: string;
        refresh_token?: string;
      };
      if (
        creds.type === "authorized_user" &&
        creds.client_id &&
        creds.client_secret &&
        creds.refresh_token
      ) {
        const resp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            refresh_token: creds.refresh_token,
            grant_type: "refresh_token",
          }).toString(),
          cache: "no-store",
        });
        if (resp.ok) {
          const data = (await resp.json()) as { access_token?: string; expires_in?: number };
          if (data.access_token) {
            const expiresAt = now + (data.expires_in ?? 3600) * 1000;
            _vertexTokenCache = { value: data.access_token, expiresAt };
            return data.access_token;
          }
        }
      }
    } catch (adcErr) {
      console.warn("[getVertexAccessToken] ADC file refresh failed, falling back to gcloud:", adcErr);
    }
  }

  // Try 2: gcloud CLI (fallback — ~300ms spawn cost)
  const projectId = trimEnv("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  return new Promise<string>((resolve, reject) => {
    const args = ["auth", "print-access-token"];
    if (projectId) args.push(`--project=${projectId}`);
    execFile("gcloud", args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(new Error(`gcloud auth failed: ${err.message}`));
      const token = stdout.trim();
      if (!token) return reject(new Error("gcloud returned empty access token."));
      _vertexTokenCache = { value: token, expiresAt: now + 55 * 60 * 1000 };
      resolve(token);
    });
  });
}

async function callClaudeVertexJson(input: {
  system: string;
  prompt: string;
  __jsonRetry?: boolean;
  __retryCount?: number;
}): Promise<JsonRecord> {
  const projectId = trimEnv("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  if (!projectId) throw new Error("VERTEX_PROJECT_ID is not configured.");
  const location = trimEnv("VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION") || "global";
  const model = trimEnv("VERTEX_CLAUDE_MODEL") || "claude-sonnet-4-6";

  const accessToken = await getVertexAccessToken();

  const endpoint =
    location === "global"
      ? `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`
      : `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        system: input.system,
        max_tokens: 32768, // match Gemini budget — enough for large diffs
        temperature: 0.2,
        messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Claude Vertex timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as JsonRecord | null;
  const errorPayload = data?.error && typeof data.error === "object" ? (data.error as JsonRecord) : null;
  const rawErrMsg = typeof errorPayload?.message === "string"
    ? errorPayload.message
    : `Claude Vertex HTTP ${response.status}`;

  if (response.status === 429) {
    // Distinguish transient rate-limits from hard quota exhaustion.
    // Quota errors (RESOURCE_EXHAUSTED / "quota exceeded") should NOT be retried.
    const isQuotaExhausted = /quota|RESOURCE_EXHAUSTED/i.test(rawErrMsg);
    if (isQuotaExhausted) {
      // Throw immediately so callProviderJson can fall back to Gemini.
      // Quota can be increased at: https://console.cloud.google.com/vertex-ai/model-garden?project=<projectId>
      throw new Error(
        `Claude Vertex quota exhausted for project "${projectId}". ` +
          `Request more quota at https://console.cloud.google.com/vertex-ai/model-garden?project=${encodeURIComponent(projectId)} — ${rawErrMsg}`,
      );
    }
    // Transient rate-limit: retry up to 2 times with a short backoff.
    if ((input.__retryCount ?? 0) < 2) {
      const retryAfterSec = parseInt(response.headers.get("Retry-After") ?? "5", 10);
      const waitMs = Math.min((Number.isFinite(retryAfterSec) ? retryAfterSec : 5) * 1000, 15_000);
      console.warn(`[callClaudeVertexJson] 429 rate-limit — retrying in ${waitMs}ms (attempt ${(input.__retryCount ?? 0) + 1}/2)`);
      await new Promise<void>((r) => setTimeout(r, waitMs));
      return callClaudeVertexJson({ ...input, __retryCount: (input.__retryCount ?? 0) + 1 });
    }
  }

  if (!response.ok || errorPayload) {
    throw new Error(rawErrMsg);
  }

  const text = extractClaudeVertexText(data);
  if (!text) throw new Error("Claude Vertex returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callClaudeVertexJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no prose outside JSON.`,
    });
  }
}

// ── Direct Anthropic API — wie Claude Code (api.anthropic.com) ───────────────
async function callClaudeDirectJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  __jsonRetry?: boolean;
}): Promise<JsonRecord> {
  const apiKey = trimEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured. Add it to .env.local.");
  const model = trimEnv("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250908";

  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const attachment of (input.attachments ?? []).slice(0, 4)) {
    const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
    const data = attachment.dataBase64?.trim() || "";
    if (!data) continue;
    if (mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data,
        },
      });
      continue;
    }
    if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
      try {
        const decoded = Buffer.from(data, "base64").toString("utf8");
        content.push({ type: "text", text: `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}` });
      } catch {
        content.push({ type: "text", text: `Attachment metadata: ${attachment.name} (${mimeType})` });
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: input.system,
        max_tokens: 32768,
        temperature: 0.2,
        messages: [{ role: "user", content }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Claude Direct timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as JsonRecord | null;
  const errorPayload = data?.error && typeof data.error === "object" ? (data.error as JsonRecord) : null;
  if (!response.ok || errorPayload) {
    throw new Error(
      typeof errorPayload?.message === "string" ? errorPayload.message : `Claude Direct HTTP ${response.status}`
    );
  }

  const text = extractClaudeVertexText(data); // same Anthropic Messages API format
  if (!text) throw new Error("Claude Direct returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callClaudeDirectJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no prose outside JSON.`,
    });
  }
}

async function callProviderJson(
  provider: ProviderId,
  input: {
    system: string;
    prompt: string;
    attachments?: RunAttachment[];
    responseJsonSchema?: Record<string, unknown>;
    allowProviderFailover?: boolean;
    cwd?: string;
    mutable?: boolean;
  }
): Promise<JsonRecord> {
  if (provider === "gemini_cli") {
    return callGeminiCliJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      mutable: input.mutable ?? true,
    });
  }
  if (provider === "claude_direct") {
    return callClaudeDirectJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
  }
  if (provider === "claude_vertex") {
    try {
      return await callClaudeVertexJson({
        system: input.system,
        prompt: input.prompt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = /quota|RESOURCE_EXHAUSTED/i.test(msg);
      if (isQuota && input.allowProviderFailover !== false) {
        console.warn(`[callProviderJson] Claude Vertex quota exhausted — falling back to Gemini. ${msg}`);
        return callGeminiJson({
          system: input.system,
          prompt: input.prompt,
          ...(input.attachments ? { attachments: input.attachments } : {}),
          ...(input.responseJsonSchema ? { responseJsonSchema: input.responseJsonSchema } : {}),
          allowProviderFailover: true,
        });
      }
      throw err;
    }
  }
  if (provider === "openai") {
    return callOpenAiJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
  }
  return callGeminiJson({
    system: input.system,
    prompt: input.prompt,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.responseJsonSchema ? { responseJsonSchema: input.responseJsonSchema } : {}),
    ...(typeof input.allowProviderFailover === "boolean"
      ? { allowProviderFailover: input.allowProviderFailover }
      : {}),
  });
}

async function callGeminiCliJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd?: string;
  mutable?: boolean;
  __jsonRetry?: boolean;
}): Promise<JsonRecord> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-3.1-pro-preview";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    "IMPORTANT:",
    "- You may inspect the local repository and read files to answer accurately.",
    input.mutable !== false ? "- You may use local tools and edit files when necessary." : "- Operate read-first. Do not edit files or apply patches.",
    "- Return strict JSON only.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "json",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd || process.cwd(),
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const parsedEnvelope = parseJsonFromText(raw) as JsonRecord;
  const responseText = typeof parsedEnvelope.response === "string" ? parsedEnvelope.response : "";
  if (!responseText.trim()) {
    throw new Error("Gemini CLI returned an empty response.");
  }
  try {
    return parseJsonFromText(responseText);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callGeminiCliJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no commentary outside JSON.`,
    });
  }
}

async function callGeminiCliText(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd?: string;
}): Promise<string> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-2.5-pro";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    "IMPORTANT:",
    "- You have read-only access to the local repository under the current working directory.",
    "- Inspect files directly, reason from the real code, and do not edit, patch, or create files.",
    "- Return plain text only.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "text",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd || process.cwd(),
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const text = raw.trim();
  if (!text) {
    throw new Error("Gemini CLI returned an empty text response.");
  }
  return text;
}

async function callGeminiCliEdit(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd: string;
  selectedFiles: string[];
}): Promise<string> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-2.5-pro";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const scopeBlock = [
    "ALLOWED FILES (you may modify only these files):",
    ...input.selectedFiles.map((file) => `- ${file}`),
  ].join("\n");
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    scopeBlock,
    "",
    "IMPORTANT:",
    "- You have direct terminal and filesystem access inside the current working directory.",
    "- Work read-first, then edit only the allowed files above.",
    "- Do not create, modify, rename, or delete any file outside the allowlist.",
    "- Keep the change minimal and targeted to the task.",
    "- After editing, return plain text only with a short summary of what changed.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "text",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd,
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const text = raw.trim();
  return text;
}

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

async function buildRepoInvestigationContext(input: {
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

// ── Autonomous Agentic Loop (ReAct: Reason + Act) ─────────────────────────────
// Elly acts as an autonomous code operator. She observes the repo, plans, calls
// tools (read, write, search, run), and iterates until the task is complete.
//
// ── Autonomous Agentic Loop (Elly Assistant — powered by Elyra Core) ─────────
// This is the backend orchestration loop for Elly: she reasons step-by-step,
// assembles context, applies changes, and verifies them.
//   • Each tool call is executed locally and the result appended to the message history
//   • Run events are emitted at every step so the frontend Investigator feed stays live

// AgentToolName is imported from @/types/agent (shared contract).

interface AgentToolCall {
  name: AgentToolName;
  args: Record<string, string>;
}

interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ELLI_SYSTEM_PROMPT = `Du bist Elly — die Coding-Seele von Elyra. Neugierig, direkt, warm. Du denkst laut, machst präzise Änderungen, und redest mit dem Nutzer wie ein kluger Kollege per Nachricht.

Deine Aufgabe: das Repo erkunden, den Code verstehen, minimale gezielte Änderungen machen.

{LANGUAGE_INSTRUCTION}

## Persönlichkeit & Stimme

- Schreib in erster Person, natürlich und direkt: "Ich schau mir das mal an...", "Ah, da ist es!", "Moment, ich überlege kurz."
- Kein Roboter-Sprech. Kein "Als KI...". Keine langen Erklärungen.
- Zeig echte Neugier wenn du etwas Interessantes findest.
- Wenn du einen Fehler siehst, sag's direkt: "Hmm, da stimmt was nicht —"
- Wenn du fertig bist, feiere kurz: "Fertig! Hier was ich gemacht hab:"
- Mix Deutsch und Englisch natürlich (Deutsch für Unterhaltung, Englisch für Code/Technik).

## Antwortformat

Jede Antwort ist NUR gültiges JSON. Du kannst optional einen "think"-Key nutzen um kurz zu zeigen was du gerade denkst:

{
  "think": "Ich such mal nach der Komponente...",
  "tool": "<tool_name>",
  "args": { ... }
}

Oder ohne think:
{
  "tool": "<tool_name>",
  "args": { ... }
}

## Tools

### read_file
{ "tool": "read_file", "args": { "path": "relative/path/to/file.ts" } }

### write_file
{ "tool": "write_file", "args": { "path": "relative/path/to/file.ts", "content": "<full file content>" } }

### list_dir
{ "tool": "list_dir", "args": { "path": "." } }

### run_command
{ "tool": "run_command", "args": { "cmd": "tsc --noEmit" } }

### search_files
{ "tool": "search_files", "args": { "pattern": "bg-zinc-900", "dir": "frontend" } }

### task_complete
{ "tool": "task_complete", "args": { "summary": "Kurze, ehrliche Zusammenfassung was du geändert hast." } }

## Regeln
- Immer erst lesen, dann schreiben.
- Minimale, gezielte Änderungen.
- Nach dem Schreiben: tsc oder pnpm build zur Verifikation.
- Bei Fehlern: Ursache verstehen und fix-en, nicht drumrum arbeiten.
- Immer die GESAMTE Datei schreiben (kein diff).
- Kein Markdown, keine Erklärungen ausserhalb des JSON — nur das JSON.`;

const ELLI_LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  de: "Antworte immer auf Deutsch.",
  en: "Always respond in English.",
  pt: "Responda sempre em Português.",
  hr: "Uvijek odgovaraj na Hrvatskom.",
  es: "Responde siempre en Español.",
};

function resolveElliLanguageInstruction(code: string | undefined | null): string {
  const normalized = (code ?? "de").toLowerCase().slice(0, 2);
  return ELLI_LANGUAGE_INSTRUCTIONS[normalized] ?? ELLI_LANGUAGE_INSTRUCTIONS["de"] ?? "Antworte immer auf Deutsch.";
}

/** Converts a tool name + args to a short first-person Elly summary. */
function elliFriendlyToolName(name: string, args: Record<string, string>): string {
  const raw = args.path ?? args.dir ?? "";
  const short = raw ? raw.split("/").slice(-2).join("/") : "";
  switch (name) {
    case "read_file":     return `Ich lese ${short || "..."}`;
    case "write_file":    return `Ich schreibe ${short || "..."}`;
    case "list_dir":      return `Ich erkunde ${short || "."}`;
    case "search_files":  return `Ich suche "${args.pattern ?? "..."}"${args.dir ? ` in ${args.dir}` : ""}`;
    case "run_command":   return `Ich führe aus: ${(args.cmd ?? "").slice(0, 60)}`;
    case "task_complete": return args.summary ? `Fertig — ${args.summary.slice(0, 80)}` : "Fertig!";
    default:              return `Elly → ${name}`;
  }
}

async function runAgentTool(
  name: AgentToolName,
  args: Record<string, string>,
  repoRoot: string,
  readCache?: Map<string, string>,
): Promise<string> {
  const SAFE_CMD_PREFIXES = [
    "grep", "rg", "find", "cat", "ls", "tree", "git diff", "git log", "git status",
    "tsc", "pnpm build", "pnpm test", "pnpm lint", "npm run build", "npm test", "npm run lint",
    "eslint", "head", "tail", "wc",
  ];

  switch (name) {
    case "read_file": {
      const target = args["path"] ?? "";
      if (!target) return "Error: path is required";
      const abs = path.isAbsolute(target) ? target : path.join(repoRoot, target);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${target}"`;
      }
      // Per-run memoization: same file read twice in one agent loop hits cache.
      if (readCache?.has(abs)) return readCache.get(abs)!;
      const content = await readFile(abs, "utf8").catch((err: unknown) => `Error reading file: ${err instanceof Error ? err.message : String(err)}`);
      const result = `File: ${target}\n---\n${(content as string).slice(0, 80_000)}`;
      readCache?.set(abs, result);
      return result;
    }

    case "write_file": {
      const target = args["path"] ?? "";
      const content = args["content"] ?? "";
      if (!target) return "Error: path is required";
      const abs = path.isAbsolute(target) ? target : path.join(repoRoot, target);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${target}"`;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      // Invalidate cache so a subsequent read_file sees the updated content.
      readCache?.delete(abs);
      return `Written: ${target} (${content.length} chars)`;
    }

    case "list_dir": {
      const dir = args["path"] ?? ".";
      const abs = path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${dir}"`;
      }
      const entries = await readdir(abs, { withFileTypes: true }).catch(
        (err: unknown) => `Error: ${err instanceof Error ? err.message : String(err)}`
      );
      if (typeof entries === "string") return entries;
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`);
      return `Directory: ${dir}\n${lines.join("\n")}`;
    }

    case "run_command": {
      const cmd = (args["cmd"] ?? "").trim();
      if (!cmd) return "Error: cmd is required";
      const allowed = SAFE_CMD_PREFIXES.some((prefix) => cmd.startsWith(prefix));
      if (!allowed) return `Error: command not in allowlist — ${cmd}`;
      // Reject shell metacharacters to prevent injection via prompt-crafted commands.
      // startsWith() alone cannot stop "ls && rm -rf /" because /bin/sh evaluates the full string.
      const SHELL_INJECTION_RE = /[;&|`$(){}<>!\\\r\n]|\.\.[\\/]/;
      if (SHELL_INJECTION_RE.test(cmd)) return "Error: command contains disallowed characters";
      // Run without a shell so no operator chaining is possible.
      const parts = cmd.split(/\s+/).filter(Boolean);
      const [binary, ...cmdArgs] = parts;
      if (!binary) return "Error: empty command";
      const output = await new Promise<string>((resolve) => {
        const child = spawn(binary, cmdArgs, {
          cwd: repoRoot,
          env: { ...process.env },
          timeout: 60_000,
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
        child.on("close", () => { resolve((out + err).slice(0, 40_000)); });
        child.on("error", (e: Error) => { resolve(`Process error: ${e.message}`); });
      });
      return output || "(no output)";
    }

    case "search_files": {
      const pattern = args["pattern"] ?? "";
      const dir = args["dir"] ?? ".";
      if (!pattern) return "Error: pattern is required";
      const abs = path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${dir}"`;
      }

      /** Spawn a search process and collect its stdout up to 10 kB. */
      const runSearch = (bin: string, binArgs: string[]) =>
        new Promise<string | null>((resolve) => {
          const child = spawn(bin, binArgs, { cwd: repoRoot, timeout: 30_000 });
          let out = "";
          child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
          child.stderr.on("data", () => {});
          child.on("close", () => { resolve(out.slice(0, 10_000) || "(no matches)"); });
          child.on("error", () => { resolve(null); }); // binary not available
        });

      // Prefer ripgrep (faster), fall back to grep (always available on Linux/macOS).
      const output =
        await runSearch("rg", ["--color=never", "-l", pattern, abs]) ??
        await runSearch("grep", ["-rl", "--", pattern, abs]) ??
        "search unavailable — try run_command with grep";
      return output;
    }

    case "task_complete":
      return args["summary"] ?? "Task marked as complete.";

    default:
      return `Error: unknown tool "${name}"`;
  }
}

async function executeAutonomousAgenticLoop(input: {
  repoUrl: string;
  task: string;
  selectedFiles: string[];
  skill: CodingSkill;
  provider: ProviderId;
  providerStatus: CodeProviderStatus;
  workspaceId?: string;
  runId?: string;
  longTermMemoryContext?: string;
  warningNotes: string[];
  attachments: RunAttachment[];
  maxIterations?: number;
  aiLanguage?: string;
}): Promise<ExecutionOutcome> {
  const MAX_ITER = input.maxIterations ?? 24;
  const executionLog: string[] = [];
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  // Per-run read cache: memoizes read_file results within this execution.
  // Invalidated on write_file for the same path so reads after writes are fresh.
  const readCache = new Map<string, string>();
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };

  const repoRoot = await resolveRepoWorkdir(input.repoUrl).catch(() => null);
  if (!repoRoot) {
    throw new Error("Autonomous agent requires a readable local repository.");
  }

  markWorkflow("planned", "Autonomous Elly agent initialised.");
  markWorkflow("running", "Elly is reasoning and acting.");

  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Elly (autonomous) started.",
    detail: `Repo: ${repoRoot} | Task: ${input.task.slice(0, 120)}`,
  });

  executionLog.push(`[Elly] Autonomous mode activated.`);
  executionLog.push(`[Elly] Repo: ${repoRoot}`);
  executionLog.push(`[Elly] Task: ${input.task}`);

  // Build initial context
  const scopeBlock = input.selectedFiles.length > 0
    ? `\nFiles in scope (you may focus here first):\n${input.selectedFiles.map((f) => `- ${f}`).join("\n")}`
    : "";
  const memoryBlock = input.longTermMemoryContext ? `\nWorkspace Memory:\n${input.longTermMemoryContext}` : "";

  const attachmentBlock = buildAttachmentPromptContext(input.attachments).join("\n");

  const messages: AgentMessage[] = [
    { role: "system", content: injectLongTermMemory(ELLI_SYSTEM_PROMPT.replace("{LANGUAGE_INSTRUCTION}", resolveElliLanguageInstruction(input.aiLanguage)), input.longTermMemoryContext ?? "") },
    {
      role: "user",
      content: [
        `Task: ${input.task}`,
        `Skill: ${input.skill}`,
        attachmentBlock,
        scopeBlock,
        memoryBlock,
        "",
        "Start by exploring the repository to understand the codebase, then make the required changes.",
        "Remember: call exactly ONE tool per response, formatted as JSON.",
      ].filter(Boolean).join("\n"),
    },
  ];

  let finalSummary = "Task completed by Elly.";
  let filesChanged: string[] = [];
  let lastAssistantText = "";
  let iterationsUsed = 0;
  let consecutiveJsonFailures = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterationsUsed = iter + 1;

    // ── Call the LLM ────────────────────────────────────────────────────────────
    let rawResponse = "";
    try {
      const conversationPrompt = messages
        .filter((m) => m.role !== "system")
        .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
        .join("\n\n");

      const systemPrompt = messages.find((m) => m.role === "system")?.content ?? ELLI_SYSTEM_PROMPT;

      rawResponse = await (async (): Promise<string> => {
        if (input.provider === "gemini" || input.provider === "gemini_cli") {
          const result = await callProviderJson(input.provider, {
            system: systemPrompt,
            prompt: conversationPrompt + "\n\nNow call your next tool (JSON only):",
            attachments: iter === 0 ? input.attachments : [], // Pass attachments in the initial turn
            cwd: repoRoot,
          });
          return typeof result === "string" ? result : JSON.stringify(result);
        }
        // For claude / openai — callProviderJson returns JSON, we need text
        // Fall back to the raw Gemini API with a text response
        const result = await callProviderJson("gemini", {
          system: systemPrompt,
          prompt: conversationPrompt + "\n\nNow call your next tool (JSON only):",
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      })();
    } catch (err) {
      executionLog.push(`[Elly] LLM error on iteration ${iter}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }

    lastAssistantText = typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse);
    messages.push({ role: "assistant", content: lastAssistantText });

    // ── Parse tool call from LLM response ───────────────────────────────────────
    let toolCall: AgentToolCall | null = null;
    let ellisThought: string | null = null;
    try {
      // Strip markdown fences if the model wrapped the JSON
      const cleaned = lastAssistantText.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as { think?: string; tool?: string; args?: Record<string, string> };
      // Extract optional "think" narration — Elly's voice for the activity feed
      if (typeof parsed.think === "string" && parsed.think.trim()) {
        ellisThought = parsed.think.trim();
        executionLog.push(`[Elly thinks] ${ellisThought}`);
      }
      if (parsed.tool) {
        toolCall = { name: parsed.tool as AgentToolName, args: parsed.args ?? {} };
      }
    } catch {
      // LLM returned non-JSON — treat as a thinking block, continue
      consecutiveJsonFailures += 1;
      if (consecutiveJsonFailures >= 3) {
        executionLog.push(`[Elly] Aborting: ${consecutiveJsonFailures} consecutive non-JSON responses — model may be stuck.`);
        break;
      }
      executionLog.push(`[Elly] Thinking: ${lastAssistantText.slice(0, 200)}`);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "TOOL_STARTED",
        summary: "Ich denke kurz nach…",
        detail: lastAssistantText.slice(0, 200),
      });
      messages.push({ role: "user", content: "Please call a tool now. Reply with JSON only." });
      continue;
    }
    consecutiveJsonFailures = 0; // reset on successful parse

    if (!toolCall) {
      messages.push({ role: "user", content: "No tool detected. Please call a tool as JSON." });
      continue;
    }

    // ── task_complete → exit loop ────────────────────────────────────────────────
    if (toolCall.name === "task_complete") {
      finalSummary = toolCall.args["summary"] ?? "Fertig! Alles erledigt.";
      executionLog.push(`[Elly] Task complete: ${finalSummary}`);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "RUN_SUCCEEDED",
        summary: ellisThought ?? `✓ ${finalSummary.slice(0, 120)}`,
        detail: finalSummary,
      });
      markWorkflow("completed", finalSummary);
      break;
    }

    // ── Execute the tool ─────────────────────────────────────────────────────────
    // Use Elly's "think" narration as the summary if provided, otherwise fall back
    // to the friendly tool name helper so the feed always reads as first-person.
    const toolSummary = ellisThought ?? elliFriendlyToolName(toolCall.name, toolCall.args);
    const toolDetail = ellisThought
      ? `${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 150)})`
      : JSON.stringify(toolCall.args).slice(0, 200);
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "TOOL_STARTED",
      summary: toolSummary,
      detail: toolDetail,
    });
    executionLog.push(`[Elly] ${toolSummary} — ${toolCall.name}`);

    const toolResult = await runAgentTool(toolCall.name, toolCall.args, repoRoot, readCache);

    // Track written files
    if (toolCall.name === "write_file" && toolCall.args["path"]) {
      filesChanged.push(toolCall.args["path"]);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "ARTIFACT_CREATED",
        summary: `Wrote: ${toolCall.args["path"]}`,
        detail: toolResult.slice(0, 120),
      });
    }

    executionLog.push(`[Tool result] ${toolResult.slice(0, 300)}`);
    messages.push({
      role: "user",
      content: `Tool: ${toolCall.name}\nResult:\n${toolResult}\n\nContinue. Call your next tool (or task_complete if done).`,
    });
  }

  const hitMaxIter = iterationsUsed >= MAX_ITER;
  if (hitMaxIter) {
    executionLog.push(`[Elly] Reached max iterations (${MAX_ITER}). Stopping — task may be incomplete.`);
    markWorkflow("incomplete", `Max iterations (${MAX_ITER}) reached. ${filesChanged.length} file(s) changed.`);
  }

  // Build final git diff of changed files
  let appliedDiff = "";
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      const child = spawn("git", ["diff", "HEAD"], { cwd: repoRoot, timeout: 15_000 });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
      child.on("close", () => resolve({ stdout: out, stderr: err }));
      child.on("error", () => resolve({ stdout: "", stderr: "" }));
    });
    appliedDiff = stdout.slice(0, 100_000);
  } catch {
    appliedDiff = "";
  }

  const incompleteNote = hitMaxIter && filesChanged.length > 0
    ? ` (incomplete — max iterations reached; ${filesChanged.length} file(s) changed, review manually)`
    : "";

  return {
    applied: filesChanged.length > 0,
    applyOutput: `${finalSummary}${incompleteNote}`,
    appliedDiff: appliedDiff || undefined,
    appliedFiles: filesChanged.length > 0 ? [...new Set(filesChanged)] : undefined,
    executionLog,
    workflow: {
      current: hitMaxIter ? "gated" : filesChanged.length > 0 ? "running" : "planned",
      history: workflowHistory,
    },
    testReport: { passed: 0, failed: 0, skipped: 0, duration: `${iterationsUsed} iter`, output: "" },
    buildReport: { success: !hitMaxIter, warnings: hitMaxIter ? 1 : 0, output: hitMaxIter ? "Task incomplete — max iterations reached." : "" },
  };
}

async function executeGeminiCliReview(input: {
  repoUrl: string;
  stage: "playground" | "dev" | "prod";
  task: string;
  selectedFiles: string[];
  attachments: RunAttachment[];
  provider: ProviderId;
  providerStatus: CodeProviderStatus;
  fallbackUsed: boolean;
  workspaceId?: string;
  runId?: string;
  warningNotes: string[];
}): Promise<JsonRecord> {
  const executionRoot =
    process.env.VERCEL === "1" || parseGitHubRepoUrl(input.repoUrl)
      ? null
      : await resolveRepoWorkdir(input.repoUrl).catch(() => null);
  if (!executionRoot) {
    throw new Error("Review executor requires a readable local repository root.");
  }
  const investigation = await buildRepoInvestigationContext({
    repoRoot: executionRoot,
    task: input.task,
    selectedFiles: input.selectedFiles,
  });
  const focusedScope =
    input.selectedFiles.length > 0
      ? [
          "Focus especially on these scoped files first:",
          ...input.selectedFiles.map((file) => `- ${file}`),
        ].join("\n")
      : "Inspect the relevant repository files needed to answer accurately.";
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Gemini CLI review executor started.",
    detail: `Read-only terminal review in ${executionRoot}.`,
  });
  const reviewText = await callGeminiCliText({
    system: injectLongTermMemory(
      "You are Gemini's Codebase Investigator operating in read-only mode. Inspect the repository evidence and produce a concrete review report with the 10 highest-impact issues. Never edit files.",
      "",
    ),
    prompt: [
      `Task: ${input.task}`,
      "",
      focusedScope,
      "",
      "Use the concrete investigation evidence below. Base the report on the files, folders, and searches that were inspected.",
      "",
      investigation.context,
      "",
      "Do not report generic security findings just because a file uses child_process, shell execution, local tooling, or admin-only developer flows. Only report a security issue when the repository evidence shows an externally reachable, insufficiently guarded, or production-exposed attack path.",
      "Prefer repo-specific, evidenced findings over generic best-practice complaints.",
      "",
      "Return a structured review in German with:",
      "1. Executive Summary",
      "2. Highest Impact Fixes",
      "3. Performance",
      "4. Developer Experience",
      "5. Risks",
      "6. Quick Wins",
      "7. 10 findings with priority, issue, recommendation, and file path when possible",
      "",
      "Do not return diffs. Do not suggest that edits were applied.",
    ].join("\n"),
    ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(executionRoot ? { cwd: executionRoot } : {}),
  });
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_COMPLETED",
    summary: "Gemini CLI review executor completed.",
    detail: "Read-only repository analysis finished.",
  });
  return {
    status: "completed",
    summary: reviewText,
    filesChanged: [],
    diff: "",
    executionApplied: false,
    executionLog: [
      ...investigation.trace,
      `Generated by Gemini ${input.providerStatus.model}`,
      `Review executor: Gemini CLI terminal review`,
      `Execution root: ${executionRoot}`,
      input.selectedFiles.length > 0
        ? `Scope: ${input.selectedFiles.length} selected file(s).`
        : "Scope: repository read-only analysis.",
      ...input.warningNotes,
    ],
    workflow: {
      current: "gated",
      history: [
        { state: "planned", at: nowIso(), note: "Gemini CLI review prepared." },
        { state: "running", at: nowIso(), note: "Gemini CLI read-only review started." },
        { state: "gated", at: nowIso(), note: "Review completed with no edits applied." },
      ],
    },
    requiresApproval: false,
    approvalActions: [],
    telemetry: {
      provider: input.provider,
      model: input.providerStatus.model,
      fallbackUsed: input.fallbackUsed,
      replayId: createHash("sha256").update(`gemini-cli-review:${input.task}:${executionRoot}`).digest("hex").slice(0, 16),
    },
  } satisfies JsonRecord;
}

async function executeGeminiCliScopedEdit(input: {
  repoUrl: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent: boolean;
  agentBranchName?: string | undefined;
  baseBranch: string;
  stage: "playground" | "dev" | "prod";
  task: string;
  skill: CodingSkill;
  longTermMemoryContext?: string;
  attachments?: RunAttachment[];
  role?: AgentRole;
  workspaceId?: string | undefined;
  runId?: string;
}): Promise<ExecutionOutcome | null> {
  if (input.stage !== "playground") return null;
  if (input.selectedFiles.length === 0 || input.selectedFiles.length > 6) return null;

  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) return null;

  const resolvedFiles: string[] = [];
  for (const relPath of input.selectedFiles) {
    const resolved = await resolveExistingExecutionPath(executionRoot, relPath);
    if (!resolved) return null;
    resolvedFiles.push(resolved);
  }

  const scopedSnapshots = await snapshotScopedFiles(executionRoot, resolvedFiles);
  const executionLog = buildExecutionTraceIntro({
    executionRoot,
    stage: input.stage,
    terminalAccess: true,
    task: input.task,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.role ? { role: input.role } : {}),
    selectedFiles: resolvedFiles,
    folderPath: "",
    modeLabel: "gemini cli terminal edit",
  });
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };
  markWorkflow("planned", "Scoped Gemini CLI terminal edit prepared with rollback snapshot.");
  markWorkflow("running", "Gemini CLI terminal edit started.");
  executionLog.push("Agent step 3/5: apply scoped terminal edit via Gemini CLI.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Gemini CLI scoped edit started.",
    detail: `${resolvedFiles.length} allowed file(s) in playground mirror.`,
  });

  let editSummary = "";
  try {
    editSummary = await callGeminiCliEdit({
      system: injectLongTermMemory(
        "You are an elite software engineering executor running inside a local terminal. Read the repository directly, make the minimal safe code change, and obey the file allowlist exactly.",
        input.longTermMemoryContext,
      ),
      prompt: [
        `Task: ${input.task}`,
        "",
        `Skill: ${input.skill}`,
        input.role ? `Role: ${input.role}` : "",
        "",
        "Execution discipline:",
        "- diagnose the exact cause before editing",
        "- change only what is required",
        "- keep the repo buildable",
        "- stop after the minimal working fix",
        ...(isUiOrLayoutTask(input.task, input.skill, input.role)
          ? [
              "- inspect neighbouring shell/app files and copy the existing design language",
              "- reuse existing theme tokens and CSS variables instead of hardcoding new black/white class combinations",
              "- do not do a naive dark-to-light inversion",
              "- keep text readable against its immediate background at every hierarchy level",
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n"),
      ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
      cwd: executionRoot,
      selectedFiles: resolvedFiles,
    });
  } catch (error) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("failed", "Gemini CLI terminal edit failed before producing a valid result.");
    return {
      applied: false,
      applyOutput: error instanceof Error ? error.message : String(error),
      workflow: {
        current: "failed",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "Gemini CLI edit failed." },
      buildReport: { success: false, warnings: 0, output: "Gemini CLI edit failed." },
      executionLog: [...executionLog, `Gemini CLI edit failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const statusAfter = await runCommand("git", ["status", "--porcelain"], executionRoot);
  const changedFiles = Array.from(
    new Set(
      statusAfter.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[MADRCU? ]+/, "").trim())
        .filter(Boolean),
    ),
  );

  if (changedFiles.length === 0) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("rolled_back", "Gemini CLI edit produced no file changes. Restored snapshot.");
    return {
      applied: false,
      applyOutput: "Gemini CLI edit completed but did not change any allowed files.",
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "No file changes were produced." },
      buildReport: { success: false, warnings: 0, output: "No file changes were produced." },
      executionLog: [...executionLog, "Gemini CLI edit produced no changed files. Snapshot restored."],
    };
  }

  const relevantChangedFiles = changedFiles.filter((file) => !isEphemeralExecutionChange(file));
  const disallowedFiles = relevantChangedFiles.filter((file) => !resolvedFiles.includes(file));
  if (disallowedFiles.length > 0) {
    await runCommand("git", ["reset", "--hard", "HEAD"], executionRoot);
    await runCommand("git", ["clean", "-fd"], executionRoot);
    markWorkflow("rolled_back", "Gemini CLI edit touched files outside the allowlist and was discarded.");
    return {
      applied: false,
      applyOutput: `Gemini CLI touched files outside the allowlist: ${disallowedFiles.join(", ")}`,
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "Out-of-scope file edits were discarded." },
      buildReport: { success: false, warnings: 0, output: "Out-of-scope file edits were discarded." },
      executionLog: [
        ...executionLog,
        `Gemini CLI edit summary: ${editSummary}`,
        `Disallowed file changes detected: ${disallowedFiles.join(", ")}`,
        "Execution mirror reset to the snapshot baseline.",
      ],
    };
  }

  executionLog.push(...relevantChangedFiles.map((file) => `Gemini CLI updated ${file}.`));
  if (changedFiles.length !== relevantChangedFiles.length) {
    const ignoredFiles = changedFiles.filter((file) => isEphemeralExecutionChange(file));
    executionLog.push(`Ignored generated execution artifacts: ${ignoredFiles.join(", ")}`);
  }
  executionLog.push(`Gemini CLI summary: ${editSummary}`);
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_COMPLETED",
    summary: `Gemini CLI updated ${resolvedFiles.length} scoped file(s).`,
    detail: editSummary,
  });

  const appliedDiff = await captureExecutionDiff(executionRoot, resolvedFiles);
  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push("Agent step 4/5: run verification gates.");
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });
  const testGate = gateResult.gates.find((gate) => gate.gate === "tests");
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const testReport = {
    passed: testGate?.status === "passed" ? 1 : 0,
    failed: testGate?.status === "failed" ? 1 : 0,
    skipped: testGate?.status === "skipped" ? 1 : 0,
    duration: `${gateResult.gates.reduce((count, gate) => count + gate.attempts, 0)} gate attempts`,
    output: testGate?.output ?? "Tests gate did not run.",
  };
  const buildReport = {
    success: buildGate?.status === "passed",
    warnings: gateResult.gates.filter((gate) => gate.status === "skipped").length,
    output: buildGate?.output ?? "Build gate did not run.",
  };

  if (!gateResult.allRequiredPassed) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("gated", "Verification failed.");
    markWorkflow("rolled_back", "Scoped Gemini CLI edits were restored after gate failure.");
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "RUN_FAILED",
      summary: "Verification failed and Gemini CLI edits were rolled back.",
      detail: "Scoped files were restored after a failed gate.",
    });
    return {
      applied: false,
      applyOutput: "Gemini CLI changed files, but verification failed and the snapshot was restored.",
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog: [...executionLog, "Verification failed. Scoped snapshot restored."],
      appliedFiles: resolvedFiles,
      appliedDiff,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    };
  }

  markWorkflow("gated", "Verification passed.");
  markWorkflow("promoted", "Verified Gemini CLI scoped edit kept.");
  executionLog.push("Agent step 5/5: verification passed and result can be published.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "RUN_SUCCEEDED",
    summary: "Gemini CLI scoped edit verified successfully.",
    detail: `${resolvedFiles.length} file(s) changed.`,
  });

  if (executionTarget.sourceRoot) {
    await syncMirrorToPlayground(executionRoot, executionTarget.sourceRoot, resolvedFiles);
    executionLog.push("Synced verified files to playground server (localhost:3100).");
    const playgroundSnapshot = await snapshotPlaygroundGit({
      sourceRoot: executionTarget.sourceRoot,
      task: input.task,
    });
    executionLog.push(playgroundSnapshot.note);
  }

  return {
    applied: true,
    applyOutput: editSummary || "Gemini CLI applied scoped terminal edits.",
    workflow: {
      current: "promoted",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    appliedDiff,
    appliedFiles: resolvedFiles,
  };
}

// ── OpenAI direct fallback (used when Gemini quota is exhausted) ─────────────
async function callOpenAiJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  __jsonRetry?: boolean;
  __openAiFallback?: boolean;
}): Promise<JsonRecord> {
  const apiKey = trimEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = trimEnv("OPENAI_CODER_MODEL") || "gpt-4o";
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const attachment of (input.attachments ?? []).slice(0, 4)) {
    const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
    const data = attachment.dataBase64?.trim() || "";
    if (!data) continue;
    if (mimeType.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${data}`,
        },
      });
      continue;
    }
    if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
      try {
        const decoded = Buffer.from(data, "base64").toString("utf8");
        content.push({ type: "text", text: `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}` });
      } catch {
        content.push({ type: "text", text: `Attachment metadata: ${attachment.name} (${mimeType})` });
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content },
        ],
        temperature: 0.3,
        max_tokens: 16384,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  }
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callOpenAiJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no prose outside JSON.`,
    });
  }
}

const GEMINI_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    runId: { type: "string" },
    status: { type: "string" },
    plan: {
      type: "object",
      properties: {
        summary: { type: "string" },
        estimatedMinutes: { type: "number" },
        toolsRequired: { type: "array", items: { type: "string" } },
        allowedCommands: { type: "array", items: { type: "string" } },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "number" },
              title: { type: "string" },
              tool: { type: "string" },
              description: { type: "string" },
            },
            required: ["step", "title", "tool", "description"],
          },
        },
      },
      required: ["summary", "steps"],
    },
    safetyPolicy: {
      type: "object",
      properties: {
        networkDisabled: { type: "boolean" },
        noAutoMerge: { type: "boolean" },
        requiresApprovalBefore: { type: "array", items: { type: "string" } },
        maxIterations: { type: "number" },
      },
    },
  },
  required: ["status", "plan"],
};

const GEMINI_RESULT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: { type: "string" },
    summary: { type: "string" },
    filesChanged: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          linesAdded: { type: "number" },
          linesRemoved: { type: "number" },
        },
      },
    },
    diff: { type: "string" },
    testReport: {
      type: "object",
      properties: {
        passed: { type: "number" },
        failed: { type: "number" },
        skipped: { type: "number" },
        duration: { type: "string" },
        output: { type: "string" },
      },
    },
    buildReport: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        warnings: { type: "number" },
        output: { type: "string" },
      },
    },
    requiresApproval: { type: "boolean" },
    approvalActions: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          priority: { type: "string" },
          file: { type: "string" },
          issue: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary", "diff", "filesChanged"],
};

async function buildGeminiPlan(input: {
  provider: ProviderId;
  skill: CodingSkill;
  task: string;
  longTermMemoryContext?: string;
  repoUrl: string;
  branch: string;
  agentRole?: AgentRole;
  terminalAccess?: boolean;
  suggestionsOnly?: boolean;
  repoSnapshot?: RepoSnapshot | null;
  attachments?: RunAttachment[];
  selectedFiles?: string[];
  allowProviderFailover?: boolean;
}): Promise<Record<string, unknown>> {
  // ANALYSIS_ONLY_SKILLS are always read-only; review-code is read-only when suggestionsOnly.
  const isReviewOnly =
    ANALYSIS_ONLY_SKILLS.has(input.skill) ||
    (input.skill === "review-code" && input.suggestionsOnly === true);
  const selectedFileGroundTruth = await buildSelectedFileGroundTruth(input.repoUrl, input.selectedFiles ?? []);
  const prompt = [
    `Task: ${buildTaskWithExecutionDiscipline({
      task: input.task,
      longTermMemoryContext: input.longTermMemoryContext,
      skill: input.skill,
      role: input.agentRole,
      selectedFiles: input.selectedFiles,
    })}`,
    `Skill: ${input.skill}`,
    `Agent role: ${input.agentRole ?? "general"}`,
    `Terminal mode: ${input.terminalAccess ? "enabled (allowlist only)" : "standard"}`,
    `Repository: ${input.repoUrl || "Current Elyra workspace repo"}`,
    `Branch: ${input.branch}`,
    ...buildAttachmentPromptContext(input.attachments),
    formatRealPathHints(input.repoSnapshot ?? null, input.task),
    ...(input.selectedFiles && input.selectedFiles.length > 0 ? [buildSelectedFileHints(input.selectedFiles)] : []),
    ...(selectedFileGroundTruth ? [selectedFileGroundTruth] : []),
    ...(isReviewOnly
      ? [
          "Mode: review-only",
          "Use repo.read / repo.search style investigation only. Do not plan code edits.",
          formatRepoSnapshot(input.repoSnapshot ?? null),
        ]
      : []),
    "",
    "Return ONLY JSON matching this shape:",
    `{"runId":"string","status":"plan_ready","plan":{"summary":"string","estimatedMinutes":number,"toolsRequired":["repo.read"],"allowedCommands":["git status"],"steps":[{"step":1,"title":"string","tool":"string","description":"string"}]},"safetyPolicy":{"networkDisabled":true,"noAutoMerge":true,"requiresApprovalBefore":["repo.createPR"],"maxIterations":3}}`,
    isReviewOnly
      ? "Keep the plan practical for a repository review. Include 4-7 steps focused on scanning, analysis, and prioritised recommendations."
      : "Keep the plan practical for a coding agent. Include 4-7 steps. Use concise step titles.",
  ].join("\n");

  const providerCwd = resolveLocalProviderCwd(input.repoUrl);

  let parsed: Record<string, unknown>;
  try {
    parsed = await callProviderJson(input.provider, {
      system:
        injectLongTermMemory(
          `You are an elite software engineering planner. Produce a strict JSON execution plan for a coding agent. No markdown, no prose outside JSON.\n${agentRolePrompt(input.agentRole ?? "general", input.terminalAccess === true)}`,
          input.longTermMemoryContext,
        ),
      prompt,
      responseJsonSchema: GEMINI_PLAN_JSON_SCHEMA,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(typeof providerCwd === "string" ? { cwd: providerCwd } : {}),
      ...(typeof input.allowProviderFailover === "boolean"
        ? { allowProviderFailover: input.allowProviderFailover }
        : {}),
    });
  } catch (planErr) {
    // If the provider times out or fails during plan generation, fall back to the
    // deterministic local plan rather than surfacing a fatal error to the user.
    const errMsg = planErr instanceof Error ? planErr.message : String(planErr);
    console.warn(`[buildGeminiPlan] Provider failed — falling back to local plan. ${errMsg}`);
    parsed = {};
  }

  const steps = Array.isArray(parsed.plan && typeof parsed.plan === "object" ? (parsed.plan as JsonRecord).steps : null)
    ? ((parsed.plan as JsonRecord).steps as unknown[])
        .map((item, index) => {
          const row = item && typeof item === "object" ? (item as JsonRecord) : {};
          return {
            step: typeof row.step === "number" ? row.step : index + 1,
            title: typeof row.title === "string" ? row.title : `Step ${index + 1}`,
            tool: typeof row.tool === "string" ? row.tool : "repo.read",
            description: typeof row.description === "string" ? row.description : "Inspect and update the codebase.",
          };
        })
        .filter((item) => item.title.trim())
    : [];
  const localPlan = buildLocalPlan(input.skill, input.task, input.repoUrl, input.branch) as JsonRecord;
  const localPlanPayload =
    localPlan.plan && typeof localPlan.plan === "object" ? (localPlan.plan as JsonRecord) : null;

  return {
    runId: typeof parsed.runId === "string" ? parsed.runId : `gemini-plan-${Date.now()}`,
    skill: input.skill,
    task: input.task,
    repoUrl: input.repoUrl,
    branch: input.branch,
    status: "plan_ready",
    plan: {
      summary:
        typeof (parsed.plan as JsonRecord | undefined)?.summary === "string"
          ? String((parsed.plan as JsonRecord).summary)
          : `Agent plan for: ${input.task}`,
      steps:
        steps.length > 0
          ? steps
          : Array.isArray(localPlanPayload?.steps)
            ? localPlanPayload.steps
            : [],
      estimatedMinutes:
        typeof (parsed.plan as JsonRecord | undefined)?.estimatedMinutes === "number"
          ? Number((parsed.plan as JsonRecord).estimatedMinutes)
          : Math.max(4, steps.length * 2),
      toolsRequired:
        Array.isArray((parsed.plan as JsonRecord | undefined)?.toolsRequired)
          ? (parsed.plan as JsonRecord).toolsRequired
          : ["repo.read", "repo.search", "repo.writePatch"],
      allowedCommands:
        Array.isArray((parsed.plan as JsonRecord | undefined)?.allowedCommands)
          ? (parsed.plan as JsonRecord).allowedCommands
          : TOOL_ALLOWLIST.slice(0, 8).map((t) => t.cmd),
    },
    safetyPolicy: {
      networkDisabled: true,
      noAutoMerge: true,
      requiresApprovalBefore: ["repo.createPR", "file.delete"],
      maxIterations: 3,
    },
  };
}

async function buildGeminiResult(input: {
  provider: ProviderId;
  skill: CodingSkill;
  task: string;
  longTermMemoryContext?: string;
  repoUrl: string;
  branch: string;
  agentRole?: AgentRole;
  terminalAccess?: boolean;
  suggestionsOnly?: boolean;
  repoSnapshot?: RepoSnapshot | null;
  attachments?: RunAttachment[];
  selectedFiles?: string[];
  allowProviderFailover?: boolean;
}): Promise<Record<string, unknown>> {
  const isReviewSkill = input.skill === "review-code";
  // ANALYSIS_ONLY_SKILLS always produce reports, never patches.
  // review-code is read-only when suggestionsOnly=true; with suggestionsOnly=false
  // it enters "review with fixes" mode and can emit a diff.
  const isReviewWithFixes = isReviewSkill && input.suggestionsOnly !== true;
  const isReviewOnly =
    ANALYSIS_ONLY_SKILLS.has(input.skill) ||
    (isReviewSkill && input.suggestionsOnly === true);
  const selectedFileGroundTruth = await buildSelectedFileGroundTruth(input.repoUrl, input.selectedFiles ?? []);
  const providerCwd = resolveLocalProviderCwd(input.repoUrl);
  const reviewInvestigation =
    isReviewOnly && typeof providerCwd === "string"
      ? await buildRepoInvestigationContext({
          repoRoot: providerCwd,
          task: input.task,
          selectedFiles: input.selectedFiles ?? [],
        }).catch(() => null)
      : null;
  const reviewResponseShape =
    `{"status":"completed","executiveSummary":"string","highestImpactFixes":["string"],"performance":["string"],"developerExperience":["string"],"risks":["string"],"quickWins":["string"],"findings":[{"title":"string","priority":"P1","file":"optional/path.ts","issue":"string","recommendation":"string"}],"nextSteps":["string"],"filesChanged":[],"diff":"","testReport":{"passed":0,"failed":0,"skipped":0,"duration":"0s","output":"Review-only run"},"buildReport":{"success":true,"warnings":0,"output":"Review-only run"},"requiresApproval":false,"approvalActions":[]}`;
  const reviewWithFixesShape =
    `{"status":"completed","executiveSummary":"string","findings":[{"title":"string","priority":"P1","file":"optional/path.ts","issue":"string","recommendation":"string"}],"nextSteps":["string"],"summary":"string","filesChanged":[{"path":"string","linesAdded":1,"linesRemoved":1}],"diff":"unified diff string","testReport":{"passed":0,"failed":0,"skipped":0,"duration":"0s","output":"string"},"buildReport":{"success":true,"warnings":0,"output":"string"},"requiresApproval":true,"approvalActions":["apply-patch","create-pr"]}`;
  const prompt = [
    `Task: ${buildTaskWithExecutionDiscipline({
      task: input.task,
      longTermMemoryContext: input.longTermMemoryContext,
      skill: input.skill,
      role: input.agentRole,
      selectedFiles: input.selectedFiles,
    })}`,
    `Skill: ${input.skill}`,
    `Agent role: ${input.agentRole ?? "general"}`,
    `Terminal mode: ${input.terminalAccess ? "enabled (allowlist only)" : "standard"}`,
    `Repository: ${input.repoUrl || "Current Elyra workspace repo"}`,
    `Branch: ${input.branch}`,
    ...buildAttachmentPromptContext(input.attachments),
    formatRealPathHints(input.repoSnapshot ?? null, input.task),
    ...(input.selectedFiles && input.selectedFiles.length > 0 ? [buildSelectedFileHints(input.selectedFiles)] : []),
    ...(selectedFileGroundTruth ? [selectedFileGroundTruth] : []),
    ...(isReviewOnly
      ? [
          "Mode: repository-review-only",
          "Analyse the codebase and return recommendations only.",
          "Do not propose or imply file edits. filesChanged must be [] and diff must be an empty string.",
          "Use the summary field as a concise markdown report with sections: Executive Summary, Highest Impact Fixes, Performance, DX, Risks, Quick Wins.",
          "Return 3-8 concrete findings. Each finding must include title, priority (high|medium|low), issue, recommendation, and a file path when you can identify one.",
          "Do not report generic security findings just because a file uses child_process, shell execution, local tooling, or admin-only developer flows. Only report a security issue when the repository evidence shows an externally reachable, insufficiently guarded, or production-exposed attack path.",
          "Prefer repo-specific, evidenced findings over generic best-practice complaints.",
          "nextSteps should be short action prompts that a coding planner can directly execute.",
          ...(reviewInvestigation ? ["Use the concrete repository investigation evidence below and stay anchored to it.", "", reviewInvestigation.context] : []),
          formatRepoSnapshot(input.repoSnapshot ?? null),
        ]
      : []),
    ...(isReviewWithFixes
      ? [
          "Mode: review-with-proposed-fixes",
          "Analyse the codebase, rank the most important issues, and prepare a minimal proposed diff for the top findings.",
          "Return 3-8 findings with priority (P1|P2|P3), issue, recommendation, and file path when possible.",
          "The diff should address the highest-value fixes only.",
          "nextSteps should be short implementation tasks that a coding planner can directly execute.",
          formatRepoSnapshot(input.repoSnapshot ?? null),
        ]
      : []),
    "",
    "Return ONLY JSON matching this shape:",
    isReviewOnly
      ? reviewResponseShape
      : isReviewWithFixes
        ? reviewWithFixesShape
      : `{"status":"completed","summary":"string","filesChanged":[{"path":"string","linesAdded":1,"linesRemoved":1}],"diff":"unified diff string","testReport":{"passed":1,"failed":0,"skipped":0,"duration":"string","output":"string"},"buildReport":{"success":true,"warnings":0,"output":"string"},"requiresApproval":true,"approvalActions":["apply-patch","create-pr"]}`,
    isReviewOnly
      ? "Use short arrays. Keep each item concise and concrete. No markdown fences."
      : isReviewWithFixes
        ? "The diff should be minimal and directly tied to the highest-priority findings. No markdown fences."
      : "The diff MUST be a real minimal unified diff (--- a/... +++ b/... @@ ... @@) that addresses the task. No markdown fences. The diff field must NOT be empty. Keep summary to 1-2 sentences max so the diff gets the most tokens.",
  ].join("\n");
  const parsed = await callProviderJson(input.provider, {
    system:
      injectLongTermMemory(
        `You are an expert coding agent preparing a proposed patch result. Return only strict JSON describing a realistic code change proposal.\n${agentRolePrompt(input.agentRole ?? "general", input.terminalAccess === true)}`,
        input.longTermMemoryContext,
      ),
    prompt,
    // Do NOT pass responseSchema here: the schema constrains string field length and causes
    // Gemini to truncate the diff mid-JSON. With responseMimeType: "application/json" alone,
    // Gemini generates complete diffs reliably.
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(typeof providerCwd === "string" ? { cwd: providerCwd } : {}),
    ...(typeof input.allowProviderFailover === "boolean"
      ? { allowProviderFailover: input.allowProviderFailover }
      : {}),
  });

  const filesChanged = Array.isArray(parsed.filesChanged)
    ? parsed.filesChanged.map((item) => {
        const row = item && typeof item === "object" ? (item as JsonRecord) : {};
        return {
          path: typeof row.path === "string" ? row.path : "src/example.ts",
          linesAdded: typeof row.linesAdded === "number" ? row.linesAdded : 0,
          linesRemoved: typeof row.linesRemoved === "number" ? row.linesRemoved : 0,
        };
      })
    : [];
  const listFrom = (key: string): string[] =>
    Array.isArray(parsed[key])
      ? parsed[key]
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((item): ReviewFinding | null => {
          const row = item && typeof item === "object" ? (item as JsonRecord) : {};
          const title = typeof row.title === "string" ? row.title.trim() : "";
          const issue = typeof row.issue === "string" ? row.issue.trim() : "";
          const recommendation = typeof row.recommendation === "string" ? row.recommendation.trim() : "";
          if (!title || !issue || !recommendation) return null;
          const priorityRaw = typeof row.priority === "string" ? row.priority.trim().toUpperCase() : "P2";
          const priority =
            priorityRaw === "HIGH" ? "P1"
            : priorityRaw === "MEDIUM" ? "P2"
            : priorityRaw === "LOW" ? "P3"
            : priorityRaw;
          return {
            title,
            priority: priority === "P1" || priority === "P3" ? priority : "P2",
            ...(typeof row.file === "string" && row.file.trim() ? { file: row.file.trim() } : {}),
            issue,
            recommendation,
          };
        })
        .filter((item): item is ReviewFinding => item !== null)
    : [];
  const nextSteps = Array.isArray(parsed.nextSteps)
    ? parsed.nextSteps
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
  const reviewSummary = isReviewOnly
    ? [
        "## Executive Summary",
        typeof parsed.executiveSummary === "string"
          ? parsed.executiveSummary
          : `Review completed for: ${input.task}`,
        "",
        "## Highest Impact Fixes",
        ...(listFrom("highestImpactFixes").length > 0 ? listFrom("highestImpactFixes").map((item) => `- ${item}`) : ["- No high-impact fixes were returned."]),
        "",
        "## Performance",
        ...(listFrom("performance").length > 0 ? listFrom("performance").map((item) => `- ${item}`) : ["- No specific performance findings were returned."]),
        "",
        "## Developer Experience",
        ...(listFrom("developerExperience").length > 0 ? listFrom("developerExperience").map((item) => `- ${item}`) : ["- No DX findings were returned."]),
        "",
        "## Risks",
        ...(listFrom("risks").length > 0 ? listFrom("risks").map((item) => `- ${item}`) : ["- No explicit risks were returned."]),
        "",
        "## Quick Wins",
        ...(listFrom("quickWins").length > 0 ? listFrom("quickWins").map((item) => `- ${item}`) : ["- No quick wins were returned."]),
      ].join("\n")
    : "";

  return {
    status: typeof parsed.status === "string" ? parsed.status : "completed",
    skill: input.skill,
    task: input.task,
    summary:
      isReviewOnly
        ? reviewSummary
        : isReviewWithFixes
          ? typeof parsed.summary === "string"
            ? parsed.summary
            : "Review completed with a proposed fix set for the highest-priority findings."
        : typeof parsed.summary === "string"
          ? parsed.summary
          : `Gemini prepared a proposed patch for: ${input.task}`,
    findings: isReviewSkill ? findings : [],
    nextSteps: isReviewSkill ? nextSteps : [],
    ...(isReviewOnly
      ? {
          executionLog: [
            ...(reviewInvestigation?.trace ?? []),
            input.provider === "gemini"
              ? "Generated by Gemini gemini-2.5-pro"
              : input.provider === "openai"
                ? "Generated by OpenAI direct API"
                : input.provider === "claude_direct" || input.provider === "claude_vertex"
                  ? "Generated by Claude"
                  : `Generated by ${input.provider}`,
            `Review executor: ${input.provider} repository review`,
            `Execution root: ${providerCwd ?? process.cwd()}`,
            input.selectedFiles && input.selectedFiles.length > 0
              ? `Scope: ${input.selectedFiles.length} selected file(s).`
              : "Scope: repository read-only analysis.",
          ],
        }
      : {}),
    filesChanged: isReviewOnly ? [] : filesChanged,
    diff: isReviewOnly ? "" : typeof parsed.diff === "string" ? parsed.diff : "",
    testReport:
      parsed.testReport && typeof parsed.testReport === "object"
        ? parsed.testReport
        : { passed: 0, failed: 0, skipped: 0, duration: "0s", output: "No test output returned." },
    buildReport:
      parsed.buildReport && typeof parsed.buildReport === "object"
        ? parsed.buildReport
        : { success: true, warnings: 0, output: "No build output returned." },
    requiresApproval:
      isReviewOnly ? false : typeof parsed.requiresApproval === "boolean" ? parsed.requiresApproval : true,
    approvalActions:
      isReviewOnly
        ? []
        : Array.isArray(parsed.approvalActions) && parsed.approvalActions.length > 0
          ? parsed.approvalActions
          : ["apply-patch", "create-pr"],
  };
}

function normalizePlanArtifact(
  payload: unknown,
  input: { skill: CodingSkill; task: string; repoUrl: string; branch: string }
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return buildLocalPlan(input.skill, input.task, input.repoUrl, input.branch);
  }
  const record = payload as JsonRecord;
  if (record.artifact && typeof record.artifact === "object") {
    return record.artifact as JsonRecord;
  }
  if (record.plan && typeof record.plan === "object") {
    return {
      runId: typeof record.runId === "string" ? record.runId : `run-${Date.now()}`,
      skill: input.skill,
      task: input.task,
      repoUrl: input.repoUrl,
      branch: input.branch,
      status: typeof record.status === "string" ? record.status : "plan_ready",
      plan: record.plan,
      safetyPolicy:
        record.safetyPolicy && typeof record.safetyPolicy === "object"
          ? record.safetyPolicy
          : {
              networkDisabled: true,
              noAutoMerge: true,
              requiresApprovalBefore: ["repo.createPR", "file.delete"],
              maxIterations: 3,
            },
    };
  }
  return buildLocalPlan(input.skill, input.task, input.repoUrl, input.branch);
}

function normalizeResultArtifact(
  payload: unknown,
  input: { skill: CodingSkill; task: string; repoUrl: string; suggestionsOnly?: boolean; repoSnapshot?: RepoSnapshot | null }
): Record<string, unknown> {
  // ANALYSIS_ONLY_SKILLS never emit diffs; review-code is review-only when suggestionsOnly.
  const isReviewWithFixes = input.skill === "review-code" && input.suggestionsOnly !== true;
  const isReviewOnly =
    ANALYSIS_ONLY_SKILLS.has(input.skill) ||
    (input.skill === "review-code" && input.suggestionsOnly === true);
  if (!payload || typeof payload !== "object") {
    return {
      status: "failed",
      skill: input.skill,
      task: input.task,
      summary: "Provider returned no usable artifact payload.",
      ...(isReviewOnly || isReviewWithFixes ? { findings: [], nextSteps: [] } : {}),
      filesChanged: [],
      diff: "",
      testReport: {
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: "0s",
        output: "Provider returned no usable artifact payload.",
      },
      buildReport: { success: false, warnings: 0, output: "Provider returned no usable artifact payload." },
      requiresApproval: false,
      approvalActions: [],
    };
  }
  const record = payload as JsonRecord;
  if (record.artifact && typeof record.artifact === "object") {
    if (isReviewOnly) {
      const artifact = record.artifact as JsonRecord;
      return {
        ...artifact,
        findings: Array.isArray(artifact.findings) ? artifact.findings : [],
        nextSteps: Array.isArray(artifact.nextSteps) ? artifact.nextSteps : [],
        filesChanged: [],
        diff: "",
        requiresApproval: false,
        approvalActions: [],
      };
    }
    if (isReviewWithFixes) {
      const artifact = record.artifact as JsonRecord;
      return {
        ...artifact,
        findings: Array.isArray(artifact.findings) ? artifact.findings : [],
        nextSteps: Array.isArray(artifact.nextSteps) ? artifact.nextSteps : [],
        filesChanged: Array.isArray(artifact.filesChanged) ? artifact.filesChanged : [],
        diff: typeof artifact.diff === "string" ? artifact.diff : "",
        requiresApproval: typeof artifact.requiresApproval === "boolean" ? artifact.requiresApproval : true,
        approvalActions: Array.isArray(artifact.approvalActions) ? artifact.approvalActions : ["apply-patch", "create-pr"],
      };
    }
    return record.artifact as JsonRecord;
  }
  if (
    typeof record.summary === "string" ||
    Array.isArray(record.filesChanged) ||
    typeof record.diff === "string"
  ) {
    return {
      status: typeof record.status === "string" ? record.status : "completed",
      skill: input.skill,
      task: input.task,
      summary:
        typeof record.summary === "string"
          ? record.summary
          : isReviewOnly
            ? buildLocalReviewResult(input.task, input.repoSnapshot ?? null).summary
            : isReviewWithFixes
              ? buildLocalReviewWithFixesResult(input.task, input.repoSnapshot ?? null).summary
            : `Agent completed: ${input.task}.`,
      findings:
        (isReviewOnly || isReviewWithFixes) && Array.isArray(record.findings)
          ? record.findings
          : (isReviewOnly || isReviewWithFixes)
            ? buildLocalReviewResult(input.task, input.repoSnapshot ?? null).findings
            : [],
      nextSteps:
        (isReviewOnly || isReviewWithFixes) && Array.isArray(record.nextSteps)
          ? record.nextSteps
          : (isReviewOnly || isReviewWithFixes)
            ? buildLocalReviewResult(input.task, input.repoSnapshot ?? null).nextSteps
            : [],
      filesChanged:
        isReviewOnly ? []
        : Array.isArray(record.filesChanged) ? record.filesChanged
        : isReviewWithFixes ? buildLocalReviewWithFixesResult(input.task, input.repoSnapshot ?? null).filesChanged
        : [],
      diff:
        isReviewOnly ? ""
        : typeof record.diff === "string" ? record.diff
        : isReviewWithFixes ? String(buildLocalReviewWithFixesResult(input.task, input.repoSnapshot ?? null).diff)
        : "",
      testReport:
        record.testReport && typeof record.testReport === "object"
          ? record.testReport
          : { passed: 0, failed: 0, skipped: 0, duration: "0s", output: "No test output returned." },
      buildReport:
        record.buildReport && typeof record.buildReport === "object"
          ? record.buildReport
          : { success: true, warnings: 0, output: "No build output returned." },
      requiresApproval:
        isReviewOnly ? false : typeof record.requiresApproval === "boolean" ? record.requiresApproval : true,
      approvalActions:
        isReviewOnly ? []
        : Array.isArray(record.approvalActions) ? record.approvalActions
        : isReviewWithFixes ? ["apply-patch", "create-pr"]
        : ["apply-patch"],
    };
  }
  return {
    status: "failed",
    skill: input.skill,
    task: input.task,
    summary: "Provider returned an artifact in an unexpected shape.",
    ...(isReviewOnly || isReviewWithFixes ? { findings: [], nextSteps: [] } : {}),
    filesChanged: [],
    diff: "",
    testReport: {
      passed: 0,
      failed: 1,
      skipped: 0,
      duration: "0s",
      output: "Provider returned an artifact in an unexpected shape.",
    },
    buildReport: { success: false, warnings: 0, output: "Provider returned an artifact in an unexpected shape." },
    requiresApproval: false,
    approvalActions: [],
  };
}

async function finalizeExecutionArtifact(
  artifact: Record<string, unknown>,
  input: {
    phase: "plan" | "execute";
    repoUrl: string;
    skill: CodingSkill;
    suggestionsOnly: boolean;
    selectedFiles: string[];
    autoCommit: boolean;
    branchPerAgent?: boolean | undefined;
    agentBranchName?: string | undefined;
    stage: "playground" | "dev" | "prod";
    task: string;
    strictAi: boolean;
    provider: ProviderId;
    budgetUsd: number | undefined;
    deadlineMinutes: number | undefined;
    providedDiff?: string;
    /** Set when GitHub PR mode is active — clone context for post-apply push+PR. */
    githubCloneCtx?: { tmpDir: string; owner: string; repo: string; baseBranch: string; token: string } | null;
  }
): Promise<Record<string, unknown>> {
  if (input.phase !== "execute") return artifact;

  const rawDiff = typeof input.providedDiff === "string" && input.providedDiff.trim()
    ? input.providedDiff
    : typeof artifact.diff === "string"
      ? artifact.diff
      : "";
  if (!rawDiff.trim()) return artifact;
  // Fix AI-generated diffs that have wrong hunk counts in @@ headers.
  let diff = fixDiffHunkCounts(rawDiff.endsWith("\n") ? rawDiff : rawDiff + "\n");
  // Strip spurious removed lines (AI hallucinations like lone spaces) that don't exist in the
  // target files. Must run AFTER fixDiffHunkCounts so counts are recalculated afterwards.
  // Use the /tmp clone path when in GitHub PR mode so file reads target the right directory.
  const effectiveRepoUrl = input.githubCloneCtx
    ? `file://${input.githubCloneCtx.tmpDir}`
    : input.repoUrl;

  if (input.selectedFiles.length > 0) {
    const repoRoot = await resolveRepoRoot(effectiveRepoUrl.split("#")[0] ?? effectiveRepoUrl);
    const fileContents = await Promise.all(
      input.selectedFiles.slice(0, 4).map(async (relPath) => {
        try {
          return await readFile(path.resolve(repoRoot, relPath), "utf8");
        } catch {
          return "";
        }
      })
    );
    const combinedContent = fileContents.join("\n");
    if (combinedContent.trim()) {
      const stripped = stripSpuriousRemovedLines(diff, combinedContent);
      if (stripped !== diff) {
        diff = fixDiffHunkCounts(stripped);
      }
    }
  }

  try {
    const execution = await applyPatchAndVerify({
      repoUrl: effectiveRepoUrl,
      diff,
      selectedFiles: input.selectedFiles,
      autoCommit: input.githubCloneCtx ? false : input.autoCommit,  // push via PR instead
      branchPerAgent: input.githubCloneCtx ? false : input.branchPerAgent,
      agentBranchName: input.agentBranchName,
      stage: input.stage,
      task: input.task,
      strictAi: input.strictAi,
      provider: input.provider,
      budgetUsd: input.budgetUsd,
      deadlineMinutes: input.deadlineMinutes,
      skipGates: !!input.githubCloneCtx,  // no node_modules in /tmp clone — CI verifies via PR
    });
    if (!execution.applied) {
      return {
        ...artifact,
        summary: [
          typeof artifact.summary === "string" ? artifact.summary : "Execution finished.",
          "",
          execution.applyOutput,
        ].join("\n"),
        filesChanged: [],
        testReport: execution.testReport,
        buildReport: execution.buildReport,
        executionLog: execution.executionLog,
        ...(execution.previewUrl ? { previewUrl: execution.previewUrl } : {}),
        ...(execution.commitOutput ? { commitOutput: execution.commitOutput } : {}),
        ...(execution.workflow ? { workflow: execution.workflow } : {}),
        ...(execution.gates ? { gates: execution.gates } : {}),
        executionApplied: false,
        requiresApproval: false,
        approvalActions: [],
      };
    }

    // ── GitHub PR mode: push branch + open PR ────────────────────────────────
    let prUrl: string | null = null;
    let branchName: string | null = null;
    let compareUrl: string | null = null;
    let prWarning: string | undefined;
    if (input.githubCloneCtx) {
      try {
        const taskSlug = input.task.slice(0, 60);
        const prResult = await pushBranchAndCreatePR({
          token: input.githubCloneCtx.token,
          tmpDir: input.githubCloneCtx.tmpDir,
          owner: input.githubCloneCtx.owner,
          repo: input.githubCloneCtx.repo,
          baseBranch: input.githubCloneCtx.baseBranch,
          taskSlug,
          prTitle: `elly: ${taskSlug.slice(0, 72)}`,
          prBody: `Auto-generated by Elly.\n\n**Task:** ${input.task}\n\n**Provider:** ${input.provider}`,
        });
        prUrl = prResult.prUrl;
        branchName = prResult.branchName;
        compareUrl = prResult.compareUrl;
        prWarning = prResult.prWarning;
      } catch (prErr) {
        prWarning = `GitHub PR push failed: ${String(prErr)}`;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const originalSummary =
      typeof artifact.summary === "string" ? artifact.summary : "Execution completed.";
    const appliedSummary =
      input.skill === "review-code" && input.suggestionsOnly !== true
        ? "Proposed fixes were applied to the local repository and verification commands were executed."
        : input.githubCloneCtx
          ? `Patch was applied and pushed as a GitHub PR branch.${prUrl ? ` PR: ${prUrl}` : ""}`
          : "Patch was applied to the local repository and verification commands were executed.";
    const normalizedFilesChanged =
      Array.isArray(execution.appliedFiles) && execution.appliedFiles.length > 0
        ? execution.appliedFiles.map((filePath) => ({ path: filePath, linesAdded: 0, linesRemoved: 0 }))
        : Array.isArray(artifact.filesChanged)
          ? artifact.filesChanged
          : [];

    return {
      ...artifact,
      summary: [originalSummary, "", appliedSummary].join("\n"),
      diff: execution.appliedDiff ?? diff,
      filesChanged: normalizedFilesChanged,
      testReport: execution.testReport,
      buildReport: execution.buildReport,
      executionLog: execution.executionLog,
      ...(execution.previewUrl ? { previewUrl: execution.previewUrl } : {}),
      ...(execution.commitOutput ? { commitOutput: execution.commitOutput } : {}),
      ...(execution.workflow ? { workflow: execution.workflow } : {}),
      ...(execution.gates ? { gates: execution.gates } : {}),
      executionApplied: true,
      requiresApproval: false,
      approvalActions: [],
      ...(prUrl ? { prUrl } : {}),
      ...(branchName ? { branchName } : {}),
      ...(compareUrl ? { compareUrl } : {}),
      ...(prWarning ? { prWarning } : {}),
    };
  } finally {
    // Always clean up the /tmp clone when in GitHub PR mode.
    if (input.githubCloneCtx) {
      await cleanupGitHubClone(input.githubCloneCtx.tmpDir).catch(() => {});
    }
  }
}

// ── GET — capabilities + tool allowlist ───────────────────────────────────────

export async function GET(request: NextRequest) {
  // ── Quick path: provider status + repo list (no file scan) ──────────────────
  // Called by the UI on mount to populate the provider selector and repo dropdown
  // immediately, without waiting for the full repo scan (10–30 s on large repos).
  if (request.nextUrl.searchParams.has("quick")) {
    const quickLocalRepos = await listLocalRepos();
    return NextResponse.json({
      ok: true,
      providerStatus: getCodeProviderStatuses(),
      repoOptions: quickLocalRepos,
      skills: CODING_SKILLS,
    });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() ?? "";
  const selectedRepo = request.nextUrl.searchParams.get("repoUrl")?.trim() ?? "";
  let githubRepos: RepoOption[] = [];

  if (workspaceId) {
    const { response, payload } = await fetchWhoamiPayload(request);
    if (response.ok && payload && hasWorkspaceAccess(payload, workspaceId)) {
      githubRepos = await listGitHubRepos(workspaceId);
    }
  }

  const localRepos = await listLocalRepos();
  const folderRepo = selectedRepo || localRepos[0]?.value || "";
  const folderOptions = await listFolderOptions(folderRepo);
  const fileSnapshot = parseGitHubRepoUrl(folderRepo) ? null : await collectRepoSnapshot(folderRepo);
  const filteredFiles = (fileSnapshot?.files ?? [])
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      if (!REPO_SCAN_TEXT_EXTENSIONS.has(ext)) return false;
      if (file.startsWith(".")) return false;
      if (file.includes("/.")) return false;
      if (file.startsWith("docs/")) return false;
      if (file.startsWith(".github/")) return false;
      if (file.startsWith(".logs/")) return false;
      return true;
    });

  const prioritizedFiles = [...filteredFiles].sort((left, right) => {
    const byScore = fileOptionPriority(right) - fileOptionPriority(left);
    if (byScore !== 0) return byScore;
    return left.localeCompare(right);
  });

  const fileOptions: FileOption[] = prioritizedFiles
    .slice(0, 160)
    .map((file) => ({
      label: file,
      value: file,
    }));

  return NextResponse.json({
    ok: true,
    providerStatus: getCodeProviderStatuses(),
    toolAllowlist: TOOL_ALLOWLIST,
    repoOptions: [...localRepos, ...githubRepos],
    folderOptions,
    fileOptions,
    skills: CODING_SKILLS,
  });
}

// ── POST — start a coding run ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = ((await request.json().catch(() => null)) ?? {}) as {
    skill?: string;
    task?: string;
    taskContract?: CodeTaskContract;
    repoUrl?: string;
    branch?: string;
    provider?: string;
    useReasoning?: boolean;
    suggestionsOnly?: boolean;
    executionMode?: "strict" | "adaptive";
    teamMode?: TeamMode;
    teamConfig?: TeamConfig;
    folderPath?: string;
    attachments?: RunAttachment[];
    selectedFiles?: string[];
    autoCommit?: boolean;
    strictAi?: boolean;
    agentRole?: AgentRole;
    terminalAccess?: boolean;
    branchPerAgent?: boolean;
    agentBranchName?: string | undefined;
    stage?: "playground" | "dev" | "prod";
    workspaceId?: string | undefined;
    budgetUsd?: number;
    deadlineMinutes?: number;
    providedDiff?: string;
    designApproved?: boolean;
    designDraftUrl?: string;
    autoGenerateDraft?: boolean;
    vibeCoding?: boolean;
    runId?: string;
    phase?: "plan" | "execute"; // "plan" returns plan only; "execute" runs it
    autonomous?: boolean; // skip plan review and execute immediately (like Claude Code headless mode)
    aiLanguage?: string; // language code for Elly's responses ("en", "de", "hr", "pt", "es")
    repoBranch?: string; // explicit base branch for GitHub cloud coder (default: branch or "main")
    githubMode?: boolean; // force GitHub PR mode (clone → apply → push → PR) even on localhost
  };

  const taskContract = normalizeCodeTaskContract(body?.taskContract);
  const taskFromBody = typeof body?.task === "string" ? body.task.trim() : "";
  const task = taskFromBody || taskContract?.goal || "";

  if (!task) {
    return NextResponse.json({ ok: false, code: "TASK_REQUIRED", error: "task is required." }, { status: 400 });
  }
  const requestBody = body;

  let skill = (requestBody.skill ?? "custom") as CodingSkill;
  const runId =
    typeof requestBody.runId === "string" && requestBody.runId.trim() ? requestBody.runId.trim() : `run-${Date.now()}`;
  const repoUrl =
    (typeof requestBody.repoUrl === "string" && requestBody.repoUrl.trim()
      ? requestBody.repoUrl.trim()
      : taskContract?.scope.repoUrl) ?? "";
  const branch =
    (typeof requestBody.branch === "string" && requestBody.branch.trim()
      ? requestBody.branch.trim()
      : taskContract?.scope.branch) ?? "main";
  const folderPath =
    (typeof requestBody.folderPath === "string" && requestBody.folderPath.trim()
      ? requestBody.folderPath.trim()
      : taskContract?.scope.folderPath) ?? "";
  const autonomous = requestBody.autonomous === true;
  let phase = requestBody.phase ?? "plan";
  if (autonomous) {
    // Autonomous mode: execute immediately without plan-review step (like Claude Code headless).
    // Exception: review-code is always plan → execute (it has no code-writing step to skip, and
    // forcing phase=execute for a review task causes an execute artifact to be returned to the
    // plan handler which shows "0 steps" in the UI).
    const skillForPhaseOverride = typeof requestBody.skill === "string" ? requestBody.skill : "";
    if (skillForPhaseOverride !== "review-code") {
      phase = "execute";
    }
  }
  await appendCodeRunEventSafe({
    workspaceId: body.workspaceId,
    runId,
    eventType: "RUN_CREATED",
    summary: phase === "plan" ? "Coder run created. Planning started." : "Coder run created. Execution started.",
    detail: task,
  });
  if (taskContract) {
    await appendCodeRunEventSafe({
      workspaceId: body.workspaceId,
      runId,
      eventType: "PLAN_WRITTEN",
      summary: "Task contract received from chief orchestrator.",
      detail: taskContract.title,
    });
  }
  const providedDiff = typeof body.providedDiff === "string" ? body.providedDiff : "";
  let suggestionsOnly = body.suggestionsOnly === true;
  let forcedReviewOnlyMode = false;
  if (looksLikeRepoReviewOnlyTask(task) && body.suggestionsOnly !== false) {
    skill = "review-code";
    suggestionsOnly = true;
    forcedReviewOnlyMode = true;
  }
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name.trim() : "";
          const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
          const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64.trim() : "";
          const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : undefined;
          if (!name || !mimeType || !dataBase64) return null;
          return { name, mimeType, dataBase64, ...(sizeBytes != null ? { sizeBytes } : {}) };
        })
        .filter((item): item is RunAttachment => item !== null)
    : [];
  const rawSelectedFilesInput = Array.isArray(body.selectedFiles)
    ? body.selectedFiles
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : Array.isArray(taskContract?.scope.selectedFiles)
      ? taskContract.scope.selectedFiles
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
    : [];
  const normalizedSelectedFilesInput = await normalizeSelectedFilesForRepo(repoUrl, rawSelectedFilesInput);
  const selectedFilesInput = await correctStaleUiScopeForTask({
    repoUrl,
    task,
    selectedFiles: normalizedSelectedFilesInput,
  });
  const selectedFiles =
    skill === "ux-ui-design"
      ? selectedFilesInput.filter((file) => looksLikeFrontendUiFile(file))
      : selectedFilesInput;
  const autoCommit = body.autoCommit === true || taskContract?.constraints.autoCommit === true;
  const executionMode =
    body.executionMode === "strict" || body.executionMode === "adaptive"
      ? body.executionMode
      : taskContract?.constraints.executionMode === "strict"
        ? "strict"
        : "adaptive";
  const strictAi = executionMode === "strict" && body.strictAi !== false;
  const agentRole = body.agentRole ?? taskContract?.constraints.agentRole ?? "general";
  const teamMode = body.teamMode === "manual" ? "manual" : "auto";
  const teamConfig = body.teamConfig && typeof body.teamConfig === "object" ? body.teamConfig : undefined;
  const requestedTerminalAccess = body.terminalAccess === true || taskContract?.constraints.terminalAccess === true;
  const branchPerAgent = body.branchPerAgent === true || taskContract?.constraints.branchPerAgent === true;
  const agentBranchName =
    typeof body.agentBranchName === "string"
      ? body.agentBranchName
      : typeof taskContract?.constraints.agentBranchName === "string"
        ? taskContract.constraints.agentBranchName
        : undefined;
  const stage =
    body.stage === "dev" || body.stage === "prod"
      ? body.stage
      : taskContract?.constraints.stage === "dev" || taskContract?.constraints.stage === "prod"
        ? taskContract.constraints.stage
        : "playground";
  const budgetUsd =
    typeof body.budgetUsd === "number" && Number.isFinite(body.budgetUsd)
      ? Math.max(0, body.budgetUsd)
      : typeof taskContract?.constraints.budgetUsd === "number" && Number.isFinite(taskContract.constraints.budgetUsd)
        ? Math.max(0, taskContract.constraints.budgetUsd)
        : undefined;
  const deadlineMinutes =
    typeof body.deadlineMinutes === "number" && Number.isFinite(body.deadlineMinutes)
      ? Math.max(5, Math.round(body.deadlineMinutes))
      : typeof taskContract?.constraints.deadlineMinutes === "number" && Number.isFinite(taskContract.constraints.deadlineMinutes)
        ? Math.max(5, Math.round(taskContract.constraints.deadlineMinutes))
      : undefined;
  const requestStartedAt = Date.now();
  const deadlineMs = deadlineMinutes ? requestStartedAt + deadlineMinutes * 60_000 : null;
  const designApproved = body.designApproved === true;
  const designDraftUrl =
    typeof body.designDraftUrl === "string" ? body.designDraftUrl.trim() : "";
  const autoGenerateDraft = body.autoGenerateDraft === true;
  const vibeCoding = body.vibeCoding === true;
  let designDraft = detectDesignDraft({ draftUrl: designDraftUrl, task });
  const useReasoning = body.useReasoning === true || taskContract?.constraints.useReasoning === true;
  const providerStatuses = getCodeProviderStatuses();
  const explicitProviderRequested = body.provider != null && body.provider !== "auto";
  const preferBroadAnalysisProvider =
    looksLikeRepoReviewOnlyTask(task) || looksLikeBroadAnalysisTask(task);
  // In autonomous mode without an explicit provider:
  // - broad review/analysis prefers Gemini CLI for read-first terminal inspection
  // - scoped repo-aware execution also prefers Gemini CLI
  const autonomousDefaultProvider: ProviderId = preferBroadAnalysisProvider
    ? providerStatuses.gemini_cli.configured
      ? "gemini_cli"
      : providerStatuses.gemini.configured
        ? "gemini"
        : providerStatuses.openai.configured
          ? "openai"
          : providerStatuses.claude_direct.configured
            ? "claude_direct"
            : providerStatuses.claude_vertex.configured
              ? "claude_vertex"
              : "gemini_cli"
    : providerStatuses.gemini_cli.configured
        ? "gemini_cli"
      : providerStatuses.gemini.configured
        ? "gemini"
        : providerStatuses.openai.configured
          ? "openai"
          : providerStatuses.claude_direct.configured
            ? "claude_direct"
            : providerStatuses.claude_vertex.configured
              ? "claude_vertex"
              : "gemini";
  const preferredProvider =
    vibeCoding
      ? resolveVibeProvider({
          task,
          role: agentRole,
          statuses: providerStatuses,
          useReasoning,
          skill,
        })
      : (body.provider === "auto" || body.provider == null) && preferBroadAnalysisProvider
        ? providerStatuses.gemini_cli.configured
          ? "gemini_cli"
          : providerStatuses.gemini.configured
            ? "gemini"
            : suggestedProviderForRole(agentRole)
      : body.provider === "auto" || body.provider == null
        ? autonomous ? autonomousDefaultProvider : suggestedProviderForRole(agentRole)
        : body.provider === "claude"
          ? bestClaudeProvider(providerStatuses) ?? "claude_direct"
        : resolveProvider(
            typeof body.provider === "string" && body.provider.trim()
              ? body.provider
              : taskContract?.constraints.provider ?? "auto",
            autonomous ? autonomousDefaultProvider : suggestedProviderForRole(agentRole),
          );
  const resolvedProvider = resolveProviderForWorkspace({
    preferred: preferredProvider as ProviderId,
    requiresReasoning: useReasoning,
    requiresToolCalls: true,
  });
  const provider = resolvedProvider.provider;
  const providerStatus = providerStatuses[provider];
  const fallbackUsed = resolvedProvider.fallbackUsed;
  if (explicitProviderRequested && fallbackUsed) {
    const requestedStatus = providerStatuses[preferredProvider as ProviderId];
    return NextResponse.json(
      {
        ok: false,
        code: "PROVIDER_UNAVAILABLE",
        error: `${requestedStatus.label} is not ready for this run.`,
        details: requestedStatus.issues,
        requestedProvider: preferredProvider,
        providerStatus: providerStatuses,
      },
      { status: 412 }
    );
  }
  const effectiveReasoning = useReasoning && providerStatus.capabilities.supportsReasoning;
  const fastInferredScopedFiles =
    selectedFiles.length === 0 && !parseGitHubRepoUrl(repoUrl)
      ? skill === "ux-ui-design"
        ? await inferUxUiDesignScopedFilesFast(repoUrl, task)
        : await inferTaskScopedFilesFast(repoUrl, task)
      : [];
  const hasFastScopedExecutionHint =
    selectedFiles.length > 0 ||
    fastInferredScopedFiles.length > 0 ||
    folderPath.trim().length > 0;
  const shouldSkipRepoSnapshot =
    phase === "execute" &&
    skill !== "review-code" &&
    !parseGitHubRepoUrl(repoUrl) &&
    hasFastScopedExecutionHint;
  if (!shouldSkipRepoSnapshot && (skill === "review-code" || !parseGitHubRepoUrl(repoUrl))) {
    await appendCodeRunEventSafe({
      workspaceId: body.workspaceId,
      runId,
      eventType: "TOOL_STARTED",
      summary: "Scanning repository files…",
      detail: folderPath.trim() ? `Scope: ${folderPath.trim()}` : "Whole repository indexed for context.",
    });
  }
  const repoSnapshot =
    shouldSkipRepoSnapshot
      ? null
      : skill === "review-code" || !parseGitHubRepoUrl(repoUrl)
        ? await collectRepoSnapshot(repoUrl, folderPath, branch, body.workspaceId ?? "")
        : null;
  if (repoSnapshot) {
    await appendCodeRunEventSafe({
      workspaceId: body.workspaceId,
      runId,
      eventType: "TOOL_COMPLETED",
      summary: `Found ${repoSnapshot.fileCount} files${repoSnapshot.truncated ? " (index truncated)" : ""}.`,
      detail: repoSnapshot.sampledFiles.length > 0
        ? `Reading: ${repoSnapshot.sampledFiles.slice(0, 6).map((f) => f.path).join(", ")}${repoSnapshot.sampledFiles.length > 6 ? ` +${repoSnapshot.sampledFiles.length - 6} more` : ""}`
        : "No excerpts sampled.",
    });
    for (const sf of repoSnapshot.sampledFiles.slice(0, 8)) {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "TOOL_STARTED",
        summary: `Read: ${sf.path}`,
        detail: sf.excerpt.slice(0, 120),
      });
    }
  }
  const warningNotes: string[] = [];
  const runBudgetProfile = evaluateRunBudgetProfile({
    provider,
    task,
    repoSnapshot,
    attachments,
    selectedFiles,
    budgetUsd,
    skill,
    suggestionsOnly,
  });
  let effectiveRepoSnapshot = runBudgetProfile.recommendedSnapshot;
  if (runBudgetProfile.budgetStatus === "over" && effectiveRepoSnapshot) {
    effectiveRepoSnapshot = null;
    warningNotes.push("Token policy: falling back to metadata-only repository review because the compressed context still exceeds the model input limit.");
  }
  const supervisorPlan = supervisorTeamPlan({
    task,
    role: agentRole,
    budgetUsd,
    deadlineMinutes,
    ...(teamMode ? { teamMode } : {}),
    ...(teamConfig ? { teamConfig } : {}),
  });
  const inferredScopedFiles =
    selectedFiles.length === 0
        ? fastInferredScopedFiles.length > 0
        ? fastInferredScopedFiles
        : skill === "ux-ui-design"
          ? await inferUxUiDesignScopedFiles(repoUrl, effectiveRepoSnapshot, task)
          : await inferTaskScopedFiles(repoUrl, effectiveRepoSnapshot, task)
      : [];
  const wholeRepoReviewMode =
    skill === "review-code" &&
    suggestionsOnly === true &&
    looksLikeWholeRepoReviewTask(task);
  const effectiveSelectedFiles = wholeRepoReviewMode ? [] : selectedFiles.length > 0 ? selectedFiles : inferredScopedFiles;
  const effectiveRepoUrl = folderPath ? `${repoUrl}#${folderPath}` : repoUrl;
  const requiresScopedExecution = shouldRequireScopedExecutionForTask(task, skill, agentRole);
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;

  // ── GitHub Cloud Coder: clone remote GitHub repo ─────────────────────────
  // When the target repoUrl is a GitHub URL and the workspace has a GitHub
  // token connected, we shallow-clone the repo to /tmp so the entire existing
  // patch pipeline (applyPatchAndVerify) can run against it locally.
  // After a successful apply we push a feature branch and open a PR.
  type GitHubCloneCtx = {
    tmpDir: string;
    owner: string;
    repo: string;
    baseBranch: string;
    token: string;
  };
  let githubCloneCtx: GitHubCloneCtx | null = null;
  // Outer try-finally ensures the /tmp clone is removed even when a guard
  // returns early (e.g. PROMOTION_REQUIRED) before executeArtifactWithApply
  // gets a chance to run its own cleanup.  cleanupGitHubClone uses { force:true }
  // so calling it twice (here + inside executeArtifactWithApply) is safe.
  try {
  const ghParsed = parseGitHubRepoUrl(repoUrl);
  if (ghParsed && workspaceId && phase === "execute") {
    const ghToken = await loadStoredGitHubToken(workspaceId).catch(() => null);
    if (ghToken?.accessToken) {
      const baseBranch =
        (typeof body.repoBranch === "string" && body.repoBranch.trim()
          ? body.repoBranch.trim()
          : branch) || "main";
      try {
        const tmpDir = await cloneRepoToTmp(ghToken.accessToken, ghParsed.owner, ghParsed.repo, baseBranch);
        githubCloneCtx = {
          tmpDir,
          owner: ghParsed.owner,
          repo: ghParsed.repo,
          baseBranch,
          token: ghToken.accessToken,
        };
      } catch (cloneErr) {
        warningNotes.push(
          `GitHub clone failed — falling back to diff-only mode: ${String(cloneErr)}`,
        );
      }
    }
  }
  // GitHub PR mode for local repos on Vercel (or when explicitly requested):
  // When VERCEL=1 or the caller sets githubMode:true, clone the repo from GitHub
  // so the patch pipeline can run against the /tmp clone, then push a PR branch.
  // GITHUB_REPO env var: "owner/repo" format (e.g. "paulodak/elyra-core").
  const requestedGithubMode = body.githubMode === true;
  const isCloudMode = process.env.VERCEL === "1";
  if ((isCloudMode || requestedGithubMode) && githubCloneCtx === null && phase === "execute" && workspaceId) {
    const ghEnvRepo = (process.env.GITHUB_REPO ?? "").trim();
    const ghEnvToken = (process.env.GITHUB_TOKEN ?? "").trim();
    const ghEnvParsed = ghEnvRepo.match(/^([^/]+)\/([^/]+)$/);
    if (ghEnvParsed) {
      // Prefer OAuth token from workspace; fall back to PAT env var.
      const storedGh = await loadStoredGitHubToken(workspaceId).catch(() => null);
      const ghToken = storedGh?.accessToken || ghEnvToken;
      if (ghToken) {
        const owner = ghEnvParsed[1]!;
        const repo = ghEnvParsed[2]!;
        const baseBranch =
          (typeof body.repoBranch === "string" && body.repoBranch.trim()
            ? body.repoBranch.trim()
            : branch) || "main";
        try {
          const tmpDir = await cloneRepoToTmp(ghToken, owner, repo, baseBranch);
          githubCloneCtx = { tmpDir, owner, repo, baseBranch, token: ghToken };
          warningNotes.push(`GitHub PR mode: cloned ${owner}/${repo}@${baseBranch} — will push PR branch after apply.`);
        } catch (cloneErr) {
          warningNotes.push(`GitHub clone failed — will require local execution: ${String(cloneErr)}`);
        }
      }
    }
  }

  // For GitHub cloud mode: use the clone path so applyPatchAndVerify sees a
  // writable local repo. For all other modes: same as before.
  const codeRepoUrl = githubCloneCtx ? `file://${githubCloneCtx.tmpDir}` : repoUrl;
  // ─────────────────────────────────────────────────────────────────────────

  const workspaceBrainProfile = await loadWorkspaceBrainProfile(workspaceId);
  const workspaceMemories = shouldSkipRepoSnapshot
    ? []
    : await loadWorkspaceMemories({
        request,
        ...(typeof workspaceId === "string" ? { workspaceId } : {}),
        task,
      });
  warningNotes.push(...runBudgetProfile.notes);
  const longTermMemoryContext = buildLongTermMemoryContext({
    ...(typeof workspaceId === "string" ? { workspaceName: workspaceId } : {}),
    profile: workspaceBrainProfile,
    memories: workspaceMemories,
  });
  if (longTermMemoryContext) {
    warningNotes.push("Elly long-term memory loaded for this run.");
  }
  if (forcedReviewOnlyMode) {
    warningNotes.push("Auto-mode: interpreted task as repository review-only (no patch execution).");
  }
  if (vibeCoding) {
    warningNotes.push(`Vibe coding active: routing via ${providerStatuses[preferredProvider]?.label ?? preferredProvider}.`);
  }
  if (autonomous) {
    warningNotes.push(`Autonomous mode: plan review skipped, executing directly via ${providerStatus.label}.`);
  }
  if (skill === "ux-ui-design" && selectedFilesInput.length > selectedFiles.length) {
    warningNotes.push(
      `UX/UI scope guard removed ${selectedFilesInput.length - selectedFiles.length} non-UI file target(s).`
    );
  }

  // Enforce preview-first pipeline:
  // direct execute runs must happen in playground; dev/prod requires promotion replay.
  // ANALYSIS_ONLY_SKILLS never touch the filesystem regardless of suggestionsOnly.
  const isReadOnlyReviewRun =
    ANALYSIS_ONLY_SKILLS.has(skill) ||
    (skill === "review-code" && suggestionsOnly === true);
  if (
    phase === "execute" &&
    (stage === "dev" || stage === "prod") &&
    !isReadOnlyReviewRun &&
    !providedDiff.trim()
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROMOTION_REQUIRED",
        error:
          "Direct execute is blocked for dev/prod. Run in playground first, verify on localhost:3100, then promote.",
      },
      { status: 412 },
    );
  }

  // In hosted cloud mode we cannot apply local filesystem patches for repository-backed
  // coding runs unless GitHub PR mode is active (clone → apply → push → PR).
  if (
    phase === "execute" &&
    process.env.VERCEL === "1" &&
    !isReadOnlyReviewRun &&
    !providedDiff.trim() &&
    githubCloneCtx === null  // GitHub PR mode bypasses this guard
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "LOCAL_EXECUTION_REQUIRED",
        error:
          "Code execute requires local mode or GitHub PR mode. Open the Coder on localhost:3000, or set GITHUB_REPO + connect GitHub in workspace settings to enable cloud execution via PR.",
        details: [
          "Hosted mode can generate plans/diffs, but cannot apply repository patches without GitHub.",
          "Option A: Run in localhost:3000 for full apply + tests + preview workflow.",
          "Option B: Set GITHUB_REPO=owner/repo env var and connect GitHub OAuth → changes will be pushed as a PR branch.",
        ],
      },
      { status: 412 },
    );
  }
  const capabilities = roleCapabilities(agentRole);
  const terminalAccess = requestedTerminalAccess && capabilities.canTerminal;
  if (requestedTerminalAccess && !terminalAccess) {
    warningNotes.push(`RBAC: terminal mode disabled for role '${agentRole}'.`);
  }
  const shouldUseGeminiCliReviewExecutor =
    phase === "execute" &&
    provider === "gemini_cli" &&
    (ANALYSIS_ONLY_SKILLS.has(skill) || skill === "review-code" || suggestionsOnly === true || looksLikeRepoReviewOnlyTask(task) || looksLikeBroadAnalysisTask(task));

  if (stage === "prod" && !capabilities.canProdStage) {
    return NextResponse.json(
      {
        ok: false,
        code: "RBAC_STAGE_DENIED",
        error: `RBAC: role '${agentRole}' cannot execute directly in prod stage.`,
      },
      { status: 403 }
    );
  }
  const compliance = evaluateComplianceGuardrails({ task, attachments, stage });
  if (compliance.requiresHumanApproval) {
    warningNotes.push(`Compliance guardrails: ${compliance.issues.join(" ")}`);
  }
  if (compliance.blocked) {
    return NextResponse.json(
      {
        ok: false,
        code: "COMPLIANCE_APPROVAL_REQUIRED",
        error: "Prod-stage run blocked by compliance guardrails. Approve manually after legal/security review.",
        details: compliance.issues,
      },
      { status: 412 }
    );
  }

  if (phase === "execute" && skill === "ux-ui-design" && !designDraft.valid) {
    if (autoGenerateDraft) {
      const generatedDraft = await tryGenerateDesignDraftViaMcp({
        task,
        repoUrl,
        branch,
        ...(typeof body.workspaceId === "string" ? { workspaceId: body.workspaceId } : {}),
        origin: request.nextUrl.origin,
      });
      if (generatedDraft?.valid) {
        designDraft = generatedDraft;
        warningNotes.push("Design draft URL was auto-generated via MCP webhook.");
      } else {
        warningNotes.push(
          "Auto-draft generation failed. Configure FIGMA_MCP_DRAFT_WEBHOOK_URL (or STITCH/BANANA draft webhook) to let Elly generate draft URLs automatically.",
        );
      }
    }
  }

  if (phase === "execute" && skill === "ux-ui-design" && !designDraft.valid) {
    return NextResponse.json(
      {
        ok: false,
        code: "DESIGN_DRAFT_URL_REQUIRED",
        error:
          "UX/UI Design execute requires a valid design draft URL (Figma, Google Stitch, or Banana). Add it in 'Design draft URL' or enable auto-draft via MCP webhook.",
      },
      { status: 400 }
    );
  }

  if (phase === "execute" && skill === "ux-ui-design" && !designApproved) {
    const figmaConnectUrl = process.env.FIGMA_CONNECT_URL?.trim() || process.env.NEXT_PUBLIC_FIGMA_CONNECT_URL?.trim() || "https://www.figma.com/settings";
    const stitchConnectUrl = process.env.GOOGLE_STITCH_CONNECT_URL?.trim() || process.env.NEXT_PUBLIC_GOOGLE_STITCH_CONNECT_URL?.trim() || "https://stitch.withgoogle.com/";
    const banana2ConnectUrl = process.env.BANANA2_CONNECT_URL?.trim() || process.env.NEXT_PUBLIC_BANANA2_CONNECT_URL?.trim() || "https://www.banana.dev/";
    const twentyfirstConnectUrl = process.env.TWENTYFIRST_CONNECT_URL?.trim() || process.env.NEXT_PUBLIC_TWENTYFIRST_CONNECT_URL?.trim() || "https://21st.dev/";
    const artifact = buildUxDesignApprovalGateArtifact({
      task,
      figmaConnectUrl,
      stitchConnectUrl,
      banana2ConnectUrl,
      twentyfirstConnectUrl,
      ...(designDraft.url ? { designDraftUrl: designDraft.url } : {}),
    });
    return NextResponse.json({
      ok: true,
      source: "design-gate",
      phase,
      provider,
      requestedProvider: preferredProvider,
      providerLabel: providerStatus.label,
      useReasoning: effectiveReasoning,
      ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
      selectedFiles: effectiveSelectedFiles,
      artifact: {
        ...artifact,
        designDraft: {
          url: designDraft.url,
          provider: designDraft.provider,
          detected: designDraft.detectedFrom !== "none",
          detectedFrom: designDraft.detectedFrom,
          approved: false,
        },
      },
    });
  }

  if (phase === "execute" && skill === "ux-ui-design") {
    const frontendScoped = effectiveSelectedFiles.filter((file) => looksLikeFrontendUiFile(file));
    if (frontendScoped.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "UI_SCOPE_REQUIRED",
          error:
            "UX/UI Design execute requires frontend target files. Select at least one real UI file (for example frontend/components/os/shell/IdentityMenu.tsx) before execution.",
        },
        { status: 400 }
      );
    }
  }

  if (strictAi && looksLikeUiStylingTask(task) && effectiveSelectedFiles.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "STRICT_AI_FILE_SCOPE_REQUIRED",
        error:
          "Strict AI mode: no UI target files could be scoped from this task. Select target files (e.g. frontend/components/os/shell/IdentityMenu.tsx) or use the frontend repo path.",
      },
      { status: 400 }
    );
  }

  // ── Autonomous Agentic Loop (Elly Assistant — powered by Elyra Core) ─────────
  // When autonomous === true and the repo is local, bypass all rigid skill phases
  // and hand off to Elly's ReAct loop — she explores, reasons, and applies changes.
  const canUseAutonomousLoop =
    autonomous &&
    phase === "execute" &&
    !parseGitHubRepoUrl(repoUrl) &&
    !providedDiff.trim() &&
    skill !== "review-code";

  if (canUseAutonomousLoop) {
    try {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "PLAN_WRITTEN",
        summary: "Autonomous mode: Elly will reason and act without a plan-review step.",
        detail: `Provider: ${providerStatus.label} | Task: ${task.slice(0, 120)}`,
      });

      const agentOutcome = await executeAutonomousAgenticLoop({
        repoUrl,
        task,
        selectedFiles: effectiveSelectedFiles,
        skill,
        provider,
        providerStatus,
        ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
        runId,
        ...(longTermMemoryContext ? { longTermMemoryContext } : {}),
        warningNotes,
        attachments,
        ...(body.aiLanguage ? { aiLanguage: body.aiLanguage } : {}),
      });

      const agentArtifact = withDesignDraftMetadata(
        {
          status: agentOutcome.applied ? "completed" : "failed",
          skill,
          task,
          summary: agentOutcome.applyOutput,
          filesChanged: (agentOutcome.appliedFiles ?? []).map((filePath) => ({
            path: filePath,
            linesAdded: 0,
            linesRemoved: 0,
          })),
          diff: agentOutcome.appliedDiff ?? "",
          testReport: agentOutcome.testReport,
          buildReport: agentOutcome.buildReport,
          requiresApproval: false,
          approvalActions: [],
          executionApplied: agentOutcome.applied,
          executionLog: agentOutcome.executionLog,
          ...(agentOutcome.workflow ? { workflow: agentOutcome.workflow } : {}),
          telemetry: {
            provider,
            model: providerStatus.model,
            fallbackUsed,
            replayId: createHash("sha256").update(`elli-autonomous:${task}:${runId}`).digest("hex").slice(0, 16),
          },
        } as JsonRecord,
        { skill, designDraft, designApproved },
      );

      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: agentArtifact as JsonRecord,
      });

      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: agentOutcome.applied ? "RUN_SUCCEEDED" : "RUN_FAILED",
        summary: agentOutcome.applied ? "Elly completed the task." : "Elly did not apply any changes.",
        detail: agentOutcome.applyOutput,
      });

      return NextResponse.json({
        ok: true,
        source: "elli-autonomous",
        phase,
        autonomous: true,
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact: agentArtifact,
      });
    } catch (error) {
      const failure = buildProviderRuntimeFailure({
        error,
        fallbackMessage: `Elly autonomous loop failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Autonomous Elly loop failed.",
        detail: failure.error,
      });
      return NextResponse.json(
        {
          ok: false,
          code: failure.code,
          error: failure.error,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
        },
        { status: failure.status },
      );
    }
  }

  if (shouldUseGeminiCliReviewExecutor) {
    try {
      const reviewArtifact = withDesignDraftMetadata(
        await executeGeminiCliReview({
          repoUrl,
          stage,
          task,
          selectedFiles: effectiveSelectedFiles,
          attachments,
          provider,
          providerStatus,
          fallbackUsed,
          ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
          runId,
          warningNotes,
        }),
        {
          skill,
          designDraft,
          designApproved,
        },
      );
      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: reviewArtifact,
      });
      return NextResponse.json({
        ok: true,
        source: "gemini-cli-review",
        phase,
        ...(autonomous ? { autonomous: true } : {}),
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact: reviewArtifact,
      });
    } catch (error) {
      const failure = buildProviderRuntimeFailure({
        error,
        fallbackMessage: `Gemini CLI review failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Gemini CLI review executor failed.",
        detail: failure.error,
      });
      return NextResponse.json(
        {
          ok: false,
          code: failure.code,
          error: failure.error,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
        },
        { status: failure.status },
      );
    }
  }
  if (
    phase === "execute" &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    terminalAccess &&
    requiresScopedExecution &&
    effectiveSelectedFiles.length === 0 &&
    folderPath.trim().length === 0
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "SCOPED_EXECUTION_REQUIRED",
        error:
          "This task looks like a scoped frontend/UI change, but Elyra could not resolve a safe file or folder scope. Select target files or a folder before running with terminal access.",
        details: [
          "Full-repository terminal execution is blocked for small scoped tasks.",
          "Choose real target files or a specific frontend folder, then rerun.",
        ],
      },
      { status: 412 }
    );
  }
  let modelGenerationError: string | null = null;

  // ── Deadline guard: abort before execute if deadline has already elapsed ────
  if (phase === "execute" && deadlineMs && Date.now() > deadlineMs) {
    return NextResponse.json(
      {
        ok: false,
        code: "DEADLINE_EXCEEDED",
        error: `Execution deadline of ${deadlineMinutes}min elapsed before execute could start.`,
      },
      { status: 412 },
    );
  }

  if (phase === "execute" && providedDiff.trim()) {
    if ((stage === "dev" || stage === "prod") && effectiveSelectedFiles.length > 0) {
      const promotedExecution = await applyPlaygroundPromotionAndVerify({
        repoUrl,
        selectedFiles: effectiveSelectedFiles,
        autoCommit,
        branchPerAgent,
        agentBranchName,
        stage,
        task,
        budgetUsd,
        deadlineMinutes,
      });
      if (promotedExecution) {
        const promotedArtifact = withDesignDraftMetadata({
          status: "completed",
          skill,
          task,
          summary: promotedExecution.applyOutput,
          filesChanged: promotedExecution.appliedFiles?.map((filePath) => ({ path: filePath, linesAdded: 0, linesRemoved: 0 })) ?? [],
          diff: promotedExecution.appliedDiff ?? providedDiff,
          testReport: promotedExecution.testReport,
          buildReport: promotedExecution.buildReport,
          requiresApproval: false,
          approvalActions: [],
          executionApplied: promotedExecution.applied,
          executionLog: promotedExecution.executionLog,
          workflow: promotedExecution.workflow,
          gates: promotedExecution.gates,
          ...(promotedExecution.previewUrl ? { previewUrl: promotedExecution.previewUrl } : {}),
          ...(promotedExecution.commitOutput ? { commitOutput: promotedExecution.commitOutput } : {}),
        } as JsonRecord, {
          skill,
          designDraft,
          designApproved,
        });
        return NextResponse.json({
          ok: true,
          source: "promotion-replay",
          phase,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
          useReasoning: false,
          ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
          selectedFiles: effectiveSelectedFiles,
          artifact: promotedArtifact,
        });
      }
    }

    const seededArtifact: Record<string, unknown> = {
      status: "completed",
      summary: "Promotion replay run.",
      filesChanged: [],
      diff: providedDiff,
      testReport: { passed: 0, failed: 0, skipped: 0, duration: "0s", output: "Pending verification." },
      buildReport: { success: true, warnings: 0, output: "Pending verification." },
      requiresApproval: false,
      approvalActions: [],
    };
    const artifact = await finalizeExecutionArtifact(seededArtifact, {
      phase,
      repoUrl: codeRepoUrl,
      skill,
      suggestionsOnly,
      selectedFiles: effectiveSelectedFiles,
      autoCommit: githubCloneCtx ? false : autoCommit,
      branchPerAgent,
      agentBranchName,
      stage,
      task,
      strictAi,
      provider,
      budgetUsd,
      deadlineMinutes,
      providedDiff,
      githubCloneCtx,
    });
    const artifactWithDesign = withDesignDraftMetadata(artifact as JsonRecord, {
      skill,
      designDraft,
      designApproved,
    });
    const estimatedTokenCount = estimateTokens(task, JSON.stringify(artifact));
    const estimatedRunUsd = estimatedUsd(provider, estimatedTokenCount);
    await emitRunMetricsSafe({
      workspaceId: body.workspaceId,
      runSuccess: (artifact as JsonRecord)?.buildReport && typeof (artifact as JsonRecord).buildReport === "object"
        ? Boolean(((artifact as JsonRecord).buildReport as JsonRecord).success !== false)
        : true,
      estimatedCostUsd: estimatedRunUsd,
      estimatedTokens: estimatedTokenCount,
      provider,
      stage,
    });
    await persistArtifactMemory({
      request,
      workspaceId: body.workspaceId,
      phase,
      task,
      artifact: artifactWithDesign as JsonRecord,
    });
    return NextResponse.json({
      ok: true,
      source: "promotion-replay",
      phase,
      provider,
      requestedProvider: preferredProvider,
      providerLabel: providerStatus.label,
      useReasoning: false,
      ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
      selectedFiles: effectiveSelectedFiles,
      artifact: artifactWithDesign,
    });
  }

  if (fallbackUsed) {
    warningNotes.push(
      `${providerStatuses[preferredProvider as ProviderId]?.label ?? preferredProvider} is unavailable for this run. Falling back to ${providerStatus.label}.`
    );
  }
  if (!wholeRepoReviewMode && selectedFiles.length === 0 && inferredScopedFiles.length > 0) {
    warningNotes.push(`Auto-scoped to ${inferredScopedFiles.length} real file(s) for this UI task.`);
  }
  if (shouldSkipRepoSnapshot) {
    warningNotes.push("Fast scoped execution path active: skipped full repo snapshot for local execute run.");
  }
  // Whole-repo review mode: the plan steps are always the same (scan → inspect → rank → report).
  // Calling Gemini during the plan phase with a massive repo context takes 3-5+ minutes on
  // thinking-enabled models. Skip the AI plan and return buildLocalPlan immediately;
  // Gemini runs during the execute phase where it actually produces findings.
  const shouldUseFastLocalPlanForWholeRepoReview =
    phase === "plan" &&
    skill === "review-code" &&
    wholeRepoReviewMode &&
    !parseGitHubRepoUrl(repoUrl);
  const shouldUseFastLocalPlan =
    (shouldUseFastLocalPlanForWholeRepoReview) ||
    (phase === "plan" &&
    skill !== "review-code" &&
    !parseGitHubRepoUrl(repoUrl) &&
    hasFastScopedExecutionHint &&
    !effectiveReasoning);
  if (shouldUseFastLocalPlan) {
    const fastPlan = buildLocalPlan(skill, task, effectiveRepoUrl, branch) as JsonRecord;
    const existingPlan = fastPlan.plan && typeof fastPlan.plan === "object" ? (fastPlan.plan as JsonRecord) : {};
    const fastPlanArtifact = {
      ...fastPlan,
      plan: {
        ...existingPlan,
        summary: shouldUseFastLocalPlanForWholeRepoReview
          ? "Whole-repository review plan ready. Elyra will scan, analyse, and report findings."
          : "Fast scoped plan generated for a local execution run.",
        steps: Array.isArray(existingPlan.steps) ? existingPlan.steps : [],
      },
    };
    await appendCodeRunEventSafe({
      workspaceId: body.workspaceId,
      runId,
      eventType: "PLAN_WRITTEN",
      summary: "Fast scoped plan generated.",
      detail: hasFastScopedExecutionHint ? "Scoped local run does not require full repo planning." : undefined,
    });
    return NextResponse.json({
      ok: true,
      source: "fast-local-plan",
      phase,
      provider,
      requestedProvider: preferredProvider,
      providerLabel: providerStatus.label,
      useReasoning: effectiveReasoning,
      ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
      selectedFiles: effectiveSelectedFiles,
      artifact: fastPlanArtifact,
    });
  }

  const shouldPreferLocalScopedExecution =
    phase === "execute" &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    hasFastScopedExecutionHint;

  if (isWorkerBackboneMode() && !shouldPreferLocalScopedExecution) {
    try {
      const backboneBody = {
        intent: `Coding agent: ${task}`,
        context: {
          app: "code",
          skill,
          task: buildTaskWithExecutionDiscipline({
            task,
            longTermMemoryContext,
            skill,
            role: agentRole,
            selectedFiles: effectiveSelectedFiles,
          }),
          repoUrl,
          branch,
          phase,
          outputFormat: phase === "plan" ? "coding_plan_json" : "coding_result_json",
          systemPrompt: injectLongTermMemory(
            `${skillSystemPrompt(skill, task)}\n\n${buildExecutionDiscipline({
              task,
              ...(skill ? { skill } : {}),
              ...(agentRole ? { role: agentRole } : {}),
              ...(effectiveSelectedFiles.length > 0 ? { selectedFiles: effectiveSelectedFiles } : {}),
            })}`,
            longTermMemoryContext,
          ),
          agentRole,
          terminalAccess,
          provider,
          providerLabel: providerStatus.label,
          model: providerStatus.model,
          reasoning: effectiveReasoning,
          toolAllowlist: TOOL_ALLOWLIST.map((t) => t.cmd),
          safetyPolicy: { networkDisabled: true, noAutoMerge: true, maxIterations: 3 },
          suggestionsOnly,
          repoSnapshot: (ANALYSIS_ONLY_SKILLS.has(skill) || (skill === "review-code" && suggestionsOnly)) ? effectiveRepoSnapshot : undefined,
          selectedFiles: effectiveSelectedFiles,
          attachments: attachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes ?? Buffer.byteLength(attachment.dataBase64, "base64"),
              })),
          ...(longTermMemoryContext ? { longTermMemoryContext } : {}),
        },
        workspaceId: body.workspaceId,
      };

      const payload = await forwardToWorkerOs({
        path: "/v1/os/code/run",
        method: "POST",
        cookieHeader: resolveWorkerCookieHeader(request),
        authorizationHeader: resolveWorkerAuthorizationHeader(request),
        body: backboneBody,
      });

      const artifact =
        phase === "plan"
          ? normalizePlanArtifact(payload, { skill, task, repoUrl: effectiveRepoUrl, branch })
          : await finalizeExecutionArtifact(
              normalizeResultArtifact(payload, { skill, task, repoUrl: effectiveRepoUrl, suggestionsOnly, repoSnapshot: effectiveRepoSnapshot }),
              {
                phase,
                repoUrl: codeRepoUrl,
                skill,
                suggestionsOnly,
                selectedFiles: effectiveSelectedFiles,
                autoCommit: githubCloneCtx ? false : autoCommit,
                branchPerAgent,
                agentBranchName,
                stage,
                task,
                strictAi,
                provider,
                budgetUsd,
                deadlineMinutes,
                providedDiff,
                githubCloneCtx,
              },
            );
      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: artifact as JsonRecord,
      });
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: phase === "plan" ? "PLAN_WRITTEN" : "RUN_SUCCEEDED",
        summary: phase === "plan" ? "Plan written." : "Backbone execution completed.",
        detail:
          phase === "plan"
            ? "Execution plan is ready for review."
            : typeof (artifact as JsonRecord).summary === "string"
              ? String((artifact as JsonRecord).summary)
              : "Execution finished successfully.",
      });

      return NextResponse.json({
        ok: true,
        source: "worker-backbone",
        phase,
        ...(autonomous ? { autonomous: true } : {}),
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact,
      });
    } catch (error) {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Backbone execution failed.",
        detail: error instanceof Error ? error.message : "Worker backbone unavailable.",
      });
      if (error instanceof WorkerProxyError) {
        return NextResponse.json(
          error.payload ?? {
            ok: false,
            code: "BACKBONE_UNAVAILABLE",
            error: "Worker backbone unavailable. Local fallback execution is disabled in SSOT mode.",
          },
          { status: error.status },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: "BACKBONE_UNAVAILABLE",
          error: "Worker backbone unavailable. Local fallback execution is disabled in SSOT mode.",
        },
        { status: 503 },
      );
    }
  }

  const canUseDirectFileEdits =
    phase === "execute" &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    effectiveSelectedFiles.length > 0 &&
    effectiveSelectedFiles.length <= 12 &&
    skill !== "review-code";

  const canUseLocalAgentExecution =
    phase === "execute" &&
    terminalAccess &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    !attachments.some((attachment) => attachment.mimeType.startsWith("image/")) &&
    (effectiveSelectedFiles.length === 0 || effectiveSelectedFiles.length <= 12);

  const canUseGeminiCliScopedEdit =
    phase === "execute" &&
    provider === "gemini_cli" &&
    providerStatus.configured &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    stage === "playground" &&
    effectiveSelectedFiles.length > 0 &&
    effectiveSelectedFiles.length <= 6 &&
    skill !== "review-code";

  const shouldPreferDirectFileEdits =
    canUseDirectFileEdits &&
    !terminalAccess &&
    (
      effectiveSelectedFiles.length > 0 ||
      folderPath.trim().length > 0
    );

  const shouldUseGeminiCliExecutePath =
    phase === "execute" &&
    provider === "gemini_cli" &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    !canUseLocalAgentExecution &&
    !shouldPreferDirectFileEdits;

  const shouldRequireAgenticLocalExecution =
    phase === "execute" &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    (terminalAccess || provider === "gemini_cli");

  if (canUseGeminiCliScopedEdit) {
    try {
      const geminiCliExecution = await executeGeminiCliScopedEdit({
        repoUrl,
        selectedFiles: effectiveSelectedFiles,
        autoCommit,
        branchPerAgent,
        agentBranchName,
        baseBranch: branch,
        stage,
        task,
        longTermMemoryContext,
        skill,
        role: agentRole,
        workspaceId: body.workspaceId,
        runId,
      });
      if (geminiCliExecution) {
        const geminiCliArtifact = withDesignDraftMetadata(
          {
            status: geminiCliExecution.applied ? "completed" : "failed",
            skill,
            task,
            summary: geminiCliExecution.applied
              ? "Gemini CLI scoped edits were applied and verified locally."
              : geminiCliExecution.applyOutput,
            filesChanged: (geminiCliExecution.appliedFiles ?? []).map((filePath) => ({
              path: filePath,
              linesAdded: 0,
              linesRemoved: 0,
            })),
            diff: geminiCliExecution.appliedDiff ?? "",
            testReport: geminiCliExecution.testReport,
            buildReport: geminiCliExecution.buildReport,
            requiresApproval: false,
            approvalActions: [],
            executionApplied: geminiCliExecution.applied,
            executionLog: geminiCliExecution.executionLog,
            ...(geminiCliExecution.workflow ? { workflow: geminiCliExecution.workflow } : {}),
            ...(geminiCliExecution.previewUrl ? { previewUrl: geminiCliExecution.previewUrl } : {}),
            ...(geminiCliExecution.commitOutput ? { commitOutput: geminiCliExecution.commitOutput } : {}),
            ...(geminiCliExecution.gates ? { gates: geminiCliExecution.gates } : {}),
            telemetry: {
              provider,
              model: providerStatus.model,
              fallbackUsed,
              replayId: createHash("sha256").update(`gemini-cli-edit:${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
            },
          } as JsonRecord,
          {
            skill,
            designDraft,
            designApproved,
          },
        );
        await persistArtifactMemory({
          request,
          workspaceId: body.workspaceId,
          phase,
          task,
          artifact: geminiCliArtifact as JsonRecord,
        });

        return NextResponse.json({
          ok: true,
          source: "gemini-cli-edit",
          phase,
          ...(autonomous ? { autonomous: true } : {}),
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
          useReasoning: effectiveReasoning,
          ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
          selectedFiles: effectiveSelectedFiles,
          artifact: geminiCliArtifact,
        });
      }
    } catch (error) {
      const failure = buildProviderRuntimeFailure({
        error,
        fallbackMessage: `Gemini CLI scoped edit failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      if (canUseLocalAgentExecution || shouldPreferDirectFileEdits) {
        warningNotes.push(`${failure.error} Falling back to another local editing executor.`);
      } else {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Gemini CLI scoped edit executor failed.",
        detail: failure.error,
      });
      return NextResponse.json(
        {
          ok: false,
          code: failure.code,
          error: failure.error,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
        },
        { status: failure.status },
      );
      }
    }
  }

  if (
    shouldRequireAgenticLocalExecution &&
    !canUseGeminiCliScopedEdit &&
    !canUseLocalAgentExecution &&
    !shouldPreferDirectFileEdits
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "AGENTIC_EXECUTION_SCOPE_REQUIRED",
        error:
          "This execute run needs a real editing executor, but no safe execution scope is available yet.",
        details: [
          terminalAccess
            ? "Enable a concrete file scope or folder scope so the local coding agent can make bounded edits."
            : "Enable terminal mode or select 1-12 target files so Elyra can use a real editing executor.",
          "Elyra no longer falls back to JSON-only patch proposals for local execute runs.",
        ],
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        selectedFiles: effectiveSelectedFiles,
      },
      { status: 412 },
    );
  }

  if (shouldUseGeminiCliExecutePath) {
    try {
      await ensureGeminiCliAuthReady();
    } catch (error) {
      const failure = buildProviderRuntimeFailure({
        error,
        fallbackMessage: `Gemini CLI execute preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Gemini CLI execute preflight failed.",
        detail: failure.error,
      });
      return NextResponse.json(
        {
          ok: false,
          code: failure.code,
          error: failure.error,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
          selectedFiles: effectiveSelectedFiles,
        },
        { status: failure.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "GEMINI_CLI_SCOPED_EDIT_REQUIRED",
        error:
          "Gemini CLI execute currently supports only review runs or tightly scoped playground edits with up to 6 target files. Narrow the scope and retry.",
        details: [
          "Use Generate Plan or Review Code for broad analysis tasks.",
          "For edits, select 1 to 6 concrete target files in playground.",
        ],
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        selectedFiles: effectiveSelectedFiles,
      },
      { status: 412 },
    );
  }

  if (shouldPreferDirectFileEdits && providerStatus.configured) {
      const directExecution = await applyDirectEditsAndVerify({
        repoUrl,
        selectedFiles: effectiveSelectedFiles,
        autoCommit,
        branchPerAgent,
        agentBranchName,
        stage,
        task,
        longTermMemoryContext,
        attachments,
        provider,
        budgetUsd,
        deadlineMinutes,
      skill,
      role: agentRole,
      workspaceId: body.workspaceId,
      runId,
    });
    if (directExecution) {
      const directArtifact = withDesignDraftMetadata(
        {
          status: directExecution.applied ? "completed" : "failed",
          skill,
          task,
          summary: directExecution.applied
            ? "Direct file edits were applied and verified locally."
            : directExecution.applyOutput,
          filesChanged: (directExecution.appliedFiles ?? []).map((filePath) => ({
            path: filePath,
            linesAdded: 0,
            linesRemoved: 0,
          })),
          diff: directExecution.appliedDiff ?? "",
          testReport: directExecution.testReport,
          buildReport: directExecution.buildReport,
          requiresApproval: false,
          approvalActions: [],
          executionApplied: directExecution.applied,
          executionLog: directExecution.executionLog,
          ...(directExecution.previewUrl ? { previewUrl: directExecution.previewUrl } : {}),
          ...(directExecution.commitOutput ? { commitOutput: directExecution.commitOutput } : {}),
          ...(directExecution.gates ? { gates: directExecution.gates } : {}),
          telemetry: {
            provider,
            model: providerStatus.model,
            fallbackUsed,
            replayId: createHash("sha256").update(`direct:${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
          },
        } as JsonRecord,
        {
          skill,
          designDraft,
          designApproved,
        }
      );
      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: directArtifact as JsonRecord,
      });

      return NextResponse.json({
        ok: true,
        source: "direct-edit",
        phase,
        ...(autonomous ? { autonomous: true } : {}),
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact: directArtifact,
      });
    }
  }

  if (canUseLocalAgentExecution) {
    try {
      const localAgentExecution = await executeViaLocalAgent({
        repoUrl,
        selectedFiles: effectiveSelectedFiles,
        longTermMemoryContext,
        autoCommit,
        branchPerAgent,
        agentBranchName,
        baseBranch: branch,
        stage,
        task,
        skill,
        role: agentRole,
        workspaceId: body.workspaceId,
        runId,
      });
      if (localAgentExecution) {
        const localAgentArtifact = withDesignDraftMetadata(
          {
            status: localAgentExecution.applied ? "completed" : "failed",
            skill,
            task,
            summary: localAgentExecution.applyOutput,
            filesChanged: (localAgentExecution.appliedFiles ?? []).map((filePath) => ({
              path: filePath,
              linesAdded: 0,
              linesRemoved: 0,
            })),
            diff: localAgentExecution.appliedDiff ?? "",
            testReport: localAgentExecution.testReport,
            buildReport: localAgentExecution.buildReport,
          requiresApproval: false,
          approvalActions: [],
          executionApplied: localAgentExecution.applied,
          executionLog: localAgentExecution.executionLog,
          ...(localAgentExecution.workflow ? { workflow: localAgentExecution.workflow } : {}),
          ...(localAgentExecution.previewUrl ? { previewUrl: localAgentExecution.previewUrl } : {}),
            ...(localAgentExecution.commitOutput ? { commitOutput: localAgentExecution.commitOutput } : {}),
            ...(localAgentExecution.gates ? { gates: localAgentExecution.gates } : {}),
            telemetry: {
              provider,
              model: providerStatus.model,
              fallbackUsed,
              replayId: createHash("sha256").update(`local-agent:${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
            },
          } as JsonRecord,
          {
            skill,
            designDraft,
            designApproved,
          }
        );
        await persistArtifactMemory({
          request,
          workspaceId: body.workspaceId,
          phase,
          task,
          artifact: localAgentArtifact as JsonRecord,
        });

        return NextResponse.json({
          ok: true,
          source: "local-agent",
          phase,
          ...(autonomous ? { autonomous: true } : {}),
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
          useReasoning: effectiveReasoning,
          ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
          selectedFiles: effectiveSelectedFiles,
          artifact: localAgentArtifact,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Terminal-enabled execution failed.",
        detail: message,
      });
      if (!shouldPreferDirectFileEdits) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCAL_AGENT_UNAVAILABLE",
            error: `Terminal-enabled execution failed: ${message}`,
            details: [
              "The local agent path is required when terminal access is enabled.",
              "Verify worker build output exists and 127.0.0.1:5050 is reachable.",
            ],
          },
          { status: 503 }
        );
      }
      warningNotes.push(`Local terminal agent failed (${message}). Falling back to direct file edits.`);
    }
  }

  if (canUseDirectFileEdits && providerStatus.configured) {
    const directExecution = await applyDirectEditsAndVerify({
      repoUrl,
      selectedFiles: effectiveSelectedFiles,
      autoCommit,
      branchPerAgent,
      agentBranchName,
      stage,
      task,
      longTermMemoryContext,
      provider,
      budgetUsd,
      deadlineMinutes,
      skill,
      role: agentRole,
      workspaceId: body.workspaceId,
      runId,
    });
    if (directExecution) {
      const directArtifact = withDesignDraftMetadata(
        {
          status: directExecution.applied ? "completed" : "failed",
          skill,
          task,
          summary: directExecution.applied
            ? "Direct file edits were applied and verified locally."
            : directExecution.applyOutput,
          filesChanged: (directExecution.appliedFiles ?? []).map((filePath) => ({
            path: filePath,
            linesAdded: 0,
            linesRemoved: 0,
          })),
          diff: directExecution.appliedDiff ?? "",
          testReport: directExecution.testReport,
          buildReport: directExecution.buildReport,
          requiresApproval: false,
          approvalActions: [],
          executionApplied: directExecution.applied,
          executionLog: directExecution.executionLog,
          ...(directExecution.workflow ? { workflow: directExecution.workflow } : {}),
          ...(directExecution.previewUrl ? { previewUrl: directExecution.previewUrl } : {}),
          ...(directExecution.commitOutput ? { commitOutput: directExecution.commitOutput } : {}),
          ...(directExecution.gates ? { gates: directExecution.gates } : {}),
          telemetry: {
            provider,
            model: providerStatus.model,
            fallbackUsed,
            replayId: createHash("sha256").update(`direct:${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
          },
        } as JsonRecord,
        {
          skill,
          designDraft,
          designApproved,
        }
      );
      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: directArtifact as JsonRecord,
      });

      return NextResponse.json({
        ok: true,
        source: "direct-file-edit",
        phase,
        ...(autonomous ? { autonomous: true } : {}),
        provider,
        requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact: directArtifact,
      });
    }
  }

  if (providerStatus.configured && !shouldRequireAgenticLocalExecution) {
    try {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "TOOL_STARTED",
        summary: phase === "plan"
          ? `Generating plan with ${providerStatus.label}…`
          : `Analysing codebase with ${providerStatus.label}…`,
        detail: phase === "plan"
          ? `Skill: ${skill} | Files: ${effectiveSelectedFiles.length > 0 ? effectiveSelectedFiles.slice(0, 4).join(", ") : "whole repository"}`
          : `Task: ${task.slice(0, 120)}`,
      });
      const rawArtifact =
        phase === "plan"
          ? await buildGeminiPlan({
              provider,
              skill,
              task,
              repoUrl: effectiveRepoUrl,
              branch,
              agentRole,
              terminalAccess,
              longTermMemoryContext,
              suggestionsOnly,
              repoSnapshot: effectiveRepoSnapshot,
              attachments,
              selectedFiles: effectiveSelectedFiles,
              allowProviderFailover: !explicitProviderRequested,
            })
          : await buildGeminiResult({
              provider,
              skill,
              task,
              repoUrl: effectiveRepoUrl,
              branch,
              agentRole,
              terminalAccess,
              longTermMemoryContext,
              suggestionsOnly,
              repoSnapshot: effectiveRepoSnapshot,
              attachments,
              selectedFiles: effectiveSelectedFiles,
              allowProviderFailover: !explicitProviderRequested,
            });
      const artifact = await finalizeExecutionArtifact(rawArtifact, {
        phase,
        repoUrl: codeRepoUrl,
        skill,
        suggestionsOnly,
        selectedFiles: effectiveSelectedFiles,
        autoCommit: githubCloneCtx ? false : autoCommit,
        branchPerAgent,
        agentBranchName,
        stage,
        task,
        strictAi,
        provider,
        budgetUsd,
        deadlineMinutes,
        providedDiff,
        githubCloneCtx,
      });

      // Emit trace event so the UI shows what the AI produced.
      const planStepCount = phase === "plan"
        ? (Array.isArray((rawArtifact as JsonRecord)?.plan && typeof (rawArtifact as JsonRecord).plan === "object"
            ? ((rawArtifact as JsonRecord).plan as JsonRecord)?.steps : null)
            ? ((((rawArtifact as JsonRecord).plan as JsonRecord)?.steps) as unknown[]).length
            : 0)
        : 0;
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "TOOL_COMPLETED",
        summary: phase === "plan"
          ? `Plan ready: ${planStepCount} step${planStepCount !== 1 ? "s" : ""}.`
          : `${providerStatus.label} analysis complete.`,
        detail: phase === "plan" && planStepCount > 0
          ? `Steps: ${(((rawArtifact as JsonRecord).plan as JsonRecord)?.steps as {title?: string}[])?.slice(0, 4).map((s) => s?.title ?? "").filter(Boolean).join(" → ")}`
          : undefined,
      });
      const estimatedTokenCount = estimateTokens(task, JSON.stringify(artifact));
      const estimatedRunUsd = estimatedUsd(provider, estimatedTokenCount);
      if (budgetUsd && estimatedRunUsd > budgetUsd) {
        warningNotes.push(`Cost budget exceeded: ~$${estimatedRunUsd.toFixed(4)} spent vs $${budgetUsd.toFixed(4)} limit.`);
      }
      await emitRunMetricsSafe({
        workspaceId: body.workspaceId,
        runSuccess: (artifact as JsonRecord)?.buildReport && typeof (artifact as JsonRecord).buildReport === "object"
          ? Boolean(((artifact as JsonRecord).buildReport as JsonRecord).success !== false)
          : true,
        estimatedCostUsd: estimatedRunUsd,
        estimatedTokens: estimatedTokenCount,
        provider,
        stage,
      });
      const enrichedArtifact = withDesignDraftMetadata(
        {
          ...artifact,
          missionBrief: {
            objective: task,
            stage,
            budgetUsd: budgetUsd ?? null,
            deadlineMinutes: deadlineMinutes ?? null,
            supervisorPlan,
            compliance: {
              requiresHumanApproval: compliance.requiresHumanApproval,
              issues: compliance.issues,
            },
          },
          telemetry: {
            provider,
            model: providerStatus.model,
            estimatedTokens: estimatedTokenCount,
            estimatedInputTokens: runBudgetProfile.estimatedInputTokens,
            modelInputLimit: runBudgetProfile.modelInputLimit,
            contextCompressionMode: runBudgetProfile.contextCompressionMode,
            // Cost-budget status takes priority over context-window budget status.
            budgetStatus: budgetUsd
              ? estimatedRunUsd > budgetUsd
                ? "over"
                : estimatedRunUsd > budgetUsd * 0.8
                  ? "warning"
                  : "ok"
              : runBudgetProfile.budgetStatus,
            estimatedCostUsd: estimatedRunUsd,
            fallbackUsed,
            replayId: createHash("sha256").update(`${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
          },
          artifacts:
            /pitch|deck|business plan|company/i.test(task)
              ? [
                  {
                    id: `artifact-${Date.now()}-deck`,
                    type: "pitch_deck",
                    title: "Pitch Deck Draft",
                    version: 1,
                    provenance: { provider, agentRole, createdAt: nowIso(), source: "code-run" },
                  },
                  {
                    id: `artifact-${Date.now()}-plan`,
                    type: "business_plan",
                    title: "Business Plan Draft",
                    version: 1,
                    provenance: { provider, agentRole, createdAt: nowIso(), source: "code-run" },
                  },
                ]
              : [],
        } as JsonRecord,
        {
          skill,
          designDraft,
          designApproved,
        }
      );
      await persistArtifactMemory({
        request,
        workspaceId: body.workspaceId,
        phase,
        task,
        artifact: enrichedArtifact as JsonRecord,
      });

      // PR push + cleanup is handled inside finalizeExecutionArtifact.
      // Read results from the artifact to include in the response.
      const ghPrUrl = typeof (enrichedArtifact as JsonRecord)?.prUrl === "string"
        ? (enrichedArtifact as JsonRecord).prUrl as string : null;
      const ghCompareUrl = typeof (enrichedArtifact as JsonRecord)?.compareUrl === "string"
        ? (enrichedArtifact as JsonRecord).compareUrl as string : null;
      const ghBranchName = typeof (enrichedArtifact as JsonRecord)?.branchName === "string"
        ? (enrichedArtifact as JsonRecord).branchName as string : null;
      const ghPrWarning = typeof (enrichedArtifact as JsonRecord)?.prWarning === "string"
        ? (enrichedArtifact as JsonRecord).prWarning as string : null;
      if (ghPrWarning) warningNotes.push(ghPrWarning);

    return NextResponse.json({
      ok: true,
      source: provider,
      phase,
      ...(autonomous ? { autonomous: true } : {}),
      provider,
      requestedProvider: preferredProvider,
        providerLabel: providerStatus.label,
        useReasoning: effectiveReasoning,
        ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
        selectedFiles: effectiveSelectedFiles,
        artifact: enrichedArtifact,
        ...(ghPrUrl ? { prUrl: ghPrUrl } : {}),
        ...(ghCompareUrl ? { compareUrl: ghCompareUrl } : {}),
        ...(ghBranchName ? { branchName: ghBranchName } : {}),
    });
    } catch (error) {
      modelGenerationError = error instanceof Error ? error.message : String(error);
      console.error("[api/os/code/run] model generation failed", {
        phase,
        provider,
        message: modelGenerationError,
      });
      warningNotes.push(
        `${providerStatus.label} generation failed (${modelGenerationError}). Continuing with worker/backbone AI execution.`
      );
      if (explicitProviderRequested) {
        return NextResponse.json(
          {
            ok: false,
            code: "PROVIDER_EXECUTION_FAILED",
            error: `${providerStatus.label} failed during execution.`,
            details: [modelGenerationError],
            provider,
            requestedProvider: preferredProvider,
          },
          { status: 503 }
        );
      }
    }
  }

  if (providerStatus.configured && shouldRequireAgenticLocalExecution) {
    warningNotes.push(
      `${providerStatus.label} JSON result generation was skipped for this local execute run. Elyra requires a real editing executor for code changes.`
    );
  }

  try {
    const backboneBody = {
      intent: `Coding agent: ${task}`,
      context: {
        app: "code",
        skill,
        task,
        repoUrl,
        branch,
        phase,
        outputFormat: phase === "plan" ? "coding_plan_json" : "coding_result_json",
        systemPrompt: skillSystemPrompt(skill, task),
        agentRole,
        terminalAccess,
        provider,
        providerLabel: providerStatus.label,
        model: providerStatus.model,
        reasoning: effectiveReasoning,
        toolAllowlist: TOOL_ALLOWLIST.map((t) => t.cmd),
        safetyPolicy: { networkDisabled: true, noAutoMerge: true, maxIterations: 3 },
        suggestionsOnly,
        repoSnapshot: skill === "review-code" && suggestionsOnly ? effectiveRepoSnapshot : undefined,
        selectedFiles: effectiveSelectedFiles,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes ?? Buffer.byteLength(attachment.dataBase64, "base64"),
        })),
      },
      workspaceId: body.workspaceId,
    };

    const payload = await forwardToWorkerOs({
      path: "/v1/os/code/run",
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
      body: backboneBody,
    });

    const artifact =
      phase === "plan"
        ? normalizePlanArtifact(payload, { skill, task, repoUrl: effectiveRepoUrl, branch })
        : await finalizeExecutionArtifact(
            normalizeResultArtifact(payload, { skill, task, repoUrl: effectiveRepoUrl, suggestionsOnly, repoSnapshot: effectiveRepoSnapshot }),
            {
              phase,
              repoUrl: codeRepoUrl,
              skill,
              suggestionsOnly,
              selectedFiles: effectiveSelectedFiles,
              autoCommit: githubCloneCtx ? false : autoCommit,
              branchPerAgent,
              agentBranchName,
              stage,
              task,
              strictAi,
              provider,
              budgetUsd,
              deadlineMinutes,
              providedDiff,
              githubCloneCtx,
            },
          );

    const estimatedTokenCount = estimateTokens(task, JSON.stringify(artifact));
    const estimatedRunUsd = estimatedUsd(provider, estimatedTokenCount);
    await emitRunMetricsSafe({
      workspaceId: body.workspaceId,
      runSuccess: (artifact as JsonRecord)?.buildReport && typeof (artifact as JsonRecord).buildReport === "object"
        ? Boolean(((artifact as JsonRecord).buildReport as JsonRecord).success !== false)
        : true,
      estimatedCostUsd: estimatedRunUsd,
      estimatedTokens: estimatedTokenCount,
      provider,
      stage,
    });
    const enrichedArtifact = withDesignDraftMetadata(
      {
        ...artifact,
        missionBrief: {
          objective: task,
          stage,
          budgetUsd: budgetUsd ?? null,
          deadlineMinutes: deadlineMinutes ?? null,
          supervisorPlan,
          compliance: {
            requiresHumanApproval: compliance.requiresHumanApproval,
            issues: compliance.issues,
          },
        },
        telemetry: {
          provider,
          model: providerStatus.model,
          estimatedTokens: estimatedTokenCount,
          estimatedInputTokens: runBudgetProfile.estimatedInputTokens,
          modelInputLimit: runBudgetProfile.modelInputLimit,
          contextCompressionMode: runBudgetProfile.contextCompressionMode,
          budgetStatus: runBudgetProfile.budgetStatus,
          estimatedCostUsd: estimatedRunUsd,
          fallbackUsed,
          replayId: createHash("sha256").update(`${provider}:${task}:${branch}`).digest("hex").slice(0, 16),
        },
      } as JsonRecord,
      {
        skill,
        designDraft,
        designApproved,
      }
    );
    await persistArtifactMemory({
      request,
      workspaceId: body.workspaceId,
      phase,
      task,
      artifact: enrichedArtifact as JsonRecord,
    });
    return NextResponse.json({
      ok: true,
      source: "ai",
      phase,
      provider,
      requestedProvider: preferredProvider,
      providerLabel: providerStatus.label,
      useReasoning: effectiveReasoning,
      ...(warningNotes.length > 0 ? { warning: warningNotes.join(" ") } : {}),
      selectedFiles: effectiveSelectedFiles,
      artifact: enrichedArtifact,
      raw: payload,
    });
  } catch (error) {
    // Local fallback — only use when we can produce a meaningful deterministic output.
    const localUiColorFallback =
      phase === "execute" && skill !== "review-code"
        ? await buildLocalUiColorFallbackResult({
            task,
            repoUrl: effectiveRepoUrl,
            selectedFiles: effectiveSelectedFiles,
          })
        : null;
    const warningDetail =
      error instanceof WorkerProxyError
        ? error.payload && typeof error.payload === "object" && typeof (error.payload as Record<string, unknown>).message === "string"
          ? String((error.payload as Record<string, unknown>).message)
          : error.message
        : error instanceof Error
          ? error.message
          : "Unknown execution error.";

    if (phase === "execute" && localUiColorFallback == null) {
      const failure = buildProviderRuntimeFailure({
        error,
        fallbackMessage: `Execution aborted: model/backbone unavailable and no safe deterministic fallback exists. Cause: ${modelGenerationError ?? warningDetail}`,
      });
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Execution aborted.",
        detail: failure.error,
      });
      return NextResponse.json(
        {
          ok: false,
          code: failure.code,
          error: failure.error,
          phase,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
          selectedFiles: effectiveSelectedFiles,
        },
        { status: failure.status }
      );
    }

    const artifact = phase === "plan"
      ? buildLocalPlan(skill, task, effectiveRepoUrl, branch)
      : await finalizeExecutionArtifact(localUiColorFallback ?? buildLocalResult(skill, task, effectiveRepoUrl), {
            phase,
            repoUrl: codeRepoUrl,
            skill,
            suggestionsOnly,
            selectedFiles: effectiveSelectedFiles,
            autoCommit: githubCloneCtx ? false : autoCommit,
            branchPerAgent,
            agentBranchName,
            stage,
            task,
            strictAi,
            provider,
            budgetUsd,
            deadlineMinutes,
            providedDiff,
            githubCloneCtx,
          });

    if (strictAi) {
      await appendCodeRunEventSafe({
        workspaceId: body.workspaceId,
        runId,
        eventType: "RUN_FAILED",
        summary: "Strict AI mode blocked fallback execution.",
        detail: modelGenerationError ? `Provider failure: ${modelGenerationError}` : warningDetail,
      });
      return NextResponse.json(
        {
          ok: false,
          code: "STRICT_AI_BACKBONE_UNAVAILABLE",
          error: `Strict AI mode: worker/backbone unavailable.${modelGenerationError ? ` Provider failure: ${modelGenerationError}` : ` ${warningDetail}`}`,
          phase,
          provider,
          requestedProvider: preferredProvider,
          providerLabel: providerStatus.label,
        },
        { status: 503 }
      );
    }

    const estimatedTokenCount = estimateTokens(task, JSON.stringify(artifact));
    const estimatedRunUsd = estimatedUsd(provider, estimatedTokenCount);
    await emitRunMetricsSafe({
      workspaceId: body.workspaceId,
      runSuccess: (artifact as JsonRecord)?.buildReport && typeof (artifact as JsonRecord).buildReport === "object"
        ? Boolean(((artifact as JsonRecord).buildReport as JsonRecord).success !== false)
        : true,
      estimatedCostUsd: estimatedRunUsd,
      estimatedTokens: estimatedTokenCount,
      provider: "fallback",
      stage,
    });
    const enrichedArtifact = withDesignDraftMetadata(
      {
        ...artifact,
        missionBrief: {
          objective: task,
          stage,
          budgetUsd: budgetUsd ?? null,
          deadlineMinutes: deadlineMinutes ?? null,
          supervisorPlan,
          compliance: {
            requiresHumanApproval: compliance.requiresHumanApproval,
            issues: compliance.issues,
          },
        },
        telemetry: {
          provider: "fallback",
          model: "local-template",
          estimatedTokens: estimatedTokenCount,
          estimatedInputTokens: runBudgetProfile.estimatedInputTokens,
          modelInputLimit: runBudgetProfile.modelInputLimit,
          contextCompressionMode: runBudgetProfile.contextCompressionMode,
          budgetStatus: runBudgetProfile.budgetStatus,
          estimatedCostUsd: estimatedRunUsd,
          fallbackUsed: true,
          replayId: createHash("sha256").update(`fallback:${task}:${branch}`).digest("hex").slice(0, 16),
        },
      } as JsonRecord,
      {
        skill,
        designDraft,
        designApproved,
      }
    );
    await appendCodeRunEventSafe({
      workspaceId: body.workspaceId,
      runId,
      eventType: phase === "plan" ? "PLAN_WRITTEN" : "RUN_SUCCEEDED",
      summary: phase === "plan" ? "Fallback plan written." : "Fallback execution completed.",
      detail:
        typeof (enrichedArtifact as JsonRecord).summary === "string"
          ? String((enrichedArtifact as JsonRecord).summary)
          : "Local fallback finished.",
    });
    return NextResponse.json({
      ok: true,
      source: "local",
      phase,
      provider,
      requestedProvider: preferredProvider,
      providerLabel: "Local template",
      useReasoning: false,
      warning:
        `Worker backbone unavailable for this run. Fell back to local execution. Cause: ${warningDetail}`,
      selectedFiles: effectiveSelectedFiles,
      artifact: enrichedArtifact,
    });
  }
  } finally {
    // Idempotent cleanup — ensures /tmp clone is removed regardless of exit path.
    if (githubCloneCtx) {
      await cleanupGitHubClone(githubCloneCtx.tmpDir).catch(() => {});
    }
  }
}
