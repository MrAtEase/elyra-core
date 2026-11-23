/**
 * Coding agent – Local agent process (execution via the Elyra local agent).
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole } from "@/types/agent";
import { nowIso, resolveExecutionRoot, runCommand, runHardGateVerification } from "@/lib/code-agent/gates";
import { detectPackageManager, loadPackageScripts, pathExists, resolveExistingExecutionPath, restoreScopedFiles, snapshotPlaygroundGit, snapshotScopedFiles, syncMirrorToPlayground } from "@/lib/code-agent/playground";
import type { ExecutionOutcome, LocalAgentRequestMode } from "@/lib/code-agent/types";
import { buildExecutionTraceIntro, buildTaskWithExecutionDiscipline } from "@/lib/code-agent/prompts";
import { appendCodeRunEventSafe } from "@/lib/code-agent/contract";
import { resolveVerificationRoot } from "@/lib/code-agent/repo";

export function slugifyCommitFragment(input: string): string {
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
    commitMessageTemplate: `elyra: ${slugifyCommitFragment(input.task)}`,
    branchMode: input.agentBranchName ? "custom" : input.branchPerAgent ? "feature-branch" : "none",
    commitMode: input.autoCommit ? "single" : "none",
    baseBranch: input.baseBranch,
    branchPrefix: "elyra/",
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

export async function captureExecutionDiff(executionRoot: string, changedFiles: string[], commitSha?: string): Promise<string> {
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

export async function executeViaLocalAgent(input: {
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
