import { analysisStage } from "./analysisStage";
import { planningStage } from "./planningStage";
import { executionStage } from "./executionStage";
import { testStage } from "./testStage";
import { fixStage } from "./fixStage";

export interface ReasoningResult {
  success: boolean;
  iterations: number;
  analysis: Awaited<ReturnType<typeof analysisStage>>;
  plan: ReturnType<typeof planningStage>;
  execution?: Awaited<ReturnType<typeof executionStage>>;
  tests?: Awaited<ReturnType<typeof testStage>>;
  fixes?: Awaited<ReturnType<typeof fixStage>>;
}

export async function runReasoningEngine(
  projectRoot: string,
  taskDescription: string,
  options: { apply: boolean; safetyLevel?: string }
): Promise<ReasoningResult> {
  const analysis = await analysisStage(projectRoot, taskDescription);
  const plan = planningStage(analysis);
  let execution = await executionStage(projectRoot, plan, {
    apply: options.apply,
    safetyLevel: options.safetyLevel,
  });
  let tests = await testStage(projectRoot, plan.testCommands);

  let iterations = 1;
  let success = !execution.failedStep && tests.passed;
  let fixes;

  if (!success && iterations < 3) {
    fixes = await fixStage(projectRoot, plan, plan.testCommands, {
      apply: options.apply,
      safetyLevel: options.safetyLevel,
    });
    execution = fixes.execution || execution;
    tests = fixes.tests || tests;
    iterations += 1;
    success = fixes.success;
  }

  return {
    success,
    iterations,
    analysis,
    plan,
    execution,
    tests,
    fixes,
  };
}
