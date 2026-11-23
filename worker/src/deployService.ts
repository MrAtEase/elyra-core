import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DeployConfig, DeployRunResult, DeployStepResult } from "./devTaskTypes";
import { createLogger } from "./logger";

const execAsync = promisify(exec);
const log = createLogger("DeployService");

async function runCommand(
  command: string,
  cwd: string,
  dryRun: boolean
): Promise<Omit<DeployStepResult, "id" | "label" | "command" | "cwd">> {
  const startedAt = new Date().toISOString();
  if (dryRun) {
    return {
      success: true,
      exitCode: 0,
      stdout: `DRY RUN: command would have been executed: ${command}`,
      stderr: "",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  try {
    const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return {
      success: true,
      exitCode: 0,
      stdout,
      stderr,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      success: false,
      exitCode: typeof error?.code === "number" ? error.code : null,
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || "",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

async function runSteps(
  projectRoot: string,
  commands: DeployConfig["preDeployCommands"],
  dryRun: boolean
): Promise<{ results: DeployStepResult[]; blockedBy?: string }> {
  const results: DeployStepResult[] = [];
  let blockedBy: string | undefined;

  for (const cmd of commands) {
    const cwd = path.resolve(projectRoot, cmd.cwd || ".");
    log.info(`[DeployService] Running ${cmd.id} (${cmd.label}) in ${cwd} dryRun=${dryRun}`);
    const res = await runCommand(cmd.command, cwd, dryRun);
    const step: DeployStepResult = {
      id: cmd.id,
      label: cmd.label,
      command: cmd.command,
      cwd,
      ...res,
    };
    results.push(step);
    if (!step.success && cmd.critical !== false) {
      blockedBy = `Step "${cmd.label}" failed with exitCode ${step.exitCode}`;
      break;
    }
  }

  return { results, blockedBy };
}

export async function runDeployConfig(
  config: DeployConfig,
  options: { dryRun?: boolean } = {}
): Promise<DeployRunResult> {
  const dryRun = options.dryRun === true;
  log.info(
    `[DeployService] Starting deploy config ${config.id} (pre=${config.preDeployCommands.length}, deploy=${config.deployCommands.length}, dryRun=${dryRun})`
  );

  const pre = await runSteps(config.projectRoot, config.preDeployCommands || [], dryRun);
  let deployResults: DeployStepResult[] = [];
  let blockedBy = pre.blockedBy;

  if (!blockedBy) {
    const deploy = await runSteps(config.projectRoot, config.deployCommands || [], dryRun);
    deployResults = deploy.results;
    blockedBy = deploy.blockedBy;
  }

  const ok = !blockedBy;

  return {
    configId: config.id,
    projectRoot: config.projectRoot,
    preDeploy: pre.results,
    deploy: deployResults,
    ok,
    blockedBy,
  };
}
