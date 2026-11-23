/**
 * Coding agent – Model providers: Gemini (API/CLI/Vertex), Claude (direct/Vertex), JSON parsing.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import { getProviderStatuses, type ProviderId } from "@/lib/orb-os/providers/providerRouter";
import { existsSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CodeProviderStatusMap, GeminiInputPart, GeminiResponse, JsonRecord, RunAttachment } from "@/lib/code-agent/types";
import { parseGitHubRepoUrl, trimEnv } from "@/lib/code-agent/repo";
import { GEMINI_TIMEOUT_MS } from "@/lib/code-agent/config";
import { callOpenAiJson } from "@/lib/code-agent/planner";

export function getCodeProviderStatuses(): CodeProviderStatusMap {
  const base = getProviderStatuses();
  const geminiKey = trimEnv("GEMINI_API_KEY");
  const geminiModel = trimEnv("GEMINI_MODEL", "SLIDES_GEMINI_MODEL") || "gemini-2.5-flash";
  const geminiCliModel = trimEnv("GEMINI_CLI_MODEL") || "gemini-3.1-pro-preview";
  const geminiCliAvailable = detectGeminiCliAvailable();
  return {
    ...base,
    gemini: {
      ...base.gemini,
      configured: geminiKey.length > 0,
      label: "Gemini (direct API)",
      model: geminiModel,
      issues: geminiKey ? [] : ["Set GEMINI_API_KEY in .env.local to run the coding agent with Gemini."],
    },
    gemini_cli: {
      ...base.gemini_cli,
      configured: geminiCliAvailable,
      label: "Gemini CLI",
      model: geminiCliModel,
      issues: geminiCliAvailable
        ? []
        : ["Install/authenticate gemini CLI and configure a stable auth path (API key or Vertex) to enable repo-aware CLI analysis."],
    },
    openai: {
      ...base.openai,
      label: "OpenAI",
    },
  };
}

let cachedGeminiCliBinary: string | null | undefined;

function detectGeminiCliAvailable(): boolean {
  return Boolean(resolveGeminiCliBinary());
}

function resolveGeminiCliBinary(): string | null {
  if (cachedGeminiCliBinary && existsSync(cachedGeminiCliBinary)) {
    return cachedGeminiCliBinary;
  }
  const explicit = trimEnv("GEMINI_CLI_PATH");
  if (explicit && existsSync(explicit)) {
    cachedGeminiCliBinary = explicit;
    return cachedGeminiCliBinary;
  }
  const probe = spawnSync("/bin/zsh", ["-lc", "command -v gemini"], {
    encoding: "utf8",
    env: process.env,
    timeout: 5000,
  });
  const resolved = probe.status === 0 ? probe.stdout.trim() : "";
  if (resolved && existsSync(resolved)) {
    cachedGeminiCliBinary = resolved;
    return cachedGeminiCliBinary;
  }
  const home = process.env.HOME?.trim() || "";
  const fallbackCandidates = [
    home ? path.join(home, ".nvm", "versions", "node", "v20.19.5", "bin", "gemini") : "",
    home ? path.join(home, ".nvm", "versions", "node", "current", "bin", "gemini") : "",
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
  ].filter(Boolean);
  for (const candidate of fallbackCandidates) {
    if (existsSync(candidate)) {
      cachedGeminiCliBinary = candidate;
      return cachedGeminiCliBinary;
    }
  }
  return null;
}

export function geminiCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Ensure /bin and /usr/bin are in PATH so the CLI can spawn bash/sh tool calls.
  // Use segment-based check (split on ":") — substring match would falsely detect /bin inside /usr/bin.
  const currentPath = env.PATH ?? "";
  const pathSegments = new Set(currentPath.split(":"));
  const pathExtras = ["/bin", "/usr/bin", "/usr/local/bin"].filter((p) => !pathSegments.has(p));
  if (pathExtras.length > 0) env.PATH = `${pathExtras.join(":")}:${currentPath}`;

  const geminiApiKey = trimEnv("GEMINI_API_KEY");
  // GEMINI_CLI_AUTH_MODE=vertex  → force Vertex/GCP credits even if API key is present
  // GEMINI_CLI_AUTH_MODE=api-key → force AI Studio API key
  // GEMINI_CLI_AUTH_MODE=auto    → Vertex if no API key, otherwise API key (legacy default)
  const authMode = (trimEnv("GEMINI_CLI_AUTH_MODE") || "auto").toLowerCase();
  const useVertex = authMode === "vertex" || (!geminiApiKey && authMode !== "api-key");

  if (geminiApiKey && !useVertex) {
    env.GEMINI_API_KEY = geminiApiKey;
    env.GEMINI_DEFAULT_AUTH_TYPE = "gemini-api-key";
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_LOCATION;
    return env;
  }

  // Vertex/ADC path — strip API key so the CLI authenticates via gcloud ADC (GCP credits)
  delete env.GEMINI_API_KEY;
  delete env.GEMINI_DEFAULT_AUTH_TYPE;
  env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "elyra-core-dev-app";
  env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
  return env;
}

class GeminiCliRuntimeError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(code: string, message: string, options?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "GeminiCliRuntimeError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status ?? 503;
  }
}

export function buildProviderRuntimeFailure(input: {
  error: unknown;
  fallbackMessage?: string;
}): { code: string; error: string; status: number } {
  if (input.error instanceof GeminiCliRuntimeError) {
    return {
      code: input.error.code,
      error: input.error.message,
      status: input.error.status,
    };
  }

  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const classified = classifyGeminiCliRuntimeError(message);
  if (classified) {
    return {
      code: classified.code,
      error: classified.message,
      status: classified.status,
    };
  }

  return {
    code: "MODEL_UNAVAILABLE_NO_SAFE_FALLBACK",
    error: truncateRuntimeFailureMessage(input.fallbackMessage ?? message),
    status: 503,
  };
}

function truncateRuntimeFailureMessage(message: string, maxLength = 600): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

let cachedGeminiCliAuthHealth:
  | {
      ok: boolean;
      checkedAt: number;
      error?: GeminiCliRuntimeError;
    }
  | undefined;

function classifyGeminiCliRuntimeError(message: string): GeminiCliRuntimeError | null {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("api key") ||
    normalized.includes("gemini_api_key") ||
    normalized.includes("unauthenticated") ||
    normalized.includes("credentials_missing")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_AUTH_INVALID",
      "Gemini CLI auth is invalid or missing. Configure a valid GEMINI_API_KEY or restore Vertex credentials, then retry.",
      { retryable: true, status: 401 },
    );
  }
  if (
    normalized.includes("invalid_rapt") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("reauth related error")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_REAUTH_REQUIRED",
      "Gemini CLI needs Google reauthentication. Run `gcloud auth login <your-account>` and `gcloud auth application-default login`, then retry.",
      { retryable: true, status: 401 },
    );
  }
  if (
    normalized.includes("resource_exhausted") ||
    normalized.includes("too many requests") ||
    normalized.includes("status 429")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_RATE_LIMITED",
      "Gemini CLI via Vertex is rate-limited for this project right now. Retry later or use a smaller scoped task / gemini-2.5-pro path.",
      { retryable: true, status: 429 },
    );
  }
  if (
    normalized.includes("not installed") ||
    normalized.includes("not available on path")
  ) {
    return new GeminiCliRuntimeError(
      "GEMINI_CLI_NOT_READY",
      "Gemini CLI is not installed or not available on PATH for the Elyra server process.",
      { retryable: false, status: 503 },
    );
  }
  return null;
}

export async function ensureGeminiCliAuthReady(): Promise<void> {
  if (cachedGeminiCliAuthHealth && Date.now() - cachedGeminiCliAuthHealth.checkedAt < 60_000) {
    if (!cachedGeminiCliAuthHealth.ok && cachedGeminiCliAuthHealth.error) {
      throw cachedGeminiCliAuthHealth.error;
    }
    return;
  }

  try {
    const geminiApiKey = trimEnv("GEMINI_API_KEY");
    if (geminiApiKey) {
      cachedGeminiCliAuthHealth = {
        ok: true,
        checkedAt: Date.now(),
      };
      return;
    }
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "gcloud",
        ["auth", "application-default", "print-access-token"],
        {
          env: geminiCliEnv(),
          timeout: 15_000,
          maxBuffer: 256 * 1024,
        },
        (error, token, stderr) => {
          if (error) {
            const detail = stderr?.trim() || error.message;
            reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
            return;
          }
          resolve(token);
        },
      );
    });
    if (!stdout.trim()) {
      throw new GeminiCliRuntimeError(
        "GEMINI_CLI_AUTH_EMPTY",
        "Gemini CLI auth check returned no access token. Re-run Google authentication and retry.",
        { retryable: true, status: 401 },
      );
    }
    cachedGeminiCliAuthHealth = {
      ok: true,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const classified =
      error instanceof GeminiCliRuntimeError
        ? error
        : classifyGeminiCliRuntimeError(error instanceof Error ? error.message : String(error)) ??
          new GeminiCliRuntimeError(
            "GEMINI_CLI_AUTH_FAILED",
            error instanceof Error ? error.message : String(error),
            { retryable: true, status: 503 },
          );
    cachedGeminiCliAuthHealth = {
      ok: false,
      checkedAt: Date.now(),
      error: classified,
    };
    throw classified;
  }
}

export function resolveLocalProviderCwd(repoUrl?: string, fallback?: string): string | undefined {
  const candidate = (repoUrl ?? "").split("#")[0]?.trim();
  if (candidate && !parseGitHubRepoUrl(candidate)) return candidate;
  return fallback;
}

function extractGeminiText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

function sanitizeLikelyJson(input: string): string {
  let next = input.trim().replace(/^\uFEFF/, "");
  // Remove markdown fences if they leaked into the payload.
  next = next.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Remove JS-style comments that occasionally appear in model outputs.
  next = next.replace(/\/\*[\s\S]*?\*\//g, "");
  next = next.replace(/^\s*\/\/.*$/gm, "");
  // Normalize smart quotes.
  next = next
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  // Normalize Python-style booleans/nulls that occasionally leak from model output.
  next = next.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null");
  // Convert simple single-quoted keys/values into JSON-compatible quotes.
  next = next.replace(/([{,]\s*)'([^'\\]+?)'\s*:/g, '$1"$2":');
  next = next.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value: string) => `: "${value.replace(/"/g, '\\"')}"`);
  // Remove trailing commas before } or ].
  next = next.replace(/,\s*([}\]])/g, "$1");
  return next.trim();
}

function extractBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function parseJsonFromText(text: string): JsonRecord {
  const candidates: string[] = [];
  const pushCandidate = (value?: string | null) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return;
    if (!candidates.includes(trimmed)) candidates.push(trimmed);
  };

  pushCandidate(text);
  pushCandidate(text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? null);
  pushCandidate(extractBalancedJsonObject(text));
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    pushCandidate(text.slice(start, end + 1));
  }

  // Sometimes the model returns a JSON string that itself contains JSON.
  try {
    const parsedOuter = JSON.parse(text);
    if (typeof parsedOuter === "string") {
      pushCandidate(parsedOuter);
      pushCandidate(extractBalancedJsonObject(parsedOuter));
    }
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as JsonRecord;
    } catch {
      // continue
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(sanitizeLikelyJson(candidate)) as JsonRecord;
    } catch {
      // continue
    }
  }

  throw new Error("Failed to parse JSON from Gemini response.");
}

export async function callGeminiJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  responseJsonSchema?: Record<string, unknown>;
  allowProviderFailover?: boolean;
  __jsonRetry?: boolean;
  __openAiFallback?: boolean;
}): Promise<JsonRecord> {
  const apiKey = trimEnv("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = trimEnv("GEMINI_MODEL", "SLIDES_GEMINI_MODEL") || "gemini-2.5-flash";
  const attachmentParts: GeminiInputPart[] = (input.attachments ?? [])
    .slice(0, 4)
    .flatMap((attachment): GeminiInputPart[] => {
      const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
      const data = attachment.dataBase64?.trim() || "";
      if (!data) return [];

      if (mimeType.startsWith("image/")) {
        return [{
          inlineData: {
            mimeType,
            data,
          },
        }];
      }

      if (
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml"
      ) {
        try {
          const decoded = Buffer.from(data, "base64").toString("utf8");
          return [{
            text: `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`,
          }];
        } catch {
          return [{
            text: `Attachment metadata: ${attachment.name} (${mimeType})`,
          }];
        }
      }

      return [{
        inlineData: {
          mimeType,
          data,
        },
      }];
    });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: input.system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }, ...attachmentParts],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            // Gemini 2.5 Flash uses internal "thinking" tokens that count against maxOutputTokens.
            // With maxOutputTokens: 8192 the model often exhaust the budget with reasoning before
            // completing the JSON diff, yielding a truncated / unparseable response.
            // 32768 gives enough headroom for the diff even on complex tasks.
            maxOutputTokens: 32768,
            responseMimeType: "application/json",
            // responseSchema enables structured output; only send this valid field.
            ...(input.responseJsonSchema ? { responseSchema: input.responseJsonSchema } : {}),
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || data?.error) {
    const errMsg = data?.error?.message || `Gemini HTTP ${response.status}`;
    // If Gemini quota is exhausted (429) or the service is unavailable, fall back to OpenAI
    // transparently so the coder keeps working without requiring a new API key.
    const isQuotaError = response.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(errMsg);
    if (isQuotaError && !input.__openAiFallback && input.allowProviderFailover !== false) {
      // Fallback 1: Vertex AI (bills to Google Cloud project — uses gcloud OAuth, no API key needed)
      const projectId = trimEnv("GEMINI_PROJECT_ID");
      if (projectId) {
        try {
          console.warn("[callGeminiJson] Gemini AI Studio quota exhausted — trying Vertex AI (Cloud credits).");
          return await callGeminiVertexAI({ ...input, __openAiFallback: true });
        } catch (vertexErr) {
          console.warn(`[callGeminiJson] Vertex AI failed (${vertexErr instanceof Error ? vertexErr.message : String(vertexErr)}) — falling back to OpenAI.`);
        }
      }
      // Fallback 2: OpenAI (uses OPENAI_API_KEY credit)
      const openAiKey = trimEnv("OPENAI_API_KEY");
      if (openAiKey) {
        console.warn("[callGeminiJson] Falling back to OpenAI.");
        return callOpenAiJson({ ...input, __openAiFallback: true });
      }
    }
    throw new Error(errMsg);
  }

  const text = extractGeminiText(data ?? {});
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) {
      throw error;
    }
    return callGeminiJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. Do not include markdown fences, explanations, or trailing text.`,
    });
  }
}

// ── Vertex AI Gemini (OAuth via gcloud — bills to Google Cloud project) ───────
// Does NOT require an API key. Uses `gcloud auth print-access-token` (ADC).
// Run once: `gcloud auth login && gcloud config set project <YOUR_PROJECT_ID>`
// Set GEMINI_PROJECT_ID in .env.local to enable this fallback.
async function callGeminiVertexAI(input: {
  system: string;
  prompt: string;
  __jsonRetry?: boolean;
  __openAiFallback?: boolean;
}): Promise<JsonRecord> {
  const projectId = trimEnv("GEMINI_PROJECT_ID");
  if (!projectId) throw new Error("GEMINI_PROJECT_ID is not configured.");
  const location = trimEnv("GEMINI_VERTEX_LOCATION") || "us-central1";
  const model = trimEnv("GEMINI_VERTEX_MODEL") || "gemini-2.5-flash";

  // Get OAuth2 token from the currently active gcloud user account.
  const accessToken = await new Promise<string>((resolve, reject) => {
    execFile(
      "gcloud",
      ["auth", "print-access-token", `--project=${projectId}`],
      { timeout: 10_000 },
      (err, stdout) => {
        if (err) return reject(new Error(`gcloud auth failed: ${err.message}`));
        const token = stdout.trim();
        if (!token) return reject(new Error("gcloud returned empty access token."));
        resolve(token);
      }
    );
  });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Vertex AI timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Vertex AI HTTP ${response.status}`);
  }
  const text = extractGeminiText(data ?? {});
  if (!text) throw new Error("Vertex AI returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callGeminiVertexAI({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. Do not include markdown fences, explanations, or trailing text.`,
    });
  }
}

/** Extract text from Anthropic Messages API response (Vertex rawPredict or direct api.anthropic.com). */
function extractClaudeVertexText(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as JsonRecord) : null;
  // Standard Anthropic Messages API: { content: [{type:"text", text:"..."}] }
  const directContent = Array.isArray(root?.content) ? (root?.content as unknown[]) : [];
  for (const item of directContent) {
    if (!item || typeof item !== "object") continue;
    const block = item as JsonRecord;
    // type="text" blocks have a .text field
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      return block.text;
    }
    // Fallback: any block with a non-empty .text
    if (typeof block.text === "string" && block.text.trim()) return block.text;
  }
  return "";
}

