/**
 * Minimal server-side Gemini client (Google AI Studio API key) with model fallback.
 * Tries GEMINI_MODEL first, then GEMINI_FALLBACK_MODELS on overload / unavailable / timeout.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [primary, ...fallbacks].filter((m, i, a) => a.indexOf(m) === i);
}

export async function callGeminiText(input: {
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // Each model gets one quick retry on 503/429 (Google capacity spikes are often seconds long).
  const attempts = modelChain().flatMap((model) => [model, model]);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const model = attempts[attempt]!;
    const isRetry = attempt > 0 && attempts[attempt - 1] === model;
    if (isRetry) await new Promise((resolve) => setTimeout(resolve, 1500));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
    try {
      const resp = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            temperature: input.temperature ?? 0.4,
            maxOutputTokens: input.maxOutputTokens ?? 4096,
            ...(input.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      if (!resp.ok || data.error) {
        const err = new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return { text, model };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      const retriable = status === 404 || status === 429 || status === 503 || (err as Error).name === "AbortError";
      console.warn(`[geminiDirect] ${model} failed${retriable ? ", retrying" : ""}:`, (err as Error).message);
      if (!retriable) break;
      // 404 (model unavailable) and timeouts: don't retry the same model, jump to the next one.
      if ((status === 404 || (err as Error).name === "AbortError") && !isRetry) attempt++;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini request failed");
}
