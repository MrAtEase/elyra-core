import {
  translateTextInputSchema,
  translateTextOutputSchema,
  weatherForecastInputSchema,
  weatherForecastOutputSchema,
  webExtractInputSchema,
  webExtractOutputSchema,
  webFetchInputSchema,
  webFetchOutputSchema,
  webSearchInputSchema,
  webSearchOutputSchema,
  webSummarizeInputSchema,
  webSummarizeOutputSchema,
  toolCatalogMeta,
} from "@/lib/orb-os/tools/schemas";

export type RunnableToolName =
  | "web.search"
  | "web.fetch"
  | "web.extract"
  | "web.summarize"
  | "weather.getForecast"
  | "translate.text";

type AdapterContext = {
  workspaceId: string;
  toolName: RunnableToolName;
  args: Record<string, unknown>;
  signal: AbortSignal;
};

type CacheEntry = {
  expiresAt: number;
  value: Record<string, unknown>;
};

type RateCounter = {
  windowStartMinute: number;
  count: number;
};

const cacheStore = new Map<string, CacheEntry>();
const rateStore = new Map<string, RateCounter>();

function minuteNow() {
  return Math.floor(Date.now() / 60000);
}

function toolMeta(toolName: RunnableToolName) {
  const meta = toolCatalogMeta[toolName];
  if (!meta) {
    return { rate_limit_per_minute: 10, cache_ttl_seconds: 0 };
  }
  return {
    rate_limit_per_minute: meta.rate_limit_per_minute,
    cache_ttl_seconds: meta.cache_ttl_seconds,
  };
}

function cacheKey(input: { workspaceId: string; toolName: RunnableToolName; args: Record<string, unknown> }) {
  return `${input.workspaceId}:${input.toolName}:${JSON.stringify(input.args)}`;
}

function enforceRateLimit(workspaceId: string, toolName: RunnableToolName) {
  const meta = toolMeta(toolName);
  const key = `${workspaceId}:${toolName}`;
  const nowMinute = minuteNow();
  const current = rateStore.get(key);
  if (!current || current.windowStartMinute !== nowMinute) {
    rateStore.set(key, { windowStartMinute: nowMinute, count: 1 });
    return;
  }

  if (current.count >= meta.rate_limit_per_minute) {
    throw new RunnableToolError({
      code: "TOOL_RATE_LIMITED",
      safeMessage: `Rate limit exceeded for ${toolName}. Please retry in a minute.`,
      status: 429,
      retryable: true,
    });
  }

  current.count += 1;
  rateStore.set(key, current);
}

function getCached(workspaceId: string, toolName: RunnableToolName, args: Record<string, unknown>) {
  const key = cacheKey({ workspaceId, toolName, args });
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(workspaceId: string, toolName: RunnableToolName, args: Record<string, unknown>, value: Record<string, unknown>) {
  const ttlSeconds = toolMeta(toolName).cache_ttl_seconds;
  if (ttlSeconds <= 0) return;
  const key = cacheKey({ workspaceId, toolName, args });
  cacheStore.set(key, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value,
  });
}

type SafeFetchOptions = {
  timeoutMs?: number;
  signal: AbortSignal;
  init?: RequestInit;
};

