import path from "node:path";
import { analyzeProject } from "./analyzer/analyzerService";
import { DevTask, ApplyMode, WriteMode, SafetyLevel } from "./devTaskTypes";
import { createLogger } from "./logger";

const log = createLogger("FeaturePlanner");

type PlanStep = {
  id: string;
  label: string;
  file: string;
  action: "edit" | "create";
  instructions: string;
};

export interface PlannerResult {
  plan: PlanStep[];
  tasks: DevTask[];
  reasoning: string;
}

function buildPlan(description: string, files: string[]): PlanStep[] {
  const targetFiles = files.slice(0, 3);
  if (targetFiles.length === 0) {
    targetFiles.push("README.md");
  }
  return targetFiles.map((file, idx) => ({
    id: `plan-step-${idx + 1}`,
    label: `Update ${file}`,
    file,
    action: "edit",
    instructions: description.slice(0, 200),
  }));
}

export async function runFeaturePlanner(input: {
  requestText: string;
  projectRoot: string;
  safetyLevel?: SafetyLevel;
  previewOnly?: boolean;
}): Promise<PlannerResult> {
  const normalizedRoot = path.resolve(input.projectRoot);
  const analysis = await analyzeProject(normalizedRoot).catch(() => null);
  const files = (analysis?.files || []).map((f) => f.path).slice(0, 30);
  const plan = buildPlan(input.requestText, files);
  const tasks: DevTask[] = plan.map((step) => ({
    id: step.id,
    goal: `${step.label}: ${step.instructions}`,
    mode: "feature",
    projectRoot: normalizedRoot,
    target: { file: step.file },
    applyMode: (input.previewOnly ? "preview" : "apply") as ApplyMode,
    writeMode: (input.previewOnly ? "preview" : "apply") as WriteMode,
    safetyLevel: input.safetyLevel || "strict",
  }));

  const reasoning = `Planned ${plan.length} steps for request: ${input.requestText}`;
  log.info("[Planner] Plan created with steps:", plan.length);
  return {
    plan,
    tasks,
    reasoning,
  };
}
