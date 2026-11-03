import fs from "node:fs/promises";
import path from "node:path";
import {
  DevTask,
  DevTaskResult,
  ApplyMode,
  WriteMode,
  SafetyLevel,
  CheckDefinition,
  CheckResult,
  RiskLevel,
  SessionGitConfig,
  SessionGitInfo,
  PreApplyCheckConfig,
  PreApplyCheckResult,
  GitOptions,
  GitResult,
  DevTaskBackupInfo,
  SessionBackupInfo,
} from "./devTaskTypes";
import { runSingleFileEditTask } from "./devTaskRunner";
import {
  ensureCleanGitWorkingTree,
  ensureGitRepo,
  getCurrentBranch,
  getGitStatus,
  commitAllChangesWithSummary,
  checkoutBranch,
  createAndCheckoutBranch,
  getCurrentCommitSha,
  createAutopilotCommit,
} from "./gitService";
import { createLogger } from "./logger";
import { runChecksForTask } from "./checkRunner";
import { analyzeRisk } from "./riskAnalyzer";
import { runBuildCheck, runTypeCheck, runTestCheck } from "./preApplyChecks";
import { buildSessionReport, renderSessionReportMarkdown, writeSessionReportMarkdown } from "./reportService";
import { runChecks } from "./commandRunner";
import { analyzeProject } from "./analyzer/analyzerService";
import { runReasoningEngine } from "./reasoning/reasoningEngine";
import { runFeaturePlanner } from "./featurePlanner";
import { createBackupForFiles, restoreBackupSnapshot, BackupSnapshot } from "./fsService";

export interface SessionTaskConfig {
  id: string;
  goal: string;
  mode: DevTask["mode"];
  target: DevTask["target"];
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
}

export interface SessionConfig {
  id: string;
  projectRoot: string;
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  tasks: SessionTaskConfig[];
  checks?: CheckDefinition[];
  perTaskChecks?: Record<string, CheckDefinition[]>;
  git?: GitOptions;
  preApplyChecks?: PreApplyCheckConfig;
  checksBefore?: string[];
  type?: string;
}

export interface SessionRunResult {
  sessionId: string;
  projectRoot: string;
  applyMode: ApplyMode;
  writeMode: WriteMode;
  safetyLevel: SafetyLevel;
  results: DevTaskResult[];
  tasks?: DevTaskResult[];
  overallRiskLevel?: RiskLevel;
  overallRiskReason?: string;
  overallChecks?: CheckResult[];
  blocked?: boolean;
  blockedReason?: string;
  applyBlockedDueToChecks?: boolean;
  preApply?: PreApplyCheckResult;
  startedAt: string;
  finishedAt: string;
  featurePlan?: import("./devTaskTypes").FeaturePlanResult;
  gitInfo?: SessionGitInfo;
  backups?: SessionBackupInfo;
  report?: import("./devTaskTypes").SessionReport;
  reportFilePath?: string;
  checksBeforeExecuted?: import("./commandRunner").CommandResult[];
  checksPassed?: boolean;
  rollback?: import("./devTaskTypes").RollbackInfo;
  reasoning?: any;
  git?: import("./devTaskTypes").GitRunContext & { autoCommitEnabled?: boolean; error?: string | null };
  status?: "success" | "partial-failed" | "failed" | "preview-only";
  errorMessage?: string | null;
  incidentWebhookTriggered?: boolean;
}

export interface RunSessionOptions {
  allowDirty?: boolean;
  repoRoot?: string;
  gitCheckMessage?: string;
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  withChecks?: boolean;
  git?: GitOptions;
  preApplyChecks?: PreApplyCheckConfig;
  maxTasks?: number;
  incidentWebhook?: import("./devTaskTypes").IncidentWebhookConfig;
}

const log = createLogger("SessionRunner");
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "unknown"];

