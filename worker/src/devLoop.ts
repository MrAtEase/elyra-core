import { runSessionWithConfig } from "./sessionRunner";
import { runFeaturePlanner } from "./featurePlanner";
import { runCommand } from "./commandRunner";
import { createLogger } from "./logger";
import { DevTask, ApplyMode, WriteMode, SafetyLevel } from "./devTaskTypes";

const log = createLogger("DevLoop");

export interface DevLoopRequest {
  requestText: string;
  projectRoot: string;
  previewOnly?: boolean;
  safetyLevel?: SafetyLevel;
}

export interface DevLoopResult {
  status: "ok" | "failed";
  plan?: unknown;
  tasks?: DevTask[];
  sessionConfig?: unknown;
  initialPreview?: unknown;
  finalResult?: unknown;
  tests?: Array<{ command: string; exitCode: number | null; stdout: string; stderr: string }>;
  fixAttempts?: Array<{ attempt: number; result: unknown }>;
  error?: string;
}

async function runTests(projectRoot: string): Promise<DevLoopResult["tests"]> {
  const commands: Array<[string, string[]]> = [
    ["npm", ["run", "type-check"]],
    ["npm", ["run", "lint"]],
    ["npm", ["test"]],
  ];
  const results: DevLoopResult["tests"] = [];
  for (const [cmd, args] of commands) {
    try {
      const r = await runCommand(projectRoot, cmd, args);
      results?.push({
        command: `${cmd} ${args.join(" ")}`,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
      });
    } catch (err) {
      results?.push({
        command: `${cmd} ${args.join(" ")}`,
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function runDevLoop(request: DevLoopRequest): Promise<DevLoopResult> {
  try {
    log.info("[DevLoop] planning feature for request:", request.requestText);
    const planner = await runFeaturePlanner({
      requestText: request.requestText,
      projectRoot: request.projectRoot,
      previewOnly: request.previewOnly === true,
      safetyLevel: request.safetyLevel || "strict",
    });

    const tasks = planner.tasks as DevTask[];
    const sessionConfig = {
      id: `devloop-${Date.now()}`,
      projectRoot: request.projectRoot,
      applyMode: request.previewOnly ? ("preview" as ApplyMode) : ("apply" as ApplyMode),
      writeMode: request.previewOnly ? ("preview" as WriteMode) : ("apply" as WriteMode),
      safetyLevel: request.safetyLevel || "strict",
      tasks,
    };

    log.info("[DevLoop] Running preview session...");
    const initialPreview = await runSessionWithConfig(sessionConfig, {
      repoRoot: request.projectRoot,
      writeMode: "preview",
      safetyLevel: request.safetyLevel,
    });
    if (initialPreview.blocked) {
      return {
        status: "failed",
        plan: planner.plan,
        tasks,
        sessionConfig,
        initialPreview,
        error: "Preview blocked by safety.",
      };
    }

    let finalResult = initialPreview;
    if (!request.previewOnly) {
      log.info("[DevLoop] Running apply session...");
      finalResult = await runSessionWithConfig(
        { ...sessionConfig, applyMode: "apply", writeMode: "apply" },
        { repoRoot: request.projectRoot, writeMode: "apply", safetyLevel: request.safetyLevel }
      );
    }

    log.info("[DevLoop] Running tests...");
    const tests = await runTests(request.projectRoot);

    return {
      status: "ok",
      plan: planner.plan,
      tasks,
      sessionConfig,
      initialPreview,
      finalResult,
      tests,
      fixAttempts: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[DevLoop] failed:", error);
    return { status: "failed", error: message };
  }
}
