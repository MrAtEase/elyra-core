/**
 * Coding agent – Tool allowlist, limits and constants.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { CodingSkill } from "@/types/taskContract";
import type { ToolAllowlistEntry } from "@/lib/code-agent/types";

// ── Tool allowlist (safety: only these commands may run in sandbox) ────────────

export const TOOL_ALLOWLIST: ToolAllowlistEntry[] = [
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
export const ANALYSIS_ONLY_SKILLS = new Set<CodingSkill>([
  "security-scan",
  "db-review",
  "perf-audit",
  "api-design",
  "code-explain",
]);

export const REPO_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
]);
export const REPO_SCAN_TEXT_EXTENSIONS = new Set([
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
export const PLAYGROUND_PREVIEW_PORT = 3100;
export const PLAYGROUND_PID_FILE = ".elyra-playground.pid";
export const MAX_REPO_FILES = 160;
export const MAX_REPO_SCAN_FILES = 4000;
export const MAX_REPO_SAMPLES = 18;
export const MAX_REPO_EXCERPT_CHARS = 1200;
export const MAX_LOCAL_REPOS = 24;
export const MAX_FOLDER_OPTIONS = 40;
export const MAX_FOLDER_SCAN_DEPTH = 2;
export const COMMAND_TIMEOUT_MS = 120_000;
export const BUILD_GATE_TIMEOUT_MS = 420_000;
export const TEST_GATE_TIMEOUT_MS = 180_000;
export const TYPECHECK_GATE_TIMEOUT_MS = 180_000;
export const GEMINI_TIMEOUT_MS = 240_000; // 4 min — OpenAI/Gemini 2.5 Flash need ~3 min for large diffs
export const RETRY_BUDGET_PER_GATE = 1;
export const HARD_GATES = [
  "lint",
  "typecheck",
  "tests",
  "build",
  "perf",
  "a11y",
  "visual",
] as const;

export const EPHEMERAL_EXECUTION_CHANGE_PREFIXES = [
  ".next/",
  "node_modules/",
  ".aider/",
  ".elyra/",
  ".gemini/",
  ".run/",
  ".tools/",
];
export const EPHEMERAL_EXECUTION_CHANGES = new Set([
  "next-env.d.ts",
]);
export type HardGate = (typeof HARD_GATES)[number];
