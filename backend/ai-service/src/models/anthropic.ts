import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { ModelResponse } from "./vertex-ai.js";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: config().ANTHROPIC_API_KEY });
  return _client;
}

export async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; attachments?: any[] },
): Promise<ModelResponse> {
  const { ANTHROPIC_MODEL } = config();
  const start = Date.now();

  const response = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  logger.debug({ model: ANTHROPIC_MODEL, durationMs: Date.now() - start }, "anthropic call");

  return {
    text,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
    model: ANTHROPIC_MODEL,
  };
}
