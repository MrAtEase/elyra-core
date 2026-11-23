/**
 * Coding agent – OpenAI fallback, plan/result generation and artifact normalisation.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole } from "@/types/agent";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanupGitHubClone, pushBranchAndCreatePR } from "@/lib/github/cloudCoder";
import type { JsonRecord, RepoSnapshot, ReviewFinding, RunAttachment } from "@/lib/code-agent/types";
import { buildSelectedFileGroundTruth, buildSelectedFileHints, formatRealPathHints, formatRepoSnapshot, resolveRepoRoot, trimEnv } from "@/lib/code-agent/repo";
import { ANALYSIS_ONLY_SKILLS, GEMINI_TIMEOUT_MS, TOOL_ALLOWLIST } from "@/lib/code-agent/config";
import { callProviderJson, parseJsonFromText, resolveLocalProviderCwd } from "@/lib/code-agent/providers";
import { agentRolePrompt, buildAttachmentPromptContext, buildTaskWithExecutionDiscipline, injectLongTermMemory } from "@/lib/code-agent/prompts";
import { buildLocalPlan, buildLocalReviewResult, buildLocalReviewWithFixesResult, fixDiffHunkCounts, stripSpuriousRemovedLines } from "@/lib/code-agent/localFallback";
import { buildRepoInvestigationContext } from "@/lib/code-agent/investigation";
import { applyPatchAndVerify } from "@/lib/code-agent/apply";

// ── OpenAI direct fallback (used when Gemini quota is exhausted) ─────────────
export async function callOpenAiJson(input: {
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

export async function buildGeminiPlan(input: {
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

export async function buildGeminiResult(input: {
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

export function normalizePlanArtifact(
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

export function normalizeResultArtifact(
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

export async function finalizeExecutionArtifact(
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
