import { runSessionWithConfig } from "../sessionRunner";
import { FeatureExecutionResult, FeaturePlan, GitOptions, FeatureRunGitContext } from "../devTaskTypes";
import { runCommand } from "../commandRunner";
import { createFeatureBranch, getChangedFiles, commitAll, pushBranch } from "../gitService";

export async function executeFeaturePlan(input: {
  plan: FeaturePlan;
  projectRoot: string;
  writeMode: "preview" | "apply";
  safetyLevel?: "basic" | "strict";
  git?: GitOptions;
}): Promise<FeatureExecutionResult> {
  const describeStepFailure = (stepId: string, payload: unknown): string => {
    if (!payload || typeof payload !== "object") return `Step ${stepId} failed.`;
    const record = payload as Record<string, unknown>;
    const errorMessage =
      typeof record.errorMessage === "string" ? record.errorMessage :
      typeof record.blockedReason === "string" ? record.blockedReason :
      typeof record.summary === "string" ? record.summary :
      typeof record.error === "string" ? record.error :
      record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string"
        ? String((record.error as Record<string, unknown>).message)
        : "";
    return errorMessage ? `Step ${stepId} failed: ${errorMessage}` : `Step ${stepId} failed.`;
  };

  const stepResults: FeatureExecutionResult["stepResults"] = [];
  let testsOutcome: FeatureExecutionResult["tests"] | undefined;
  let anyFailed = false;
  const gitCtx: FeatureRunGitContext | undefined =
    input.writeMode === "apply"
      ? {
          featureId: input.plan.featureId,
          baseBranch: input.git?.baseBranch || "main",
          branchName: undefined,
          commits: [],
        }
      : undefined;

  if (
    input.writeMode === "apply" &&
    (input.git?.branchMode === "feature-branch" || input.git?.branchMode === "feature" || input.git?.branchMode === "custom")
  ) {
    const branchName =
      input.git.branchMode === "custom" && input.git.targetBranch
        ? input.git.targetBranch
        : `${input.git?.branchPrefix || "feature/"}${input.plan.featureId}`;
    try {
      await createFeatureBranch({
        projectRoot: input.projectRoot,
        baseBranch: input.git.baseBranch || "main",
        branchName,
      });
      if (gitCtx) gitCtx.branchName = branchName;
    } catch {
      // continue without branch
    }
  }

  for (const step of input.plan.steps) {
    if (step.kind === "code" && step.sessionConfig) {
      try {
        const sessionResult = await runSessionWithConfig(
          {
            id: step.sessionConfig.id,
            projectRoot: input.projectRoot,
            applyMode: input.writeMode,
            writeMode: input.writeMode,
            safetyLevel: input.safetyLevel,
            tasks: [
              {
                id: step.sessionConfig.id,
                goal: step.sessionConfig.goal,
                mode: step.sessionConfig.mode,
                target: { file: step.sessionConfig.target.file || "" },
                applyMode: input.writeMode,
                writeMode: input.writeMode,
                safetyLevel: input.safetyLevel,
              },
            ],
          },
          {
            repoRoot: input.projectRoot,
            writeMode: input.writeMode,
            safetyLevel: input.safetyLevel,
          }
        );
        stepResults.push({
          stepId: step.id,
          status: sessionResult.blocked ? "failed" : "done",
          sessionId: sessionResult.sessionId,
          sessionResult,
        });
        if (sessionResult.blocked) anyFailed = true;

        if (input.git?.commitMode === "per-step" && input.writeMode === "apply") {
          const changed = await getChangedFiles(input.projectRoot);
          if (changed.length > 0) {
            const msg = `[feature][${step.kind}] ${step.label || step.id} (#${input.plan.featureId} / step:${step.id})`;
            const commit = await commitAll({ projectRoot: input.projectRoot, message: msg });
            gitCtx?.commits.push({
              stepId: step.id,
              commitSha: commit.commitSha,
              message: msg,
              files: changed,
            });
          }
        }
      } catch (err) {
        anyFailed = true;
        stepResults.push({
          stepId: step.id,
          status: "failed",
          sessionResult: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    } else if (step.kind === "test") {
      try {
        const cmd = await runCommand(input.projectRoot, "npm", ["test"]);
        const passed = (cmd.exitCode ?? 1) === 0;
        testsOutcome = {
          run: true,
          commands: ["npm test"],
          passed,
          errors: passed ? [] : [cmd.stderr || cmd.stdout],
        };
        stepResults.push({
          stepId: step.id,
          status: passed ? "done" : "failed",
        });
        if (!passed) anyFailed = true;
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        testsOutcome = {
          run: true,
          commands: ["npm test"],
          passed: false,
          errors: [msg],
        };
        stepResults.push({
          stepId: step.id,
          status: "failed",
          sessionResult: { error: msg },
        });
      }
    } else {
      stepResults.push({ stepId: step.id, status: "skipped" });
    }
  }

  const overallStatus: FeatureExecutionResult["overallStatus"] = anyFailed
    ? "failed"
    : "success";
  const failedStep = stepResults.find((step) => step.status === "failed");
  const failedStepDetail = failedStep
    ? describeStepFailure(failedStep.stepId, failedStep.sessionResult)
    : null;
  const testFailureDetail =
    testsOutcome && testsOutcome.passed === false && testsOutcome.errors.length > 0
      ? `Tests failed: ${testsOutcome.errors[0]}`
      : null;
  const summary = anyFailed
    ? failedStepDetail || testFailureDetail || "Some steps failed. Check details."
    : `Completed ${stepResults.length} steps`;

  if (input.git?.commitMode === "single" && input.writeMode === "apply") {
    const changed = await getChangedFiles(input.projectRoot);
    if (changed.length > 0) {
      const msg = `[feature] ${input.plan.spec.title} (#${input.plan.featureId})`;
      const commit = await commitAll({ projectRoot: input.projectRoot, message: msg });
      gitCtx?.commits.push({
        stepId: "all",
        commitSha: commit.commitSha,
        message: msg,
        files: changed,
      });
    }
  }

  if (input.writeMode === "apply" && input.git?.push === true) {
    const branchName = gitCtx?.branchName;
    if (branchName) {
      await pushBranch({ projectRoot: input.projectRoot, branchName });
    }
  }

  return {
    featureId: input.plan.featureId,
    plan: input.plan,
    stepResults,
    tests: testsOutcome,
    overallStatus,
    summary,
    git: gitCtx,
  };
}
