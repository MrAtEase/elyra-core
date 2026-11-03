import { analyzeProject } from "../analyzer/analyzerService";

export interface AnalysisResult {
  understanding: string;
  impactedFiles: string[];
  risks: string[];
  missingPieces: string[];
}

export async function analysisStage(projectRoot: string, taskDescription: string): Promise<AnalysisResult> {
  await analyzeProject(projectRoot).catch(() => null);
  return {
    understanding: `Task: ${taskDescription}`,
    impactedFiles: [],
    risks: ["unknown"],
    missingPieces: [],
  };
}