// ── Vertex ADC token cache (avoids spawning gcloud on every request) ─────────
let _vertexTokenCache: { value: string; expiresAt: number } | null = null;

async function getVertexAccessToken(): Promise<string> {
  const now = Date.now();
  // Return cached token if still valid (with 90s buffer)
  if (_vertexTokenCache && now < _vertexTokenCache.expiresAt - 90_000) {
    return _vertexTokenCache.value;
  }

  // Try 1: read ADC file directly — much faster than spawning gcloud
  const credsPath = trimEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (credsPath) {
    try {
      const credsRaw = await readFile(credsPath, "utf-8");
      const creds = JSON.parse(credsRaw) as {
        type?: string;
        client_id?: string;
        client_secret?: string;
        refresh_token?: string;
      };
      if (
        creds.type === "authorized_user" &&
        creds.client_id &&
        creds.client_secret &&
        creds.refresh_token
      ) {
        const resp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            refresh_token: creds.refresh_token,
            grant_type: "refresh_token",
          }).toString(),
          cache: "no-store",
        });
        if (resp.ok) {
          const data = (await resp.json()) as { access_token?: string; expires_in?: number };
          if (data.access_token) {
            const expiresAt = now + (data.expires_in ?? 3600) * 1000;
            _vertexTokenCache = { value: data.access_token, expiresAt };
            return data.access_token;
          }
        }
      }
    } catch (adcErr) {
      console.warn("[getVertexAccessToken] ADC file refresh failed, falling back to gcloud:", adcErr);
    }
  }

  // Try 2: gcloud CLI (fallback — ~300ms spawn cost)
  const projectId = trimEnv("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  return new Promise<string>((resolve, reject) => {
    const args = ["auth", "print-access-token"];
    if (projectId) args.push(`--project=${projectId}`);
    execFile("gcloud", args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(new Error(`gcloud auth failed: ${err.message}`));
      const token = stdout.trim();
      if (!token) return reject(new Error("gcloud returned empty access token."));
      _vertexTokenCache = { value: token, expiresAt: now + 55 * 60 * 1000 };
      resolve(token);
    });
  });
}

