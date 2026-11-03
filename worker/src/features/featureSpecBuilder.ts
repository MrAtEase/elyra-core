import { FeatureSpec } from "../devTaskTypes";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "feature";
}

export async function buildFeatureSpec(input: { description: string; projectRoot: string }): Promise<FeatureSpec> {
  const title = input.description.split("\n")[0].slice(0, 80);
  const acceptanceCriteria = [
    `Implement described feature: ${title}`,
    "Code builds without TypeScript errors.",
    "Existing tests pass (or updated accordingly).",
  ];
  const spec: FeatureSpec = {
    id: `feature-${slugify(title)}-${Date.now()}`,
    title,
    description: input.description,
    acceptanceCriteria,
    risks: ["unknown impact", "potential regressions"],
    dependencies: [],
    notes: [],
  };
  return spec;
}
