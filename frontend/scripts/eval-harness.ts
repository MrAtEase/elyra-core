import fs from "node:fs/promises";
import path from "node:path";
import { evaluateSamples, type EvalSample } from "@/lib/orb-os/evals/plannerRules";

async function main() {
  const filePath = path.resolve(process.cwd(), "evals/golden-prompts.json");
  const raw = await fs.readFile(filePath, "utf8");
  const samples = JSON.parse(raw) as EvalSample[];
  const outcome = evaluateSamples(samples);

  const passRate = outcome.totals.total === 0 ? 1 : outcome.totals.passed / outcome.totals.total;
  const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE || "0.9");
  const allowHighSeverityFailures = Number(process.env.EVAL_MAX_HIGH_FAIL || "0");

  console.log("[eval] totals", outcome.totals);

  if (outcome.totals.failed_high > allowHighSeverityFailures) {
    console.error(`[eval] failed: high severity failures ${outcome.totals.failed_high} > ${allowHighSeverityFailures}`);
    process.exit(1);
  }

  if (passRate < minPassRate) {
    console.error(`[eval] failed: pass rate ${passRate.toFixed(3)} < ${minPassRate.toFixed(3)}`);
    process.exit(1);
  }

  console.log(`[eval] passed: pass rate ${passRate.toFixed(3)} >= ${minPassRate.toFixed(3)}`);
}

main().catch((error) => {
  console.error("[eval] runner failed", error);
  process.exit(1);
});
