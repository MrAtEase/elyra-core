import { requirePlatformOwner } from "@/lib/api/requireAuth";
import { type NextRequest, NextResponse } from "next/server";
import { type CodeTaskContract, CODING_SKILLS, type CodingSkill } from "@/types/taskContract";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import path from "node:path";
import type { AgentRole, TeamMode } from "@/types/agent";
import { type ProviderId, resolveProvider, resolveProviderForWorkspace } from "@/lib/orb-os/providers/providerRouter";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";
import { cleanupGitHubClone, cloneRepoToTmp } from "@/lib/github/cloudCoder";
import { createHash } from "node:crypto";
import { forwardToWorkerOs, isWorkerBackboneMode, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";
import { detectPackageManager } from "@/lib/code-agent/playground";
import { commandForGate, emitRunMetricsSafe, estimatedUsd, estimateTokens, evaluateComplianceGuardrails, evaluateRunBudgetProfile, nowIso, supervisorTeamPlan } from "@/lib/code-agent/gates";
import { buildLocalPlan, buildLocalResult, buildLocalUiColorFallbackResult, buildUxDesignApprovalGateArtifact, detectDesignDraft, fixDiffHunkCounts, stripSpuriousRemovedLines, tryGenerateDesignDraftViaMcp, withDesignDraftMetadata } from "@/lib/code-agent/localFallback";
import { collectRepoSnapshot, correctStaleUiScopeForTask, fileOptionPriority, inferTaskScopedFiles, inferTaskScopedFilesFast, inferUxUiDesignScopedFiles, inferUxUiDesignScopedFilesFast, listFolderOptions, listGitHubRepos, listLocalRepos, looksLikeFrontendUiFile, looksLikeRepoReviewOnlyTask, looksLikeUiStylingTask, normalizeSelectedFilesForRepo, parseGitHubRepoUrl, shouldRequireScopedExecutionForTask } from "@/lib/code-agent/repo";
import { buildProviderRuntimeFailure, ensureGeminiCliAuthReady, getCodeProviderStatuses } from "@/lib/code-agent/providers";
import type { FileOption, JsonRecord, RepoOption, RunAttachment, TeamConfig } from "@/lib/code-agent/types";
import { ANALYSIS_ONLY_SKILLS, REPO_SCAN_TEXT_EXTENSIONS, TOOL_ALLOWLIST } from "@/lib/code-agent/config";
import { appendCodeRunEventSafe, normalizeCodeTaskContract } from "@/lib/code-agent/contract";
import { bestClaudeProvider, buildExecutionDiscipline, buildLongTermMemoryContext, buildTaskWithExecutionDiscipline, injectLongTermMemory, loadWorkspaceBrainProfile, loadWorkspaceMemories, looksLikeBroadAnalysisTask, looksLikeWholeRepoReviewTask, persistArtifactMemory, resolveVibeProvider, roleCapabilities, skillSystemPrompt, suggestedProviderForRole } from "@/lib/code-agent/prompts";
import { executeAutonomousAgenticLoop, executeGeminiCliReview, executeGeminiCliScopedEdit } from "@/lib/code-agent/agentLoop";
import { applyDirectEditsAndVerify, applyPlaygroundPromotionAndVerify } from "@/lib/code-agent/apply";
import { buildGeminiPlan, buildGeminiResult, finalizeExecutionArtifact, normalizePlanArtifact, normalizeResultArtifact } from "@/lib/code-agent/planner";
import { executeViaLocalAgent } from "@/lib/code-agent/localAgent";

export const __test__ = {
  detectPackageManager,
  commandForGate,
  fixDiffHunkCounts,
  stripSpuriousRemovedLines,
};

// ── GET — capabilities + tool allowlist ───────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requirePlatformOwner(request);
  if (auth instanceof NextResponse) return auth;
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
  const auth = await requirePlatformOwner(request);
  if (auth instanceof NextResponse) return auth;
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

  // Unknown skill ids used to slip through and fall back to editing behaviour – normalise them.
  const SKILL_ALIASES: Record<string, CodingSkill> = { explain: "code-explain", review: "review-code", security: "security-scan", audit: "security-scan", tests: "write-tests", types: "add-types", refactor: "refactor-module", feature: "implement-feature" };
  const rawSkill = typeof requestBody.skill === "string" ? requestBody.skill.trim() : "";
  let skill: CodingSkill = CODING_SKILLS.some((s) => s.id === rawSkill)
    ? (rawSkill as CodingSkill)
    : SKILL_ALIASES[rawSkill.toLowerCase()] ?? "custom";
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
          repoSnapshot: (ANALYSIS_ONLY_SKILLS.has(skill) || suggestionsOnly) ? effectiveRepoSnapshot : undefined,
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
    skill !== "review-code" &&
    !isReadOnlyReviewRun &&
    !suggestionsOnly;

  const canUseLocalAgentExecution =
    phase === "execute" &&
    terminalAccess &&
    !providedDiff.trim() &&
    !parseGitHubRepoUrl(repoUrl) &&
    skill !== "review-code" &&
    !isReadOnlyReviewRun &&
    !suggestionsOnly &&
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
    skill !== "review-code" &&
    !isReadOnlyReviewRun &&
    !suggestionsOnly;

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
