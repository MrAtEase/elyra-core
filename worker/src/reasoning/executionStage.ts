import { PlanResult } from "./planningStage";
import { DevTask } from "../devTaskTypes";
import { runSingleFileEditTask } from "../devTaskRunner";

export interface ExecutionResult {
  executedSteps: Array<{ id: string; status: string; error?: string }>;
  failedStep?: { id: string; error: string };
}

export async function executionStage(
  projectRoot: string,
  plan: PlanResult,
  options: { apply: boolean; safetyLevel?: string }
): Promise<ExecutionResult> {
  const executedSteps: ExecutionResult["executedSteps"] = [];
  for (const step of plan.steps) {
    if (step.action !== "edit") {
      executedSteps.push({ id: step.id, status: "skipped" });
      continue;
    }
    const task: DevTask = {
      id: step.id,
      goal: step.instructions || "Apply planned edit",
      mode: "refactor",
      projectRoot,
      target: { file: step.file },
      writeMode: options.apply ? "apply" : "preview",
      safetyLevel: (options.safetyLevel as any) || "basic",
    };
    try {
      const result = await runSingleFileEditTask(projectRoot, task, {
        writeMode: task.writeMode,
        safetyLevel: task.safetyLevel as any,
      });
      executedSteps.push({ id: step.id, status: result.status, error: result.errorMessage });
      if (result.status === "failed") {
        return { executedSteps, failedStep: { id: step.id, error: result.errorMessage || "failed" } };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      executedSteps.push({ id: step.id, status: "failed", error: message });
      return { executedSteps, failedStep: { id: step.id, error: message } };
    }
  }
  return { executedSteps };
}