async function callClaudeVertexJson(input: {
  system: string;
  prompt: string;
  __jsonRetry?: boolean;
  __retryCount?: number;
}): Promise<JsonRecord> {
  const projectId = trimEnv("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  if (!projectId) throw new Error("VERTEX_PROJECT_ID is not configured.");
  const location = trimEnv("VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION") || "global";
  const model = trimEnv("VERTEX_CLAUDE_MODEL") || "claude-sonnet-4-6";

  const accessToken = await getVertexAccessToken();

  const endpoint =
    location === "global"
      ? `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`
      : `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        anthropic_version: "vertex-2023-10-16",
        system: input.system,
        max_tokens: 32768, // match Gemini budget — enough for large diffs
        temperature: 0.2,
        messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Claude Vertex timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as JsonRecord | null;
  const errorPayload = data?.error && typeof data.error === "object" ? (data.error as JsonRecord) : null;
  const rawErrMsg = typeof errorPayload?.message === "string"
    ? errorPayload.message
    : `Claude Vertex HTTP ${response.status}`;

  if (response.status === 429) {
    // Distinguish transient rate-limits from hard quota exhaustion.
    // Quota errors (RESOURCE_EXHAUSTED / "quota exceeded") should NOT be retried.
    const isQuotaExhausted = /quota|RESOURCE_EXHAUSTED/i.test(rawErrMsg);
    if (isQuotaExhausted) {
      // Throw immediately so callProviderJson can fall back to Gemini.
      // Quota can be increased at: https://console.cloud.google.com/vertex-ai/model-garden?project=<projectId>
      throw new Error(
        `Claude Vertex quota exhausted for project "${projectId}". ` +
          `Request more quota at https://console.cloud.google.com/vertex-ai/model-garden?project=${encodeURIComponent(projectId)} — ${rawErrMsg}`,
      );
    }
    // Transient rate-limit: retry up to 2 times with a short backoff.
    if ((input.__retryCount ?? 0) < 2) {
      const retryAfterSec = parseInt(response.headers.get("Retry-After") ?? "5", 10);
      const waitMs = Math.min((Number.isFinite(retryAfterSec) ? retryAfterSec : 5) * 1000, 15_000);
      console.warn(`[callClaudeVertexJson] 429 rate-limit — retrying in ${waitMs}ms (attempt ${(input.__retryCount ?? 0) + 1}/2)`);
      await new Promise<void>((r) => setTimeout(r, waitMs));
      return callClaudeVertexJson({ ...input, __retryCount: (input.__retryCount ?? 0) + 1 });
    }
  }

  if (!response.ok || errorPayload) {
    throw new Error(rawErrMsg);
  }

  const text = extractClaudeVertexText(data);
  if (!text) throw new Error("Claude Vertex returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callClaudeVertexJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no prose outside JSON.`,
    });
  }
}

