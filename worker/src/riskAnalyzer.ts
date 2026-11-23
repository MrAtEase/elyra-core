import { CheckResult, RiskLevel } from "./devTaskTypes";

export interface RiskAnalysisInput {
  diffLines: number;
  fileCount: number;
  checks: CheckResult[];
}

export interface RiskAnalysisResult {
  level: RiskLevel;
  reason: string;
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "unknown"];
  const idxA = order.indexOf(a);
  const idxB = order.indexOf(b);
  return order[Math.max(idxA, idxB)] || "unknown";
}

export function analyzeRisk(input: RiskAnalysisInput): RiskAnalysisResult {
  const { diffLines, fileCount, checks } = input;

  if (!checks || checks.length === 0) {
    return { level: "unknown", reason: "No checks configured" };
  }

  let level: RiskLevel = "low";
  let reason = "All checks passed and changes are small";

  const failedChecks = checks.filter(
    (c) => c.status === "failed" || c.status === "error"
  );

  if (failedChecks.length >= 1) {
    level = maxRisk(level, "medium");
    reason = `Checks failed: ${failedChecks.map((c) => c.name).join(", ")}`;
  }
  if (failedChecks.length >= 2) {
    level = "high";
    reason = `Multiple checks failed: ${failedChecks.map((c) => c.name).join(", ")}`;
  }

  if (diffLines > 500 || fileCount > 20) {
    level = "high";
    reason = `Large change (${diffLines} lines, ${fileCount} files)`;
  } else if (diffLines > 200 || fileCount > 10) {
    level = maxRisk(level, "medium");
    reason = `Moderate change (${diffLines} lines, ${fileCount} files)`;
  }

  return { level, reason };
}
