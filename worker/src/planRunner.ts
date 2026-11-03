import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  DevPlanConfig,
  DevPlanResult,
  PlanStepConfig,
  PlanStepResult,
  ShellCheckConfig,
  ShellCheckResult,
} from "./devTaskTypes";
import { createLogger } from "./logger";
import { runSession } from "./sessionRunner";

const execAsync = promisify(exec);
const log = createLogger("PlanRunner");
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

export async function runShellCheck(
  projectRoot: string,
  check: ShellCheckConfig
): Promise<ShellCheckResult> {
  const cwd = check.cwd ? path.resolve(projectRoot, check.cwd) : projectRoot;
  const startedAt = new Date();
  try {
    const { stdout, stderr } = await execAsync(check.command, {
      cwd,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
    const finishedAt = new Date();
    const exitCode = 0;
    return {
      id: check.id,
      label: check.label,
      command: check.command,
      cwd,
      exitCode,
      stdout: stdout?.trim() || "",
      stderr: stderr?.trim() || "",
      success: exitCode === 0,
    };
  } catch (error: any) {
    const finishedAt = new Date();
    const exitCode = typeof error?.code === "number" ? error.code : null;
    return {
      id: check.id,
      label: check.label,
      command: check.command,
      cwd,
      exitCode,
      stdout: error?.stdout?.toString?.().trim?.() || "",
      stderr: error?.stderr?.toString?.().trim?.() || (error instanceof Error ? error.message : String(error)),
      success: false,
    };
  }
}

async function loadPlanConfig(configPath: string): Promise<DevPlanConfig> {
  const json = await fs.readFile(configPath, "utf8");
  const data = JSON.parse(json) as DevPlanConfig;
  if (!data || !data.id || !Array.isArray(data.steps)) {
    throw new Error("Invalid plan config JSON");
  }
  return data;
}

export async function runDevPlan(configPath: string): Promise<DevPlanResult> {
  const absoluteConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(DEFAULT_REPO_ROOT, configPath);
  log.info("[PlanRunner] Loading plan:", absoluteConfigPath);
  const plan = await loadPlanConfig(absoluteConfigPath);
  const planDir = path.dirname(absoluteConfigPath);
  const projectRoot = plan.projectRoot
    ? path.resolve(plan.projectRoot)
    : planDir.startsWith(DEFAULT_REPO_ROOT)
      ? planDir
      : DEFAULT_REPO_ROOT;

  const startedAt = new Date().toISOString();
  const stepsResult: PlanStepResult[] = [];
  let success = true;
  let gitInfo: DevPlanResult["git"] | undefined;

  for (const step of plan.steps) {
    if (step.type === "session") {
      const sessionPath = path.isAbsolute(step.sessionConfigPath)
        ? step.sessionConfigPath
        : path.resolve(planDir, step.sessionConfigPath);
      log.info(`[PlanRunner] Running session step ${step.id} (${sessionPath})`);
      const sessionResult = await runSession(sessionPath, {
        repoRoot: DEFAULT_REPO_ROOT,
        writeMode: plan.writeMode,
        safetyLevel: plan.safetyLevel,
        git: plan.git,
      });
      stepsResult.push({
        type: "session",
        id: step.id,
        label: step.label,
        sessionConfigPath: sessionPath,
        sessionResult,
      });
      gitInfo = sessionResult.git || gitInfo;
      success = success && sessionResult.blocked !== true;
    } else if (step.type === "check") {
      log.info(`[PlanRunner] Running check step ${step.id}: ${step.check.command}`);
      const checkResult = await runShellCheck(projectRoot, step.check);
      stepsResult.push({
        type: "check",
        id: step.id,
        label: step.label,
        checkResult,
      });
      if (!checkResult.success && step.check.continueOnFail !== true) {
        success = false;
        break;
      }
    } else {
      log.warn(`[PlanRunner] Unknown step type ${(step as PlanStepConfig).type}, skipping`);
    }
  }

  const finishedAt = new Date().toISOString();

  return {
    id: plan.id,
    label: plan.label,
    projectRoot,
    steps: stepsResult,
    git: gitInfo,
    startedAt,
    finishedAt,
    success,
  };
}
