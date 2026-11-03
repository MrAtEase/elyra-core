import { AnalysisResult } from "./analysisStage";

export interface PlanStep {
  id: string;
  action: "edit" | "create" | "delete";
  file: string;
  instructions?: string;
  contentSpec?: string;
}

export interface PlanResult {
  steps: PlanStep[];
  testCommands: string[];
}

export function planningStage(analysis: AnalysisResult): PlanResult {
  const steps: PlanStep[] = [];
  if (analysis.impactedFiles.length > 0) {
    analysis.impactedFiles.forEach((file, idx) => {
      steps.push({
        id: `step-${idx + 1}`,
        action: "edit",
        file,
        instructions: analysis.understanding,
      });
    });
  }
  return {
    steps,
    testCommands: ["npm test"],
  };
}