// ── Direct Anthropic API — wie Claude Code (api.anthropic.com) ───────────────
async function callClaudeDirectJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  __jsonRetry?: boolean;
}): Promise<JsonRecord> {
  const apiKey = trimEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured. Add it to .env.local.");
  const model = trimEnv("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250908";

  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  for (const attachment of (input.attachments ?? []).slice(0, 4)) {
    const mimeType = attachment.mimeType?.trim() || "application/octet-stream";
    const data = attachment.dataBase64?.trim() || "";
    if (!data) continue;
    if (mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data,
        },
      });
      continue;
    }
    if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") {
      try {
        const decoded = Buffer.from(data, "base64").toString("utf8");
        content.push({ type: "text", text: `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}` });
      } catch {
        content.push({ type: "text", text: `Attachment metadata: ${attachment.name} (${mimeType})` });
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: input.system,
        max_tokens: 32768,
        temperature: 0.2,
        messages: [{ role: "user", content }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Claude Direct timed out after ${Math.round(GEMINI_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => null)) as JsonRecord | null;
  const errorPayload = data?.error && typeof data.error === "object" ? (data.error as JsonRecord) : null;
  if (!response.ok || errorPayload) {
    throw new Error(
      typeof errorPayload?.message === "string" ? errorPayload.message : `Claude Direct HTTP ${response.status}`
    );
  }

  const text = extractClaudeVertexText(data); // same Anthropic Messages API format
  if (!text) throw new Error("Claude Direct returned an empty response.");
  try {
    return parseJsonFromText(text);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callClaudeDirectJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no prose outside JSON.`,
    });
  }
}

export async function callProviderJson(
  provider: ProviderId,
  input: {
    system: string;
    prompt: string;
    attachments?: RunAttachment[];
    responseJsonSchema?: Record<string, unknown>;
    allowProviderFailover?: boolean;
    cwd?: string;
    mutable?: boolean;
  }
): Promise<JsonRecord> {
  if (provider === "gemini_cli") {
    return callGeminiCliJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      mutable: input.mutable ?? true,
    });
  }
  if (provider === "claude_direct") {
    return callClaudeDirectJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
  }
  if (provider === "claude_vertex") {
    try {
      return await callClaudeVertexJson({
        system: input.system,
        prompt: input.prompt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = /quota|RESOURCE_EXHAUSTED/i.test(msg);
      if (isQuota && input.allowProviderFailover !== false) {
        console.warn(`[callProviderJson] Claude Vertex quota exhausted — falling back to Gemini. ${msg}`);
        return callGeminiJson({
          system: input.system,
          prompt: input.prompt,
          ...(input.attachments ? { attachments: input.attachments } : {}),
          ...(input.responseJsonSchema ? { responseJsonSchema: input.responseJsonSchema } : {}),
          allowProviderFailover: true,
        });
      }
      throw err;
    }
  }
  if (provider === "openai") {
    return callOpenAiJson({
      system: input.system,
      prompt: input.prompt,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
  }
  return callGeminiJson({
    system: input.system,
    prompt: input.prompt,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.responseJsonSchema ? { responseJsonSchema: input.responseJsonSchema } : {}),
    ...(typeof input.allowProviderFailover === "boolean"
      ? { allowProviderFailover: input.allowProviderFailover }
      : {}),
  });
}

async function callGeminiCliJson(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd?: string;
  mutable?: boolean;
  __jsonRetry?: boolean;
}): Promise<JsonRecord> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-3.1-pro-preview";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    "IMPORTANT:",
    "- You may inspect the local repository and read files to answer accurately.",
    input.mutable !== false ? "- You may use local tools and edit files when necessary." : "- Operate read-first. Do not edit files or apply patches.",
    "- Return strict JSON only.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "json",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd || process.cwd(),
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const parsedEnvelope = parseJsonFromText(raw) as JsonRecord;
  const responseText = typeof parsedEnvelope.response === "string" ? parsedEnvelope.response : "";
  if (!responseText.trim()) {
    throw new Error("Gemini CLI returned an empty response.");
  }
  try {
    return parseJsonFromText(responseText);
  } catch (error) {
    if (input.__jsonRetry) throw error;
    return callGeminiCliJson({
      ...input,
      __jsonRetry: true,
      prompt: `${input.prompt}\n\nIMPORTANT: Return strict valid JSON only. No markdown fences, no commentary outside JSON.`,
    });
  }
}

export async function callGeminiCliText(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd?: string;
}): Promise<string> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-2.5-pro";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    "IMPORTANT:",
    "- You have read-only access to the local repository under the current working directory.",
    "- Inspect files directly, reason from the real code, and do not edit, patch, or create files.",
    "- Return plain text only.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "text",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd || process.cwd(),
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const text = raw.trim();
  if (!text) {
    throw new Error("Gemini CLI returned an empty text response.");
  }
  return text;
}

export async function callGeminiCliEdit(input: {
  system: string;
  prompt: string;
  attachments?: RunAttachment[];
  cwd: string;
  selectedFiles: string[];
}): Promise<string> {
  const binary = resolveGeminiCliBinary();
  if (!binary) {
    throw new Error("Gemini CLI is not installed or not available on PATH.");
  }
  await ensureGeminiCliAuthReady();
  const model = trimEnv("GEMINI_CLI_MODEL") || "gemini-2.5-pro";
  const attachmentNotes = (input.attachments ?? []).slice(0, 4).map((attachment) => {
    if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
      try {
        const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
        return `Attachment (${attachment.name}):\n${decoded.slice(0, 8000)}`;
      } catch {
        return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
      }
    }
    return `Attachment metadata: ${attachment.name} (${attachment.mimeType})`;
  });
  const scopeBlock = [
    "ALLOWED FILES (you may modify only these files):",
    ...input.selectedFiles.map((file) => `- ${file}`),
  ].join("\n");
  const combinedPrompt = [
    input.system,
    "",
    input.prompt,
    "",
    scopeBlock,
    "",
    "IMPORTANT:",
    "- You have direct terminal and filesystem access inside the current working directory.",
    "- Work read-first, then edit only the allowed files above.",
    "- Do not create, modify, rename, or delete any file outside the allowlist.",
    "- Keep the change minimal and targeted to the task.",
    "- After editing, return plain text only with a short summary of what changed.",
    ...(attachmentNotes.length > 0 ? ["", ...attachmentNotes] : []),
  ].join("\n");
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [
        "-p",
        combinedPrompt,
        "--model",
        model,
        "--output-format",
        "text",
        "-s",
        "false",
        "--approval-mode",
        "yolo",
      ],
      {
        cwd: input.cwd,
        env: geminiCliEnv(),
        timeout: GEMINI_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(classifyGeminiCliRuntimeError(detail) ?? new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
  const text = raw.trim();
  return text;
}
