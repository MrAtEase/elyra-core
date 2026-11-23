import { FeaturePlan, FeatureExecutionResult, FeatureSpec } from "../devTaskTypes";
import { buildFeatureSpec } from "./featureSpecBuilder";
import { planFeature } from "./featurePlanner";
import { executeFeaturePlan } from "./featureExecutor";
import { createLogger } from "../logger";

export type RunFeatureRequest = {
  description: string;
  projectRoot: string;
  writeMode: "preview" | "apply";
  safetyLevel?: "basic" | "strict";
  git?: import("../devTaskTypes").GitOptions;
};

export type RunFeatureResponse = {
  spec: FeatureSpec;
  plan: FeaturePlan;
  execution: FeatureExecutionResult;
};

const log = createLogger("FeatureOrchestrator");

export async function runFeature(input: RunFeatureRequest): Promise<RunFeatureResponse> {
  log.info("[FeatureOrchestrator] Building spec...");
  const spec = await buildFeatureSpec({ description: input.description, projectRoot: input.projectRoot });
  log.info("[FeatureOrchestrator] Planning feature...");
  const plan = await planFeature({ spec, projectRoot: input.projectRoot });
  log.info("[FeatureOrchestrator] Executing plan...");
  const execution = await executeFeaturePlan({
    plan,
    projectRoot: input.projectRoot,
    writeMode: input.writeMode,
    safetyLevel: input.safetyLevel,
    git: input.git,
  });
  return { spec, plan, execution };
}
