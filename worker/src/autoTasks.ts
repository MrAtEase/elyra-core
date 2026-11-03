import path from "node:path";
import { promises as fs } from "node:fs";
import {
  AutoplanMaterializeInput,
  DevTaskConfig,
  DevTaskSuggestion,
  GeneratedSessionFile,
  GeneratedTaskFile,
  MaterializeResult,
  PlanResult,
  MaterializedSessionConfig,
  WriteMode,
} from "./devTaskTypes";
import { createLogger } from "./logger";

const log = createLogger("AutoTasks");

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonFile(targetPath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, json, "utf8");
}

function toDevTaskConfigs(
  suggestions: DevTaskSuggestion[],
  projectRoot: string,
  featureId: string
): DevTaskConfig[] {
  const MAX_TASKS = 20;
  return suggestions.slice(0, MAX_TASKS).map((s, idx) => {
    const targetFile = s.targetFiles?.[0] || "";
    return {
      id: s.id || `autoplan-${sanitizeName(featureId)}-${idx + 1}`,
      goal: s.goal || s.title || "Autoplan task",
      mode: (s.mode as DevTaskConfig["mode"]) || "feature",
      projectRoot,
      target: {
        file: targetFile,
      },
    };
  });
}

function buildSessionConfig(tasks: DevTaskConfig[], projectRoot: string, featureId: string): MaterializedSessionConfig {
  return {
    id: `autoplan-${sanitizeName(featureId)}`,
    projectRoot,
    tasks: tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      mode: t.mode,
      target: t.target,
    })),
    label: `Autoplan session for ${featureId}`,
  };
}

function uniquePath(basePath: string, ext = ".json"): string {
  let candidate = `${basePath}${ext}`;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!fsSyncExists(candidate)) return candidate;
    candidate = `${basePath}-${counter}${ext}`;
    counter += 1;
  }
}

function fsSyncExists(p: string): boolean {
  try {
    // eslint-disable-next-line node/no-sync
    require("node:fs").accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function materializePlanToTasksAndSession(input: AutoplanMaterializeInput): Promise<MaterializeResult> {
  const { plan, projectRoot } = input;
  const writeMode: WriteMode = input.writeMode ?? "preview";
  if (!plan || !plan.tasks || !plan.steps) {
    throw new Error("Invalid plan: missing tasks or steps");
  }
  if (plan.tasks.length === 0) {
    throw new Error("Plan has no tasks to materialize");
  }

  const baseDir = input.baseDir || "autoplan";
  const workerRoot = path.resolve(projectRoot, "worker");
  const tasksDir = path.join(workerRoot, "tasks", baseDir);
  const sessionsDir = path.join(workerRoot, "sessions", baseDir);
  const tasks = toDevTaskConfigs(plan.tasks, projectRoot, plan.featureId);
  const sessionConfig = buildSessionConfig(tasks, projectRoot, plan.featureId);

  const preview = {
    tasks,
    session: sessionConfig,
  };

  const result: MaterializeResult = {
    writeMode,
    preview,
    writtenTaskFiles: [],
    writtenSessionFile: undefined,
  };

  if (writeMode === "preview") {
    log.info("[AutoTasks] Preview materialization ready", {
      featureId: plan.featureId,
      tasks: tasks.length,
    });
    return result;
  }

  await ensureDir(tasksDir);
  await ensureDir(sessionsDir);

  for (const task of tasks) {
    const baseName = `${sanitizeName(plan.featureId)}-${sanitizeName(task.id)}`;
    const basePath = path.join(tasksDir, baseName);
    const targetPath = uniquePath(basePath, ".json");
    await writeJsonFile(targetPath, task);
    result.writtenTaskFiles.push({
      taskId: task.id,
      filePath: path.relative(workerRoot, targetPath).replace(/\\/g, "/"),
    });
  }

  const sessionBase = path.join(sessionsDir, `${sanitizeName(plan.featureId)}-session`);
  const sessionPath = uniquePath(sessionBase, ".json");
  await writeJsonFile(sessionPath, sessionConfig);
  result.writtenSessionFile = {
    sessionId: sessionConfig.id,
    filePath: path.relative(workerRoot, sessionPath).replace(/\\/g, "/"),
  };

  log.info("[AutoTasks] Materialization complete", {
    featureId: plan.featureId,
    taskFiles: result.writtenTaskFiles.length,
    sessionFile: result.writtenSessionFile?.filePath,
  });

  return result;
}
