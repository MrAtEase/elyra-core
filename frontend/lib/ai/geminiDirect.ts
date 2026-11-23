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
  /** ground the answer with Google Search (cannot be combined with json) */
  googleSearch?: boolean;
  /** model chosen in Workspace Admin › AI – tried first */
  preferredModel?: string | null;
}): Promise<{ text: string; model: string; sources: Array<{ title: string; uri: string }> }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // Each model gets one quick retry on 503/429 (Google capacity spikes are often seconds long).
  const chain = modelChain();
  const ordered = input.preferredModel ? [input.preferredModel, ...chain.filter((m) => m !== input.preferredModel)] : chain;
  const attempts = ordered.flatMap((model) => [model, model]);
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
          ...(input.googleSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            temperature: input.temperature ?? 0.4,
            maxOutputTokens: input.maxOutputTokens ?? 4096,
            ...(input.json && !input.googleSearch ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
        }>;
        error?: { message?: string };
      };
      if (!resp.ok || data.error) {
        const err = new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .flatMap((c) => (c.web?.uri ? [{ uri: c.web.uri, title: c.web.title ?? c.web.uri }] : []))
        .filter((src, i, arr) => arr.findIndex((x) => x.uri === src.uri) === i)
        .slice(0, 12);
      return { text, model, sources };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      // With Google Search grounding, some models answer 400 (tool unsupported) – try the next model.
      const retriable = status === 404 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || (err as Error).name === "AbortError" || (Boolean(input.googleSearch) && status === 400);
      console.warn(`[geminiDirect] ${model} failed${retriable ? ", retrying" : ""}:`, (err as Error).message);
      if (!retriable) break;
      // 404 (model unavailable) and timeouts: don't retry the same model, jump to the next one.
      if ((status === 404 || status === 400 || (err as Error).name === "AbortError") && !isRetry) attempt++;
    } finally {
      clearTimeout(timer);
    }
  }
  const lastStatus = (lastError as { status?: number } | null)?.status ?? 0;
  if (lastStatus >= 500 || lastStatus === 429) {
    // Provider hiccup ("Internal error encountered." etc.): give users a clear, actionable message.
    const friendly = new Error("Der KI-Dienst ist gerade überlastet. Bitte in einer Minute noch einmal versuchen.") as Error & { status?: number };
    friendly.status = lastStatus;
    throw friendly;
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini request failed");
}