async function safeFetch(url: string, options: SafeFetchOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  const onAbort = () => controller.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...(options.init ?? {}),
      signal: controller.signal,
      headers: {
        "user-agent": "Elyra-Tools/1.0",
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        ...(options.init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new RunnableToolError({
        code: "TOOL_EXECUTION_FAILED",
        safeMessage: `Upstream service returned ${response.status}`,
        status: 502,
        retryable: response.status >= 500,
      });
    }

    return response;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new RunnableToolError({
        code: "TOOL_TIMEOUT",
        safeMessage: "Request timed out. Please retry.",
        status: 504,
        retryable: true,
      });
    }
    if (error instanceof RunnableToolError) throw error;
    throw new RunnableToolError({
      code: "TOOL_EXECUTION_FAILED",
      safeMessage: "External service request failed.",
      status: 502,
      retryable: true,
      details: error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickSentences(text: string, count: number) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return sentences.slice(0, Math.max(1, count));
}

function summarizeText(text: string, maxWords: number) {
  const sentences = pickSentences(text, 4);
  const joined = sentences.join(" ");
  const words = joined.split(/\s+/);
  if (words.length <= maxWords) return joined;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function normalizeCitations(input: Array<{ title?: string; url?: string; snippet?: string }>) {
  return input
    .filter((entry) => typeof entry.url === "string" && entry.url.length > 0)
    .map((entry) => ({
      title: entry.title?.trim() || "Source",
      url: entry.url as string,
      snippet: (entry.snippet?.trim() || "Source excerpt").slice(0, 280),
      published_at: null,
    }));
}

export class RunnableToolError extends Error {
  readonly code: "TOOL_TIMEOUT" | "TOOL_EXECUTION_FAILED" | "TOOL_RATE_LIMITED" | "INVALID_ARGS";
  readonly safeMessage: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: {
    code: "TOOL_TIMEOUT" | "TOOL_EXECUTION_FAILED" | "TOOL_RATE_LIMITED" | "INVALID_ARGS";
    safeMessage: string;
    status: number;
    retryable: boolean;
    details?: unknown;
  }) {
    super(input.safeMessage);
    this.code = input.code;
    this.safeMessage = input.safeMessage;
    this.status = input.status;
    this.retryable = input.retryable;
    this.details = input.details;
  }
}

async function runWebSearch(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = webSearchInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid search args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "web.search", input.data);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: input.data.query,
    format: "json",
    no_redirect: "1",
    no_html: "1",
    skip_disambig: "1",
  });

  const response = await safeFetch(`https://api.duckduckgo.com/?${params.toString()}`, {
    signal: ctx.signal,
    timeoutMs: 9000,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    Heading?: string;
    AbstractURL?: string;
    AbstractText?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  };

  const related = (payload.RelatedTopics ?? []).flatMap((entry) => {
    if ("Topics" in entry && Array.isArray(entry.Topics)) {
      return entry.Topics.map((topic) => ({
        title: (topic.Text ?? "Result").split(" - ")[0] ?? "Result",
        url: topic.FirstURL ?? "",
        source: "duckduckgo",
        snippet: topic.Text ?? "",
      }));
    }
    const leaf = entry as { Text?: string; FirstURL?: string };
    return [{
      title: (leaf.Text ?? "Result").split(" - ")[0] ?? "Result",
      url: leaf.FirstURL ?? "",
      source: "duckduckgo",
      snippet: leaf.Text ?? "",
    }];
  });

  const seeded = payload.AbstractURL
    ? [{ title: payload.Heading ?? input.data.query, url: payload.AbstractURL, source: "duckduckgo", snippet: payload.AbstractText ?? "" }]
    : [];

  const results = [...seeded, ...related]
    .filter((entry) => entry.url.startsWith("http"))
    .slice(0, input.data.max_results);

  const output = webSearchOutputSchema.parse({ results });
  setCached(ctx.workspaceId, "web.search", input.data, output);
  return output;
}

async function runWebFetch(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = webFetchInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid fetch args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "web.fetch", input.data);
  if (cached) return cached;

  const response = await safeFetch(input.data.url, {
    signal: ctx.signal,
    timeoutMs: input.data.timeout_ms,
  });

  const html = await response.text();
  const output = webFetchOutputSchema.parse({
    url: input.data.url,
    status: response.status,
    content_type: response.headers.get("content-type") ?? "text/html",
    html: html.slice(0, 250_000),
  });

  setCached(ctx.workspaceId, "web.fetch", input.data, output);
  return output;
}

async function runWebExtract(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = webExtractInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid extract args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "web.extract", input.data);
  if (cached) return cached;

  const titleMatch = input.data.html.match(/<title[^>]*>(.*?)<\/title>/i);
  const plain = stripHtml(input.data.html);
  const text = plain.slice(0, 12_000);

  const keyPoints =
    input.data.mode === "facts"
      ? pickSentences(text, 6).map((sentence) => sentence.replace(/\s+/g, " ").trim())
      : input.data.mode === "bullets"
        ? pickSentences(text, 8).map((sentence) => sentence.replace(/\s+/g, " ").trim())
        : pickSentences(text, 4).map((sentence) => sentence.replace(/\s+/g, " ").trim());

  const output = webExtractOutputSchema.parse({
    title: titleMatch?.[1]?.trim() || null,
    text,
    key_points: keyPoints,
  });

  setCached(ctx.workspaceId, "web.extract", input.data, output);
  return output;
}

async function runWebSummarize(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = webSummarizeInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid summarize args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "web.summarize", input.data);
  if (cached) return cached;

  const body = input.data.extracted_docs
    .map((doc) => `${doc.title ?? "Source"}\n${doc.text}`)
    .join("\n\n")
    .slice(0, 30_000);
  const summary = summarizeText(body, input.data.max_words);

  const citations = input.data.include_citations
    ? normalizeCitations(
        input.data.extracted_docs.map((doc) => ({
          title: doc.title ?? "Source",
          url: doc.url,
          snippet: summarizeText(doc.text, 28),
        })),
      )
    : [];

  const output = webSummarizeOutputSchema.parse({
    summary,
    citations,
  });
  setCached(ctx.workspaceId, "web.summarize", input.data, output);
  return output;
}

