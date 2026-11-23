/**
 * Coding agent – Direct edits, playground promotion, patch repair and apply+verify.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import type { CodingSkill } from "@/types/taskContract";
import type { AgentRole } from "@/types/agent";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { DirectEditPlan, ExecutionOutcome, RunAttachment, ScopedFileSnapshot } from "@/lib/code-agent/types";
import { attemptSingleFileRewriteFallback, buildAgentBranchName, buildUnifiedDiffFromContents, detectPackageManager, DIRECT_FILE_EDIT_SCHEMA, loadPackageScripts, normalizeDiffForExecution, pathExists, resolveExistingExecutionPath, restoreScopedFiles, rewriteTempDiffToSelectedFile, snapshotPlaygroundGit, syncMirrorToPlayground } from "@/lib/code-agent/playground";
import { buildExecutionTraceIntro, buildTaskWithExecutionDiscipline, injectLongTermMemory } from "@/lib/code-agent/prompts";
import { callGeminiJson, callProviderJson } from "@/lib/code-agent/providers";
import { estimatedUsd, estimateTokens, nowIso, resolveExecutionRoot, runCommand, runHardGateVerification, sanitizeUnifiedDiff } from "@/lib/code-agent/gates";
import { appendCodeRunEventSafe } from "@/lib/code-agent/contract";
import { diffTouchedFiles, resolveRepoRoot, resolveVerificationRoot, trimEnv } from "@/lib/code-agent/repo";
import { slugifyCommitFragment } from "@/lib/code-agent/localAgent";
import { COMMAND_TIMEOUT_MS } from "@/lib/code-agent/config";

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

export async function applyDirectEditsAndVerify(input: {
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
        const branchName = (input.agentBranchName?.trim() || buildAgentBranchName(input.stage)).replace(/\s+/g, "-");
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

export async function applyPlaygroundPromotionAndVerify(input: {
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
        const branchName = (input.agentBranchName?.trim() || buildAgentBranchName(input.stage)).replace(/\s+/g, "-");
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

export async function applyPatchAndVerify(input: {
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
    const branchName = (input.agentBranchName?.trim() || buildAgentBranchName(input.stage)).replace(/\s+/g, "-");
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
      executionLog.push("Creating isolated agent branch for this run...");
      if (!input.branchPerAgent) {
        const branchName = buildAgentBranchName(input.stage);
        const checkoutResult = await runCommand("git", ["checkout", "-b", branchName], executionRoot);
        if (checkoutResult.code !== 0) {
          commitOutput = (checkoutResult.stderr || checkoutResult.stdout || "Unable to create agent branch.").trim();
          executionLog.push("Auto-commit skipped because agent branch creation failed.");
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
