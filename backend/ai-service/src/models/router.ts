import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { callVertexAI, type ModelResponse } from "./vertex-ai.js";
import { callAnthropic } from "./anthropic.js";
import { callOpenAI } from "./openai.js";

type Provider = "vertex" | "anthropic" | "openai";

type CallFn = (system: string, user: string, opts?: { json?: boolean; attachments?: any[] }) => Promise<ModelResponse>;

function getProviderChain(): Array<{ name: Provider; call: CallFn; available: boolean }> {
  const env = config();
  return [
    { name: "vertex", call: callVertexAI, available: !!env.GCP_PROJECT_ID },
    { name: "anthropic", call: callAnthropic, available: !!env.ANTHROPIC_API_KEY },
    { name: "openai", call: callOpenAI, available: !!env.OPENAI_API_KEY },
  ];
}

export async function callModel(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; preferredProvider?: Provider; attachments?: any[] },
): Promise<ModelResponse> {
  const chain = getProviderChain().filter((p) => p.available);

  if (options?.preferredProvider) {
    const preferred = chain.find((p) => p.name === options.preferredProvider);
    if (preferred) {
      // Move preferred to front
      const rest = chain.filter((p) => p.name !== options.preferredProvider);
      chain.length = 0;
      chain.push(preferred, ...rest);
    }
  }

  if (chain.length === 0) {
    throw new Error("No AI model providers configured");
  }

  let lastError: unknown;
  for (const provider of chain) {
    try {
      return await provider.call(systemPrompt, userMessage, options);
    } catch (err) {
      lastError = err;
      logger.warn({ provider: provider.name, err }, "Model call failed, trying fallback");
    }
  }

  throw lastError;
}