async function geocode(location: string, signal: AbortSignal) {
  const response = await safeFetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`, {
    signal,
    timeoutMs: 8000,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    results?: Array<{ latitude: number; longitude: number; name: string; country?: string }>;
  };

  const first = payload.results?.[0];
  if (!first) {
    throw new RunnableToolError({
      code: "TOOL_EXECUTION_FAILED",
      safeMessage: `Could not resolve location '${location}'.`,
      status: 404,
      retryable: false,
    });
  }

  return first;
}

async function runWeatherForecast(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = weatherForecastInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid weather args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "weather.getForecast", input.data);
  if (cached) return cached;

  const loc = await geocode(input.data.location, ctx.signal);
  const response = await safeFetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto`,
    {
      signal: ctx.signal,
      timeoutMs: 8000,
    },
  );

  const payload = (await response.json().catch(() => ({}))) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      weathercode?: number[];
    };
  };

  const daily = payload.daily;
  const days = Math.min(input.data.days, daily?.time?.length ?? 0);
  const weatherMap: Record<number, string> = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    61: "Rain",
    71: "Snow",
    95: "Thunderstorm",
  };

  const forecast = Array.from({ length: days }).map((_, index) => {
    const max = daily?.temperature_2m_max?.[index] ?? 0;
    const min = daily?.temperature_2m_min?.[index] ?? 0;
    const precip = daily?.precipitation_probability_max?.[index] ?? 0;
    const code = daily?.weathercode?.[index] ?? 0;

    if (input.data.units === "imperial") {
      return {
        date: daily?.time?.[index] ?? new Date().toISOString().slice(0, 10),
        condition: weatherMap[code] ?? "Unknown",
        min: Number(((min * 9) / 5 + 32).toFixed(1)),
        max: Number(((max * 9) / 5 + 32).toFixed(1)),
        precipitation_probability: precip,
      };
    }

    return {
      date: daily?.time?.[index] ?? new Date().toISOString().slice(0, 10),
      condition: weatherMap[code] ?? "Unknown",
      min,
      max,
      precipitation_probability: precip,
    };
  });

  const output = weatherForecastOutputSchema.parse({
    location: `${loc.name}${loc.country ? `, ${loc.country}` : ""}`,
    forecast,
  });
  setCached(ctx.workspaceId, "weather.getForecast", input.data, output);
  return output;
}

async function runTranslateText(ctx: AdapterContext): Promise<Record<string, unknown>> {
  const input = translateTextInputSchema.safeParse(ctx.args);
  if (!input.success) {
    throw new RunnableToolError({ code: "INVALID_ARGS", safeMessage: "Invalid translate args", status: 400, retryable: false, details: input.error.flatten() });
  }

  const cached = getCached(ctx.workspaceId, "translate.text", input.data);
  if (cached) return cached;

  const query = new URLSearchParams({
    client: "gtx",
    sl: input.data.source_lang,
    tl: input.data.target_lang,
    dt: "t",
    q: input.data.text,
  });

  const response = await safeFetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`, {
    signal: ctx.signal,
    timeoutMs: 9000,
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  const translated = Array.isArray(payload)
    ? (payload[0] as Array<Array<string>> | undefined)?.map((chunk) => chunk?.[0] ?? "").join("")
    : null;

  if (!translated || translated.trim().length === 0) {
    throw new RunnableToolError({
      code: "TOOL_EXECUTION_FAILED",
      safeMessage: "Translation provider returned no result.",
      status: 502,
      retryable: true,
    });
  }

  const output = translateTextOutputSchema.parse({
    source_lang: input.data.source_lang,
    target_lang: input.data.target_lang,
    original_text: input.data.text,
    translated_text: translated,
  });

  setCached(ctx.workspaceId, "translate.text", input.data, output);
  return output;
}

export async function runRunnableToolAdapter(ctx: AdapterContext): Promise<Record<string, unknown>> {
  enforceRateLimit(ctx.workspaceId, ctx.toolName);

  if (ctx.toolName === "web.search") return runWebSearch(ctx);
  if (ctx.toolName === "web.fetch") return runWebFetch(ctx);
  if (ctx.toolName === "web.extract") return runWebExtract(ctx);
  if (ctx.toolName === "web.summarize") return runWebSummarize(ctx);
  if (ctx.toolName === "weather.getForecast") return runWeatherForecast(ctx);
  if (ctx.toolName === "translate.text") return runTranslateText(ctx);

  throw new RunnableToolError({
    code: "TOOL_EXECUTION_FAILED",
    safeMessage: `Adapter for ${ctx.toolName} is not implemented.`,
    status: 501,
    retryable: false,
  });
}

export function resetRunnableToolStateForTests() {
  cacheStore.clear();
  rateStore.clear();
}
