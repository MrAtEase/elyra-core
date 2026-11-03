import { FeaturePlan, FeaturePlanStep, FeatureSpec } from "../devTaskTypes";

export async function planFeature(input: { spec: FeatureSpec; projectRoot: string }): Promise<FeaturePlan> {
  const steps: FeaturePlanStep[] = [];

  steps.push({
    id: "analysis-1",
    label: "Analyze existing app structure",
    kind: "analysis",
    targetFiles: ["frontend/app"],
  });

  steps.push({
    id: "code-1",
    label: "Implement feature changes",
    kind: "code",
    targetFiles: ["frontend/app/page.tsx"],
    sessionConfig: {
      id: "feature-code-1",
      projectRoot: input.spec.dependencies?.[0] || input.projectRoot,
      mode: "feature",
      target: { file: "frontend/app/page.tsx" },
      goal: `${input.spec.title} - ${input.spec.description.slice(0, 120)}`,
    },
  });

  steps.push({
    id: "test-1",
    label: "Run tests",
    kind: "test",
    targetFiles: [],
  });

  return {
    featureId: input.spec.id,
    spec: input.spec,
    steps,
  };
}
