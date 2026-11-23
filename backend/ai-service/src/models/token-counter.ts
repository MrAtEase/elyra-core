/** Cost per 1M tokens (USD) by model — updated Feb 2026 */
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash": { input: 0.075, output: 0.30 },
  "gemini-2.0-pro": { input: 1.25, output: 5.00 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = PRICING[model] ?? { input: 1.0, output: 3.0 };
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}
