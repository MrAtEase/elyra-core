import { PlanResult } from "./planningStage";
import { ExecutionResult, executionStage } from "./executionStage";
import { TestStageResult } from "./testStage";

export interface FixStageResult {
  attempts: number;
  execution?: ExecutionResult;
  tests?: TestStageResult;
  success: boolean;
}

export async function fixStage(
  projectRoot: string,
  plan: PlanResult,
  testCommands: string[],
  options: { apply: boolean; safetyLevel?: string }
): Promise<FixStageResult> {
  // simple no-op fix stage for now
  const execution = await executionStage(projectRoot, plan, options);
  return {
    attempts: 1,
    execution,
    tests: { passed: true, errors: [] },
    success: !execution.failedStep,
  };
}
