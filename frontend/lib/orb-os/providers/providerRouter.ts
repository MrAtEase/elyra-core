/**
 * Elyra AI Provider Router
 *
 * Centralised source-of-truth for provider configuration, capability flags, and
 * actionable diagnostics.  Import this module in any API route that needs to
 * route between Gemini, OpenAI, and Claude.
 *
 * Providers
 * ─────────
 *  gemini        – Gemini via direct API key (generativelanguage.googleapis.com).
 *  openai        – OpenAI Codex/Chat models via direct API key (api.openai.com).
 *  claude_direct – Claude via direct Anthropic API (api.anthropic.com) — wie Claude Code.
 *  claude_vertex – Claude via Google Vertex AI (project + gcloud ADC credentials).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderId = "gemini" | "gemini_cli" | "openai" | "claude_direct" | "claude_vertex";

export type ProviderCapabilities = {
  supportsReasoning: boolean;
  supportsToolCalls: boolean;
  supportsImages: boolean;
  supportsCodePatch: boolean;
  supportsLongContext: boolean;
};

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  configured: boolean;
  model: string;
  capabilities: ProviderCapabilities;
  /** Actionable error strings shown in UI — empty when configured. */
  issues: string[];
};

export type ProviderStatusMap = Record<ProviderId, ProviderStatus>;

// ── Env helpers ───────────────────────────────────────────────────────────────

function env(...keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return "";
}

// ── Status resolution ─────────────────────────────────────────────────────────

/**
 * Returns current provider statuses based on environment configuration.
 * Safe to call on every request — reads process.env at call time.
 */
