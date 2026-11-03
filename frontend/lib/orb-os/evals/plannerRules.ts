export type EvalSample = {
  id: string;
  prompt: string;
  expected_tool: string;
  severity: "high" | "medium" | "low";
};

export function pickToolForPrompt(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("weather") || p.includes("forecast")) return "weather.getForecast";
  if (p.includes("translate") || p.includes("übersetze") || p.includes("translation")) return "translate.text";
  if (p.includes("research") || p.includes("sources") || p.includes("web")) return "web.search_and_summarize";
  if (p.includes("slides") || p.includes("pitch deck")) return "slides.create_presentation";
  if (p.includes("drive")) return "drive.search_files";
  if (p.includes("calendar") || p.includes("meeting")) return "google_calendar.create_event";
  return "web.search";
}

export function evaluateSamples(samples: EvalSample[]) {
  const results = samples.map((sample) => {
    const actual = pickToolForPrompt(sample.prompt);
    const passed = actual === sample.expected_tool;
    return {
      id: sample.id,
      prompt: sample.prompt,
      expected_tool: sample.expected_tool,
      actual_tool: actual,
      passed,
      severity: sample.severity,
    };
  });

  const totals = {
    total: results.length,
    passed: results.filter((entry) => entry.passed).length,
    failed: results.filter((entry) => !entry.passed).length,
    failed_high: results.filter((entry) => !entry.passed && entry.severity === "high").length,
  };

  return { totals, results };
}
