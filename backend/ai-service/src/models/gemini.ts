import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { ModelResponse } from "./vertex-ai.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResult = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

async function callOnce(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  json: boolean,
): Promise<ModelResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const resp = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    const data = (await resp.json().catch(() => ({}))) as GeminiResult;
    if (!resp.ok || data.error) {
      const err = new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return {
      text,
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gemini via direct API key (Google AI Studio).
 * Tries GEMINI_MODEL first; on overload (429/503) or timeout falls back to GEMINI_FALLBACK_MODEL.
 */
export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; attachments?: any[] },
): Promise<ModelResponse> {
  const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL } = config();
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODEL.split(",").map((m) => m.trim())]
    .filter((m, i, a) => m && a.indexOf(m) === i);
  // One quick retry per model on 503/429 (capacity spikes), then the next model.
  const attempts = models.flatMap((model) => [model, model]);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const model = attempts[attempt]!;
    const isRetry = attempt > 0 && attempts[attempt - 1] === model;
    if (isRetry) await new Promise((resolve) => setTimeout(resolve, 1500));
    const start = Date.now();
    try {
      const res = await callOnce(model, GEMINI_API_KEY, systemPrompt, userMessage, !!options?.json);
      logger.debug({ model, durationMs: Date.now() - start }, "gemini call");
      return res;
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      // 404 = model not available for this key → also try the next one
      const retriable = status === 404 || status === 429 || status === 503 || (err as Error).name === "AbortError";
      logger.warn({ model, status, err: (err as Error).message }, "gemini call failed");
      if (!retriable) break;
      if ((status === 404 || (err as Error).name === "AbortError") && !isRetry) attempt++;
    }
  }
  throw lastError;
}
