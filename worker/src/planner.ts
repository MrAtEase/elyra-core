import { getProjectGraph, ProjectGraph } from "./projectGraph";
import {
  DevTaskSuggestion,
  PlanFileImpact,
  PlanInput,
  PlanResult,
  PlanScope,
  PlanStep,
} from "./devTaskTypes";
import { createLogger } from "./logger";

const log = createLogger("Planner");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "feature";
}

function deriveScope(description: string, inputScope?: PlanScope): PlanScope {
  if (inputScope) return inputScope;
  const lower = description.toLowerCase();
  if (/\bapi\b|\bbackend\b|server/.test(lower)) return "backend";
  if (/\bworker\b|\bcli\b/.test(lower)) return "worker";
  if (/\bfullstack\b/.test(lower)) return "fullstack";
  return "frontend";
}

function keywordsFromDescription(description: string): string[] {
  return description
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 2)
    .slice(0, 25)
    .map((w) => w.toLowerCase());
}

function scoreFile(file: { path: string; exports: { name: string }[]; imports: { source: string; specifiers: string[] }[] }, keywords: string[]) {
  let score = 0;
  const lowerPath = file.path.toLowerCase();
  for (const kw of keywords) {
    if (lowerPath.includes(kw)) score += 2;
    if (file.exports.some((s) => s.name.toLowerCase().includes(kw))) score += 3;
    if (
      file.imports.some(
        (imp) => imp.source.toLowerCase().includes(kw) || imp.specifiers.some((s) => s.toLowerCase().includes(kw))
      )
    ) {
      score += 1;
    }
  }
  return score;
}

function selectImpacts(
  graph: ProjectGraph,
  keywords: string[],
  maxItems = 12
): { impacts: PlanFileImpact[]; matchedSymbols: number } {
  const withScores = graph.files
    .map((file) => ({
      file,
      score: scoreFile(file, keywords),
      matchedSymbols: file.exports.filter((s) => keywords.some((kw) => s.name.toLowerCase().includes(kw))).length,
    }))
    .filter((item) => item.score > 0);

  const sorted = withScores.sort((a, b) => b.score - a.score).slice(0, maxItems);
  const impacts: PlanFileImpact[] = [];
  let matchedSymbols = 0;

  for (const item of sorted) {
    matchedSymbols += item.matchedSymbols;
    impacts.push({
      filePath: item.file.path,
      reason: `Matches keywords: ${keywords.filter((kw) => item.file.path.toLowerCase().includes(kw)).join(", ")}`,
      kind: item.file.kind === "other" ? "inspect" : "update",
      confidence: item.score >= 6 ? "high" : item.score >= 3 ? "medium" : "low",
    });
  }

  return { impacts, matchedSymbols };
}

function buildSteps(impacts: PlanFileImpact[], description: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const grouped = impacts.slice(0, 9);

  const analyzeStep: PlanStep = {
    id: "step-1",
    title: "Analyse bestehende Struktur",
    description: "Prüfe relevante Dateien und bestehende Komponenten, um das Feature einzuordnen.",
    files: grouped.slice(0, 3).map((f) => ({ ...f, kind: "inspect" })),
    dependsOn: [],
  };
  steps.push(analyzeStep);

  const buildStep: PlanStep = {
    id: "step-2",
    title: "Feature implementieren",
    description: description.slice(0, 160),
    files: grouped.slice(0, 5),
    dependsOn: ["step-1"],
  };
  steps.push(buildStep);

  const testStep: PlanStep = {
    id: "step-3",
    title: "Tests & Verifikation",
    description: "Type-Check, Linting und Basistests ausführen.",
    files: grouped.slice(0, 2),
    dependsOn: ["step-2"],
  };
  steps.push(testStep);

  return steps;
}

function buildTaskSuggestions(steps: PlanStep[], scope: PlanScope): DevTaskSuggestion[] {
  const mode: DevTaskSuggestion["mode"] = scope === "frontend" ? "feature" : scope === "backend" ? "fix" : "refactor";
  const suggestions: DevTaskSuggestion[] = [];
  steps.forEach((step, idx) => {
    if (!step.files?.length) return;
    const targetFiles = step.files.slice(0, 3).map((f) => f.filePath);
    suggestions.push({
      id: `task-${idx + 1}`,
      title: step.title,
      mode,
      targetFiles,
      goal: step.description,
      suggestedSessionId: undefined,
    });
  });
  return suggestions;
}

export async function generatePlan(projectRoot: string, input: PlanInput): Promise<PlanResult> {
  const graph = await getProjectGraph(projectRoot);
  const scope = deriveScope(input.description, input.scope);
  const keywords = keywordsFromDescription(input.description);
  const { impacts, matchedSymbols } = selectImpacts(graph, keywords);
  const steps = buildSteps(impacts, input.description);
  const tasks = buildTaskSuggestions(steps, scope);
  const relatedFiles = Array.from(new Set(impacts.map((i) => i.filePath)));

  const plan: PlanResult = {
    featureId: input.featureId || `feature-${slugify(input.description)}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    scope,
    steps,
    tasks,
    relatedFiles,
    graphSummary: {
      inspectedFiles: graph.files.length,
      matchedFiles: impacts.length,
      matchedSymbols,
    },
  };

  log.info("[Planner] Generated plan", {
    featureId: plan.featureId,
    steps: plan.steps.length,
    tasks: plan.tasks.length,
    matchedFiles: impacts.length,
  });

  return plan;
}
