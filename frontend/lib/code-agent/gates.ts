/**
 * Coding agent – Command runner, verification gates, budgets, compliance and metrics.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import { execFile } from "node:child_process";
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole, TeamMode } from "@/types/agent";
import { emitMetricSample } from "@/lib/orb-os/observability/store";
import { BUILD_GATE_TIMEOUT_MS, COMMAND_TIMEOUT_MS, EPHEMERAL_EXECUTION_CHANGE_PREFIXES, EPHEMERAL_EXECUTION_CHANGES, HARD_GATES, type HardGate, PLAYGROUND_PREVIEW_PORT, RETRY_BUDGET_PER_GATE, TEST_GATE_TIMEOUT_MS, TYPECHECK_GATE_TIMEOUT_MS } from "@/lib/code-agent/config";
import type { GateReport, RepoSnapshot, RunAttachment, TeamConfig } from "@/lib/code-agent/types";
import { formatRepoSnapshot, parseGitHubRepoUrl, resolveRepoRoot, resolveRepoWorkdir, tokenizeTask } from "@/lib/code-agent/repo";
import { preparePlaygroundMirror } from "@/lib/code-agent/playground";

export function runCommand(
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

export function nowIso(): string {
  return new Date().toISOString();
}

export function isEphemeralExecutionChange(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (EPHEMERAL_EXECUTION_CHANGES.has(normalized)) return true;
  return EPHEMERAL_EXECUTION_CHANGE_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

export function commandForGate(
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

export async function runHardGateVerification(input: {
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

export function estimateTokens(...chunks: Array<string | undefined>): number {
  const chars = chunks.reduce((total, chunk) => total + (chunk?.length ?? 0), 0);
  return Math.max(1, Math.round(chars / 4));
}

export function estimatedUsd(provider: ProviderId | "fallback", tokens: number): number {
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

export function evaluateRunBudgetProfile(input: {
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

export function evaluateComplianceGuardrails(input: {
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

export function supervisorTeamPlan(input: {
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

export async function emitRunMetricsSafe(input: {
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

export function sanitizeUnifiedDiff(diff: string): string {
  const raw = diff.trim();
  if (!raw) return "";
  const fenced = raw.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i)?.[1];
  return `${(fenced ?? raw).trim()}\n`;
}

export async function resolveExecutionRoot(
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