async function triggerIncidentWebhook(
  webhook: import("./devTaskTypes").IncidentWebhookConfig | undefined,
  payload: Record<string, unknown>,
  status: SessionRunResult["status"],
  loggerContext: Record<string, unknown>
): Promise<boolean> {
  if (!webhook) return false;
  if (webhook.onlyOnFailure !== false && status && status !== "failed" && status !== "partial-failed") {
    return false;
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhook.secretHeaderName && webhook.secretHeaderValue) {
      headers[webhook.secretHeaderName] = webhook.secretHeaderValue;
    }
    await fetch(webhook.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    log.info("Incident webhook triggered", { ...loggerContext, stage: "incident-webhook" });
    return true;
  } catch (err) {
    log.error("Incident webhook failed", { ...loggerContext, stage: "incident-webhook", error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function loadSessionConfig(configPath: string): Promise<SessionConfig> {
  const json = await fs.readFile(configPath, "utf8");
  const data = JSON.parse(json) as SessionConfig;

  if (!data || !data.id || !data.projectRoot || !Array.isArray(data.tasks)) {
    throw new Error("Invalid session config JSON");
  }

  return data;
}

function resolveConfigPath(configPath: string, repoRoot: string): string {
  return path.isAbsolute(configPath)
    ? configPath
    : path.resolve(repoRoot, configPath);
}

function countDiffLines(diff?: string): number {
  if (!diff) return 0;
  const lines = diff.split("\n");
  return lines.filter((l) => l.startsWith("+") || l.startsWith("-")).length;
}

function maxRiskLevel(a: RiskLevel | undefined, b: RiskLevel | undefined): RiskLevel {
  const idxA = RISK_ORDER.indexOf(a || "low");
  const idxB = RISK_ORDER.indexOf(b || "low");
  return RISK_ORDER[Math.max(idxA, idxB)] || "low";
}

export async function runSession(
  configPath: string,
  options: RunSessionOptions = {}
): Promise<SessionRunResult> {
  const { repoRoot = DEFAULT_REPO_ROOT } = options;
  const absoluteConfigPath = resolveConfigPath(configPath, repoRoot);
  log.info("Loading session config from:", absoluteConfigPath);
  const config = await loadSessionConfig(absoluteConfigPath);
  return runSessionWithConfig(config, options);
}

export async function runSessionFromConfigFile(
  configPath: string,
  options: RunSessionOptions = {}
): Promise<SessionRunResult> {
  return runSession(configPath, options);
}

export async function runSessionWithConfig(
  config: SessionConfig,
  options: RunSessionOptions = {}
): Promise<SessionRunResult> {
  if ((config as any).mode === "reason") {
    const projectRoot = path.isAbsolute(config.projectRoot)
      ? config.projectRoot
      : path.resolve(options.repoRoot || DEFAULT_REPO_ROOT, config.projectRoot);
    const reasoning = await runReasoningEngine(projectRoot, config.id, {
      apply: (options.writeMode || config.writeMode || "preview") === "apply",
      safetyLevel: options.safetyLevel,
    });
    return {
      sessionId: config.id,
      projectRoot,
      applyMode: "preview",
      writeMode: "preview",
      safetyLevel: options.safetyLevel || config.safetyLevel || "none",
      results: [],
      tasks: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      reasoning,
    } as SessionRunResult;
  }
  if ((config as any).type === "plan") {
    const projectRoot = path.isAbsolute(config.projectRoot)
      ? config.projectRoot
      : path.resolve(options.repoRoot || DEFAULT_REPO_ROOT, config.projectRoot);
    const planner = await runFeaturePlanner({
      requestText: config.id,
      projectRoot,
      previewOnly: (options.writeMode || config.writeMode) === "preview",
      safetyLevel: options.safetyLevel || config.safetyLevel || "strict",
    });
    return {
      sessionId: config.id,
      projectRoot,
      applyMode: "preview",
      writeMode: "preview",
      safetyLevel: options.safetyLevel || config.safetyLevel || "strict",
      results: [],
      tasks: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      reasoning: planner.reasoning,
    } as SessionRunResult;
  }
  const {
    allowDirty = false,
    repoRoot = DEFAULT_REPO_ROOT,
    gitCheckMessage,
    applyMode,
    safetyLevel,
    withChecks = true,
  } = options;
  const startedAt = new Date().toISOString();
  const sessionWriteMode = options.writeMode ?? (applyMode as WriteMode | undefined);

  const projectRoot = path.isAbsolute(config.projectRoot)
    ? config.projectRoot
    : path.resolve(repoRoot, config.projectRoot);
  try {
    await analyzeProject(projectRoot);
  } catch (err) {
    log.warn("[SessionRunner] Project analysis failed (continuing):", err);
  }
  const effectiveApplyMode: ApplyMode = applyMode ?? config.applyMode ?? "apply";
  const effectiveWriteMode: WriteMode =
    sessionWriteMode ?? config.writeMode ?? effectiveApplyMode ?? "apply";
  const effectiveSafety: SafetyLevel = safetyLevel ?? config.safetyLevel ?? "none";
  const rawGit = options.git || config.git;
  const gitOptions: GitOptions | undefined = rawGit
    ? {
        enabled: rawGit.enabled ?? (rawGit as any).enable ?? false,
        branchStrategy: rawGit.branchStrategy || "current",
        targetBranch: rawGit.targetBranch || (rawGit as any).branchName,
        baseBranch: rawGit.baseBranch,
        autoCommit: rawGit.autoCommit ?? (rawGit as any).autoCommit ?? false,
        commitMessageTemplate: rawGit.commitMessageTemplate || (rawGit as any).commitMessage,
        branchMode: (rawGit as any).branchMode || rawGit.branchMode,
        branchPrefix: rawGit.branchPrefix,
      }
    : undefined;
  const gitBranchMode = (rawGit as any).branchMode as string | undefined;
  const gitFeatureId = (rawGit as any).featureId || config.id;
  const gitCustomBranch = (rawGit as any).customBranchName || gitOptions?.targetBranch;
  const tagPattern = (rawGit as any).tagPattern as string | undefined;
  log.info("Session started", {
    sessionId: config.id,
    projectRoot,
    writeMode: effectiveWriteMode,
    safetyLevel: effectiveSafety,
    stage: "start",
  });

  await ensureCleanGitWorkingTree(projectRoot, {
    allowDirty,
    message: gitCheckMessage,
  });

  let gitResult: GitResult | undefined;
  let usedBranch: string | undefined;
  let createdBranch = false;
  let gitError: string | null = null;
  const branchBefore = gitOptions?.enabled ? await getCurrentBranch(projectRoot).catch(() => null) : null;
  const useNewBranchMode = gitBranchMode === "feature" || gitBranchMode === "custom" || gitBranchMode === "none";

  if (gitOptions?.enabled) {
    try {
      await ensureGitRepo(projectRoot);
      if (useNewBranchMode) {
        if (gitBranchMode === "feature") {
          usedBranch = `${gitOptions.branchPrefix || "feature/autopilot/"}${gitFeatureId ? gitFeatureId : "autopilot"}`
            .replace(/\/+/g, "/")
            .trim();
          if (usedBranch) {
            const base = gitOptions.baseBranch || "main";
            await createAndCheckoutBranch(projectRoot, usedBranch!, base);
            createdBranch = true;
          } else {
            gitError = "Invalid feature branch name";
          }
        } else if (gitBranchMode === "custom" && gitCustomBranch) {
          usedBranch = gitCustomBranch;
          await createAndCheckoutBranch(projectRoot, usedBranch!, gitOptions.baseBranch);
        } else if (gitBranchMode === "custom" && !gitCustomBranch) {
          gitError = "customBranchName required";
        } else if (gitBranchMode === "none") {
          usedBranch = branchBefore || undefined;
        }
      } else {
        if (gitOptions.branchStrategy === "current") {
          usedBranch = branchBefore || undefined;
        } else if (gitOptions.branchStrategy === "explicit" && gitOptions.targetBranch) {
          if (branchBefore !== gitOptions.targetBranch) {
            await checkoutBranch(projectRoot, gitOptions.targetBranch);
          }
          usedBranch = gitOptions.targetBranch;
        } else if (gitOptions.branchStrategy === "new-from-main" && gitOptions.targetBranch) {
          const base = gitOptions.baseBranch || "main";
          await createAndCheckoutBranch(projectRoot, gitOptions.targetBranch!, base);
          usedBranch = gitOptions.targetBranch;
          createdBranch = true;
        } else {
          gitError = "Invalid git branch configuration";
        }
      }
      log.info("[SessionRunner] Using git branch", { usedBranch, createdBranch });
    } catch (err) {
      gitError = err instanceof Error ? err.message : String(err);
      log.warn("[SessionRunner] Git branch setup failed:", err);
    }
  }

  const results: DevTaskResult[] = [];
  const taskChecks: Record<string, CheckResult[]> = {};
  let checksBeforeExecuted: import("./commandRunner").CommandResult[] | undefined;
  let checksPassed: boolean | undefined;
  let backupSnapshot: BackupSnapshot | undefined;
  let status: SessionRunResult["status"] = "success";
  let errorMessage: string | null = null;

  if (Array.isArray(config.checksBefore) && config.checksBefore.length > 0) {
    try {
      log.info("[SessionRunner] Running pre-checks:", config.checksBefore.join(", "));
      checksBeforeExecuted = await runChecks(projectRoot, config.checksBefore);
      checksPassed = checksBeforeExecuted.every((c) => (c.exitCode ?? 1) === 0);
      log.info(
        `[SessionRunner] Pre-checks completed (passed=${checksPassed ? "yes" : "no"})`
      );
    } catch (err) {
      log.warn("[SessionRunner] Pre-checks failed:", err);
      checksPassed = false;
    }
  }

  if (effectiveWriteMode === "apply") {
    try {
      const targetFiles = Array.from(
        new Set(config.tasks.map((t) => path.relative(projectRoot, path.resolve(projectRoot, t.target.file))))
      );
      if (targetFiles.length > 0) {
        backupSnapshot = await createBackupForFiles(projectRoot, targetFiles);
        log.info("[SessionRunner] Backup snapshot created", backupSnapshot.backupDir);
      }
    } catch (err) {
      log.warn("[SessionRunner] Failed to create backup snapshot:", err);
    }
  }

  for (const taskConfig of config.tasks) {
    const task: DevTask = {
      id: taskConfig.id,
      goal: taskConfig.goal,
      mode: taskConfig.mode,
      projectRoot: projectRoot,
      target: taskConfig.target,
      applyMode: taskConfig.applyMode ?? effectiveApplyMode,
      writeMode: taskConfig.writeMode ?? taskConfig.applyMode ?? effectiveWriteMode,
      safetyLevel: taskConfig.safetyLevel ?? effectiveSafety,
    };

    log.info(
      `Running task ${task.id} on ${task.target.file} (mode=${task.mode}, applyMode=${task.applyMode}, writeMode=${task.writeMode}, safety=${task.safetyLevel})...`
    );

    const result = await runSingleFileEditTask(projectRoot, task, {
      writeMode: task.writeMode ?? task.applyMode ?? effectiveWriteMode,
      safetyLevel: task.safetyLevel ?? effectiveSafety,
    });
    if (!result.mode) result.mode = task.mode;
    if (!result.file) result.file = task.target.file;

    log.info(`Task ${task.id} finished with status ${result.status}`);

    if (withChecks) {
      const defs: CheckDefinition[] =
        config.perTaskChecks?.[task.id] && Array.isArray(config.perTaskChecks[task.id])
          ? config.perTaskChecks[task.id]
          : [];
      if (defs.length > 0) {
        const checks = await runChecksForTask(defs);
        taskChecks[task.id] = checks;
        result.checks = checks;
      }
    }

    const riskInput = {
      diffLines: countDiffLines(result.diff) || result.changedLines || 0,
      fileCount: 1,
      checks: result.checks || [],
    };
    const risk = withChecks
      ? analyzeRisk(riskInput)
      : { level: "unknown" as RiskLevel, reason: "Checks disabled" };
    result.riskLevel = risk.level;
    result.riskReason = risk.reason;

    log.info(`[SessionRunner] Task ${task.id} risk=${risk.level} reason="${risk.reason}"`);

    results.push(result);
  }

  let overallChecks: CheckResult[] | undefined;
  if (withChecks && Array.isArray(config.checks) && config.checks.length > 0) {
    overallChecks = await runChecksForTask(config.checks);
  }

  let overallRiskLevel: RiskLevel = withChecks ? "low" : "unknown";
  let overallRiskReason = withChecks ? "All tasks low risk" : "Checks disabled";

  for (const task of results) {
    overallRiskLevel = maxRiskLevel(overallRiskLevel, task.riskLevel);
    if (task.riskReason) {
      overallRiskReason = task.riskReason;
    }
  }

  if (overallChecks && overallChecks.length > 0) {
    const checkRisk = analyzeRisk({
      diffLines: results.reduce((sum, r) => sum + (countDiffLines(r.diff) || r.changedLines || 0), 0),
      fileCount: results.length,
      checks: overallChecks,
    });
    overallRiskLevel = maxRiskLevel(overallRiskLevel, checkRisk.level);
    overallRiskReason = checkRisk.reason;
  }

  const strictCheckFailure =
    effectiveSafety === "strict" &&
    (overallRiskLevel === "high" ||
      results.some((r) => r.checks?.some((c) => c.status === "failed" || c.status === "error")) ||
      (overallChecks?.some((c) => c.status === "failed" || c.status === "error") ?? false));

  const basicBlocked = effectiveSafety === "basic" && overallRiskLevel === "high";

  const sessionBlocked = strictCheckFailure || basicBlocked;
  const blockedReason = strictCheckFailure
    ? "Strict safety: checks failed or high risk"
    : basicBlocked
      ? "Basic safety: high risk change"
      : undefined;

  let preApply: PreApplyCheckResult | undefined;
  let applyBlockedDueToChecks = false;

  if (effectiveWriteMode === "apply") {
    const checksConfig: PreApplyCheckConfig = {
      build: options.preApplyChecks?.build ?? config.preApplyChecks?.build ?? true,
      types: options.preApplyChecks?.types ?? config.preApplyChecks?.types ?? true,
      tests: options.preApplyChecks?.tests ?? config.preApplyChecks?.tests ?? false,
    };
    preApply = { ok: true };

    if (checksConfig.build) {
      try {
        preApply.buildOutput = await runBuildCheck(projectRoot);
      } catch (err) {
        preApply.ok = false;
        preApply.buildOutput = err instanceof Error ? err.message : String(err);
      }
    }

    if (checksConfig.types) {
      try {
        preApply.typeOutput = await runTypeCheck(projectRoot);
      } catch (err) {
        preApply.ok = false;
        preApply.typeOutput = err instanceof Error ? err.message : String(err);
      }
    }

    if (checksConfig.tests) {
      try {
        preApply.testOutput = await runTestCheck(projectRoot);
      } catch (err) {
        preApply.ok = false;
        preApply.testOutput = err instanceof Error ? err.message : String(err);
      }
    }

    applyBlockedDueToChecks = preApply.ok === false;
    if (applyBlockedDueToChecks) {
      log.warn(`[SessionRunner] Apply blocked due to pre-apply checks failing for session ${config.id}`);
    }
  }

  log.info(
    `[SessionRunner] Session ${config.id} overall risk=${overallRiskLevel} blocked=${sessionBlocked ? "yes" : "no"}`
  );

  const finishedAt = new Date().toISOString();

  if (gitOptions?.enabled && gitOptions.autoCommit && effectiveWriteMode === "apply" && !applyBlockedDueToChecks) {
    try {
      const anyFailed = results.some((r) => r.status === "failed" || r.blocked);
      if (!anyFailed) {
        const summary =
          results
            .map((r) => r.summary)
            .filter(Boolean)
            .join("; ")
            .slice(0, 120) || "";
        const template = gitOptions.commitMessageTemplate || "Autopilot: {sessionId} – {summary}";
        const message = template
          .replace("{sessionId}", config.id || "session")
          .replace("{summary}", summary || "no summary");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const tagName =
          typeof tagPattern === "string"
            ? tagPattern
                .replace("{sessionId}", config.id || "session")
                .replace("{featureId}", gitFeatureId || "feature")
                .replace("{timestamp}", timestamp)
            : null;
        const gitCtx = await createAutopilotCommit(projectRoot, {
          enable: true,
          branchMode: (gitBranchMode as any) === "feature-branch" ? "feature" : (gitBranchMode as any),
          featureId: gitFeatureId,
          customBranchName: gitCustomBranch,
          commitMessage: message,
          tagName,
          tagMessage: message,
          baseBranch: gitOptions.baseBranch,
        });
        gitResult = {
          ...(gitResult || {}),
          commitHash: gitCtx.commitSha,
          commitMessage: message,
          commitCreated: true,
          tag: gitCtx.tag || undefined,
          usedBranch: gitCtx.branch || usedBranch,
        };
      } else {
        gitError = "Skipped auto-commit due to failed tasks";
      }
    } catch (err) {
      gitError = err instanceof Error ? err.message : String(err);
      log.warn("[SessionRunner] Git auto-commit failed:", err);
    }
  }

  const sessionTasks: import("./devTaskTypes").SessionTaskResult[] = results.map((r) => ({
    id: (r as any).id || "task",
    file: (r as any).target?.file || "",
    mode: ((r as any).mode as any) || "",
    status: r.status === "done" ? "done" : r.status === "failed" || r.blocked ? "failed" : "skipped",
    summary: r.summary,
    errorMessage: (r as any).errorMessage || r.blockedReason || null,
  }));
  const backups: DevTaskBackupInfo[] = results
    .map((r) => r.backup)
    .filter((b): b is DevTaskBackupInfo => Boolean(b));

  const deriveFailureReasonFromTasks = (tasks: DevTaskResult[]): import("./devTaskTypes").FailureReason | null => {
    const failedTask = tasks.find((t) => t.status === "failed" || t.blocked);
    if (!failedTask) return null;
    const msg = (failedTask.errorMessage || failedTask.blockedReason || failedTask.summary || "").toLowerCase();
    if (msg.includes("typescript") || msg.includes("ts ")) return "ts-error";
    if (msg.includes("test") || msg.includes("jest") || msg.includes("vitest")) return "test-failed";
    if (failedTask.blockedReason && failedTask.blockedReason.toLowerCase().includes("safety")) {
      return "safety-violation";
    }
    return "unknown";
  };

  let rollback: import("./devTaskTypes").RollbackInfo | undefined;
  const failureReason = deriveFailureReasonFromTasks(results);
  if (effectiveWriteMode === "apply" && failureReason) {
    if (backupSnapshot) {
      try {
        await restoreBackupSnapshot(backupSnapshot);
        rollback = {
          attempted: true,
          succeeded: true,
          reason: failureReason,
          details: "Restored files from backup snapshot.",
        };
      } catch (err) {
        rollback = {
          attempted: true,
          succeeded: false,
          reason: failureReason,
          details: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      rollback = {
        attempted: true,
        succeeded: false,
        reason: failureReason,
        details: "No backup snapshot available for rollback.",
      };
    }
  } else {
    rollback = { attempted: false, succeeded: false };
  }

  const hasFailed = results.some((r) => r.status === "failed" || r.blocked);
  const hasDone = results.some((r) => r.status === "done");
  if (effectiveWriteMode === "preview" && !hasFailed && !sessionBlocked && !applyBlockedDueToChecks) {
    status = "preview-only";
  } else if (!hasFailed && !sessionBlocked && !applyBlockedDueToChecks) {
    status = "success";
  } else if (hasDone && hasFailed) {
    status = "partial-failed";
  } else {
    status = "failed";
  }
  if (!errorMessage && gitError) errorMessage = gitError;
  if (!errorMessage && blockedReason) errorMessage = blockedReason || null;

  let report;
  let reportFilePath: string | undefined;
  try {
    report = buildSessionReport({
      sessionId: config.id,
      projectRoot,
      applyMode: effectiveApplyMode,
      writeMode: effectiveWriteMode,
      safetyLevel: effectiveSafety,
      results,
      tasks: results,
      overallRiskLevel,
      overallRiskReason,
      overallChecks,
      blocked: sessionBlocked || applyBlockedDueToChecks,
      blockedReason: applyBlockedDueToChecks ? "Pre-apply checks failed" : blockedReason,
      applyBlockedDueToChecks,
      preApply,
      startedAt,
      finishedAt,
    } as SessionRunResult);
    const markdown = renderSessionReportMarkdown(report);
    const reportsDir = path.join(DEFAULT_REPO_ROOT, "worker", "autopilot-reports");
    const absoluteReportPath = await writeSessionReportMarkdown(reportsDir, config.id || "session", markdown);
    reportFilePath = path.relative(DEFAULT_REPO_ROOT, absoluteReportPath);
  } catch (err) {
    log.warn("[SessionRunner] Failed to build/write session report:", err);
  }

  let incidentWebhookTriggered: boolean | undefined;
  if (options.incidentWebhook) {
    const payload = {
      sessionId: config.id,
      projectRoot,
      status,
      writeMode: effectiveWriteMode,
      safetyLevel: effectiveSafety,
      git: {
        branch: gitResult?.usedBranch || usedBranch || null,
        commitSha: gitResult?.commitHash || null,
        tag: (gitResult as any)?.tag || null,
      },
      tasks: sessionTasks,
      timestamp: new Date().toISOString(),
    };
    incidentWebhookTriggered = await triggerIncidentWebhook(options.incidentWebhook, payload, status, {
      sessionId: config.id,
      stage: "incident-webhook",
    });
  }

  log.info("Session finished", {
    sessionId: config.id,
    status,
    writeMode: effectiveWriteMode,
    safetyLevel: effectiveSafety,
    gitBranch: gitResult?.usedBranch || usedBranch || null,
    gitCommit: gitResult?.commitHash || null,
    gitTag: (gitResult as any)?.tag || null,
    stage: "finish",
  });

  return {
    sessionId: config.id,
    projectRoot,
    applyMode: effectiveApplyMode,
    writeMode: effectiveWriteMode,
    safetyLevel: effectiveSafety,
    results,
    tasks: results,
    overallRiskLevel: overallRiskLevel,
    overallRiskReason,
    overallChecks,
    blocked: sessionBlocked || applyBlockedDueToChecks,
    blockedReason: applyBlockedDueToChecks ? "Pre-apply checks failed" : blockedReason,
    applyBlockedDueToChecks,
    preApply,
    startedAt,
    finishedAt,
    git: {
      repoRoot: projectRoot,
      branch:
        (gitResult && "branch" in gitResult ? (gitResult as any).branch : undefined) ||
        gitResult?.usedBranch ||
        usedBranch ||
        branchBefore ||
        undefined,
      branchBefore,
      branchAfter: gitOptions?.enabled
        ? await getCurrentBranch(projectRoot).catch(() => branchBefore)
        : branchBefore,
      createdBranch,
      commitCreated: gitResult?.commitCreated ?? gitResult?.commitHash !== undefined,
      commitSha: gitResult?.commitHash ?? null,
      autoCommit: gitOptions?.autoCommit ?? false,
      autoCommitEnabled: gitOptions?.autoCommit ?? false,
      tag: (gitResult as any)?.tag || null,
      error: gitError,
    },
    backups: backups.length > 0 ? { backups } : undefined,
    report,
    reportFilePath,
    checksBeforeExecuted,
    checksPassed,
    rollback,
    status,
    errorMessage,
    incidentWebhookTriggered,
  };
}