export function getProviderStatuses(): ProviderStatusMap {
  // ── Gemini (direct API key) ─────────────────────────────────────────────────
  const geminiKey   = env("GEMINI_API_KEY");
  const geminiModel = env("GEMINI_MODEL", "SLIDES_GEMINI_MODEL") || "gemini-2.5-flash";

  const geminiLabel =
    /2\.5-pro/i.test(geminiModel) ? "Gemini 2.5 Pro" :
    /2\.5-flash/i.test(geminiModel) ? "Gemini 2.5 Flash" :
    "Gemini (Direct API)";

  const gemini: ProviderStatus = {
    id: "gemini",
    label: geminiLabel,
    configured: geminiKey.length > 0,
    model: geminiModel,
    capabilities: {
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsImages: true,
      supportsCodePatch: false,
      supportsLongContext: true,
    },
    issues: geminiKey ? [] : ["Set GEMINI_API_KEY in .env.local."],
  };

  const geminiCliPath = env("GEMINI_CLI_PATH");
  const geminiCliModel = env("GEMINI_CLI_MODEL") || "gemini-3.1-pro-preview";

  const gemini_cli: ProviderStatus = {
    id: "gemini_cli",
    label: "Gemini CLI (Vertex)",
    configured: geminiCliPath.length > 0,
    model: geminiCliModel,
    capabilities: {
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsImages: false,
      supportsCodePatch: false,
      supportsLongContext: true,
    },
    issues: geminiCliPath
      ? []
      : [
          "Set GEMINI_CLI_PATH in .env.local and authenticate the official Gemini CLI to enable read-first repo analysis via Vertex AI.",
        ],
  };

  // ── OpenAI (direct API key) ─────────────────────────────────────────────────
  const openAiKey   = env("OPENAI_API_KEY");
  const openAiModel = env("OPENAI_CODER_MODEL", "OPENAI_MODEL") || "gpt-4o";

  const openai: ProviderStatus = {
    id: "openai",
    label: "OpenAI (Codex)",
    configured: openAiKey.length > 0,
    model: openAiModel,
    capabilities: {
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsImages: true,
      supportsCodePatch: true,
      supportsLongContext: true,
    },
    issues: openAiKey ? [] : ["Set OPENAI_API_KEY in .env.local."],
  };

  // ── Claude Direct (api.anthropic.com — wie Claude Code) ────────────────────
  const anthropicKey   = env("ANTHROPIC_API_KEY");
  const anthropicModel = env("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250908";

  const claude_direct: ProviderStatus = {
    id: "claude_direct",
    label: "Claude (Direct API)",
    configured: anthropicKey.length > 0,
    model: anthropicModel,
    capabilities: {
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsImages: true,
      supportsCodePatch: true,
      supportsLongContext: true,
    },
    issues: anthropicKey ? [] : ["Set ANTHROPIC_API_KEY in .env.local (console.anthropic.com → API Keys)."],
  };

  // ── Claude via Vertex AI (gcloud ADC + Google Cloud project) ───────────────
  const vertexProject  = env("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  const vertexLocation = env("VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION");
  const vertexCreds    = env(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "VERTEX_SERVICE_ACCOUNT_JSON",
  );
  const claudeVertexModel = env("VERTEX_CLAUDE_MODEL") || "claude-sonnet-4-6";

  const vertexIssues: string[] = [];
  if (!vertexProject)  vertexIssues.push("Set VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT).");
  if (!vertexLocation) vertexIssues.push("Set VERTEX_LOCATION (e.g. global or us-east5).");
  // Credentials file is optional when gcloud ADC is available. Keep this as guidance,
  // but do not block provider configuration solely on missing file env vars.
  if (!vertexCreds) {
    vertexIssues.push(
      "No GOOGLE_APPLICATION_CREDENTIALS set. If you use local ADC, run: gcloud auth application-default login",
    );
  }
  const vertexHardMissing = !vertexProject || !vertexLocation;

  const claude_vertex: ProviderStatus = {
    id: "claude_vertex",
    label: "Claude via Vertex AI",
    configured: !vertexHardMissing,
    model: claudeVertexModel,
    capabilities: {
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsImages: true,
      supportsCodePatch: true,
      supportsLongContext: true,
    },
    issues: vertexHardMissing ? vertexIssues : [],
  };

  return { gemini, gemini_cli, openai, claude_direct, claude_vertex };
}

// ── Resolution helpers ────────────────────────────────────────────────────────

/** Parse and validate a raw provider string from request body / query params. */
export function resolveProvider(raw: unknown, fallback: ProviderId = "gemini"): ProviderId {
  if (raw === "claude_direct") return "claude_direct";
  if (raw === "claude_vertex") return "claude_vertex";
  if (raw === "gemini_cli") return "gemini_cli";
  if (raw === "claude") return "claude_direct"; // convenience alias
  if (raw === "codex") return "openai";
  if (raw === "openai") return "openai";
  if (raw === "gemini") return "gemini";
  return fallback;
}

/**
 * Resolve which provider to use for a given workspace, respecting capability
 * requirements.  Falls back to "gemini" if the preferred provider is not
 * configured or lacks required capabilities.
 */
export function resolveProviderForWorkspace(opts: {
  preferred: ProviderId;
  requiresReasoning?: boolean;
  requiresToolCalls?: boolean;
  requiresCodePatch?: boolean;
}): { provider: ProviderId; status: ProviderStatus; fallbackUsed: boolean } {
  const statuses = getProviderStatuses();
  const preferred = statuses[opts.preferred];
  const supports = (status: ProviderStatus): boolean =>
    status.configured &&
    (!opts.requiresReasoning || status.capabilities.supportsReasoning) &&
    (!opts.requiresToolCalls || status.capabilities.supportsToolCalls) &&
    (!opts.requiresCodePatch || status.capabilities.supportsCodePatch);

  const meetsCapabilities = supports(preferred);

  if (meetsCapabilities) {
    return { provider: opts.preferred, status: preferred, fallbackUsed: false };
  }

  // Stay within the Gemini family when Gemini was explicitly preferred.
  if (opts.preferred === "gemini" || opts.preferred === "gemini_cli") {
    if (opts.preferred !== "gemini_cli" && supports(statuses.gemini_cli)) {
      return { provider: "gemini_cli", status: statuses.gemini_cli, fallbackUsed: true };
    }
    if (opts.preferred !== "gemini" && supports(statuses.gemini)) {
      return { provider: "gemini", status: statuses.gemini, fallbackUsed: true };
    }
  }

  // Fall back chain for non-Gemini preferences:
  // 1) Gemini CLI
  // 2) OpenAI
  // 3) best Claude available (direct, then vertex)
  if (supports(statuses.gemini_cli)) {
    return { provider: "gemini_cli", status: statuses.gemini_cli, fallbackUsed: true };
  }
  if (supports(statuses.openai)) {
    return { provider: "openai", status: statuses.openai, fallbackUsed: true };
  }
  if (supports(statuses.claude_direct)) {
    return { provider: "claude_direct", status: statuses.claude_direct, fallbackUsed: true };
  }
  if (supports(statuses.claude_vertex)) {
    return { provider: "claude_vertex", status: statuses.claude_vertex, fallbackUsed: true };
  }
  if (supports(statuses.gemini)) {
    return { provider: "gemini", status: statuses.gemini, fallbackUsed: true };
  }
  return { provider: opts.preferred, status: preferred, fallbackUsed: true };
}

// ── Diagnostic formatting ──────────────────────────────────────────────────────

/** Formats issues as an actionable string for API error responses. */
export function formatProviderIssues(status: ProviderStatus): string {
  if (status.issues.length === 0) return "";
  return `${status.label} is not configured: ${status.issues.join(" ")}`;
}
