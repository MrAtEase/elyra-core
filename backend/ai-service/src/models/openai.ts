import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { ModelResponse } from "./vertex-ai.js";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: config().OPENAI_API_KEY });
  return _client;
}

export async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; attachments?: any[] },
): Promise<ModelResponse> {
  const { OPENAI_MODEL } = config();
  const start = Date.now();

  const response = await getClient().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";

  logger.debug({ model: OPENAI_MODEL, durationMs: Date.now() - start }, "openai call");

  return {
    text,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    model: OPENAI_MODEL,
  };
}
