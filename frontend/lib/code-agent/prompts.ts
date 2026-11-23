/**
 * Coding agent – Skill/role prompts, long-term memory, execution discipline and provider heuristics.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole } from "@/types/agent";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import { forwardToWorkerOs } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import type { CodeProviderStatusMap, JsonRecord, RunAttachment, WorkspaceBrainProfile, WorkspaceMemoryEntry } from "@/lib/code-agent/types";
import { looksLikeRepoReviewOnlyTask } from "@/lib/code-agent/repo";

// ── Skill → system-prompt hints ────────────────────────────────────────────────

export function skillSystemPrompt(skill: CodingSkill, task: string): string {
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

export function agentRolePrompt(role: AgentRole, terminalAccess: boolean): string {
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

export async function loadWorkspaceBrainProfile(workspaceId?: string): Promise<WorkspaceBrainProfile | null> {
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

export async function loadWorkspaceMemories(input: {
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

export function buildLongTermMemoryContext(input: {
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

export function injectLongTermMemory(systemOrPrompt: string, longTermMemoryContext?: string): string {
  if (!longTermMemoryContext?.trim()) return systemOrPrompt;
  return `${systemOrPrompt}\n\nLong-term workspace memory:\n${longTermMemoryContext.trim()}\nUse this to prioritize, preserve intent, and stay aligned with workspace goals.`;
}

function taskWithLongTermMemory(task: string, longTermMemoryContext?: string): string {
  if (!longTermMemoryContext?.trim()) return task;
  return `${task}\n\nWorkspace long-term memory:\n${longTermMemoryContext.trim()}`;
}

export function isUiOrLayoutTask(task: string, skill?: CodingSkill, role?: AgentRole): boolean {
  if (skill === "ux-ui-design" || role === "ui" || role === "frontend") return true;
  return /ui|ux|layout|spacing|padding|margin|overlap|overlay|viewport|window|fenster|intent line|intentline|css|responsive|visual|design/i.test(task);
}

export function buildExecutionDiscipline(input: {
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

export function buildTaskWithExecutionDiscipline(input: {
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

export function buildAttachmentPromptContext(attachments?: RunAttachment[]): string[] {
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

export function buildExecutionTraceIntro(input: {
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

export async function persistArtifactMemory(input: {
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

export function suggestedProviderForRole(role: AgentRole): ProviderId {
  if (role === "frontend" || role === "ui") return "gemini_cli";
  return "gemini";
}

export function looksLikeBroadAnalysisTask(task: string): boolean {
  const lower = task.toLowerCase();
  const analysisIntent =
    /(scan|scanne|audit|review|analys|analyse|inspect|find|list|nenne|top\s*\d+|probleme|issues|risks|root cause|ursache)/.test(
      lower,
    );
  const repoTarget =
    /(repo|repository|project|projekt|codebase|gesamte|entire|whole|app|service|integration)/.test(lower);
  return analysisIntent && repoTarget;
}

export function looksLikeWholeRepoReviewTask(task: string): boolean {
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
export function bestClaudeProvider(statuses: CodeProviderStatusMap): ProviderId | null {
  if (statuses.claude_direct?.configured) return "claude_direct";
  if (statuses.claude_vertex?.configured) return "claude_vertex";
  return null;
}

function bestGeminiProvider(statuses: CodeProviderStatusMap): ProviderId | null {
  if (statuses.gemini_cli?.configured) return "gemini_cli";
  if (statuses.gemini?.configured) return "gemini";
  return null;
}

export function resolveVibeProvider(input: {
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

  // Patch-heavy / code-edit intensive tasks: prefer OpenAI when available.
  if (looksLikePatchHeavyTask(task) && statuses.openai?.configured) {
    return "openai";
  }

  // Default: Gemini first, then OpenAI, then Claude.
  if (gemini) return gemini;
  if (statuses.openai?.configured) return "openai";
  if (claude) return claude;

  return suggestedProviderForRole(input.role);
}

export function roleCapabilities(role: AgentRole): { canTerminal: boolean; canProdStage: boolean } {
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
