const ASSISTANT_API_BASE_ENV = "NEXT_PUBLIC_ASSISTANT_API_BASE";
const LEGACY_API_BASE_ENV = "NEXT_PUBLIC_API_URL";
const LEGACY_API_ORIGIN_ENV = "NEXT_PUBLIC_API_ORIGIN";

const LOCAL_ASSISTANT_BASE = "http://localhost:8788";
// Removed hardcoded production default - must be configured via env vars

export const ASSISTANT_BASE_ENV_KEYS = [
  ASSISTANT_API_BASE_ENV,
  LEGACY_API_ORIGIN_ENV,
  LEGACY_API_BASE_ENV,
] as const;

type AssistantBaseEnvKey = (typeof ASSISTANT_BASE_ENV_KEYS)[number];

export type AssistantApiBaseStatus = {
  baseUrl: string | null;
  resolvedFrom: AssistantBaseEnvKey | null;
  missingKeys: AssistantBaseEnvKey[];
  invalidKeys: AssistantBaseEnvKey[];
  values: Record<AssistantBaseEnvKey, string | null>;
};

let hasWarnedMissingAssistantBase = false;

export function normalizeAssistantBaseCandidate(value?: string | null): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function readEnvValue(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAssistantApiBaseStatus(): AssistantApiBaseStatus {
  const missingKeys: AssistantBaseEnvKey[] = [];
  const invalidKeys: AssistantBaseEnvKey[] = [];
  let baseUrl: string | null = null;
  let resolvedFrom: AssistantBaseEnvKey | null = null;

  const assistantRaw = readEnvValue(process.env.NEXT_PUBLIC_ASSISTANT_API_BASE);
  const legacyOriginRaw = readEnvValue(process.env.NEXT_PUBLIC_API_ORIGIN);
  const legacyBaseRaw = readEnvValue(process.env.NEXT_PUBLIC_API_URL);

  const values: Record<AssistantBaseEnvKey, string | null> = {
    NEXT_PUBLIC_ASSISTANT_API_BASE: assistantRaw,
    NEXT_PUBLIC_API_ORIGIN: legacyOriginRaw,
    NEXT_PUBLIC_API_URL: legacyBaseRaw,
  };

  const assistantNormalized = assistantRaw ? normalizeAssistantBaseCandidate(assistantRaw) : null;
  if (!assistantRaw) {
    missingKeys.push(ASSISTANT_API_BASE_ENV);
  } else if (!assistantNormalized) {
    invalidKeys.push(ASSISTANT_API_BASE_ENV);
  } else if (!baseUrl) {
    baseUrl = assistantNormalized;
    resolvedFrom = ASSISTANT_API_BASE_ENV;
  }

  const legacyOriginNormalized = legacyOriginRaw
    ? normalizeAssistantBaseCandidate(legacyOriginRaw)
    : null;
  if (!legacyOriginRaw) {
    missingKeys.push(LEGACY_API_ORIGIN_ENV);
  } else if (!legacyOriginNormalized) {
    invalidKeys.push(LEGACY_API_ORIGIN_ENV);
  } else if (!baseUrl) {
    baseUrl = legacyOriginNormalized;
    resolvedFrom = LEGACY_API_ORIGIN_ENV;
  }

  const legacyBaseNormalized = legacyBaseRaw ? normalizeAssistantBaseCandidate(legacyBaseRaw) : null;
  if (!legacyBaseRaw) {
    missingKeys.push(LEGACY_API_BASE_ENV);
  } else if (!legacyBaseNormalized) {
    invalidKeys.push(LEGACY_API_BASE_ENV);
  } else if (!baseUrl) {
    baseUrl = legacyBaseNormalized;
    resolvedFrom = LEGACY_API_BASE_ENV;
  }

  return {
    baseUrl,
    resolvedFrom,
    missingKeys,
    invalidKeys,
    values,
  };
}

function warnMissingAssistantBase(status: AssistantApiBaseStatus) {
  if (hasWarnedMissingAssistantBase) {
    return;
  }
  const valuesSummary = [
    `${ASSISTANT_API_BASE_ENV}=${status.values.NEXT_PUBLIC_ASSISTANT_API_BASE ?? "<empty>"}`,
    `${LEGACY_API_ORIGIN_ENV}=${status.values.NEXT_PUBLIC_API_ORIGIN ?? "<empty>"}`,
    `${LEGACY_API_BASE_ENV}=${status.values.NEXT_PUBLIC_API_URL ?? "<empty>"}`,
  ].join(", ");
  const invalidSummary =
    status.invalidKeys.length > 0 ? ` Invalid: ${status.invalidKeys.join(", ")}.` : "";
  console.warn(
    `API base not configured. Set ${ASSISTANT_BASE_ENV_KEYS.join(
      " / "
    )} (local dev: ${LOCAL_ASSISTANT_BASE}). Current values: ${valuesSummary}.${invalidSummary}`
  );
  hasWarnedMissingAssistantBase = true;
}

let hasLoggedAssistantBase = false;

function logAssistantBaseOnce(baseUrl: string) {
  if (hasLoggedAssistantBase || process.env.NODE_ENV === "production") {
    return;
  }
  console.log(`[config] assistant base = ${baseUrl}`);
  hasLoggedAssistantBase = true;
}

export function getAssistantApiBase(): string {
  const status = getAssistantApiBaseStatus();
  if (status.baseUrl) {
    logAssistantBaseOnce(status.baseUrl);
    return status.baseUrl;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      `[error] NEXT_PUBLIC_ASSISTANT_API_BASE required in production. Falling back to localhost to prevent crash.`
    );
  }

  warnMissingAssistantBase(status);
  logAssistantBaseOnce(LOCAL_ASSISTANT_BASE);
  return LOCAL_ASSISTANT_BASE;
}

export function getApiOrigin(): string {
  return getAssistantApiBase();
}

const DEFAULT_APP_ORIGIN =
  process.env.NODE_ENV === "production"
    ? "" // Require explicit config in production
    : "http://localhost:3000";

export const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN || "").trim() || DEFAULT_APP_ORIGIN;
