import type { PlanStep } from "../types/plan.js";
import { executeTool } from "../tools/registry.js";
import { logger } from "../lib/logger.js";

export type StepResult = {
  output: Record<string, unknown>;
  error?: string;
};

export async function executeStep(
  step: PlanStep,
  workspaceId: string,
): Promise<StepResult> {
  try {
    const output = await executeTool(step.toolName, step.input, workspaceId);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      const msg = "Tool returned invalid response shape";
      logger.error({ toolName: step.toolName, workspaceId, output }, "Invalid tool output");
      return { output: {}, error: msg };
    }
    return { output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ toolName: step.toolName, err }, "Step execution failed");
    return { output: {}, error: message };
  }
}
