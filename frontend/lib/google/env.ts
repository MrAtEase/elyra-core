import { z } from "zod";

const REQUIRED_TEXT = z.string().trim().min(1);
const REQUIRED_URL = z.string().trim().url();
const TOKEN_KEY_HEX = z
  .string()
  .trim()
  .regex(
    /^[0-9a-fA-F]{64}$/,
    "TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes) for AES-256-GCM."
  );

const ServerEnvSchema = z
  .object({
    GOOGLE_CLIENT_ID: REQUIRED_TEXT,
    GOOGLE_CLIENT_SECRET: REQUIRED_TEXT,
    GOOGLE_REDIRECT_URI: REQUIRED_TEXT,
    NEXT_PUBLIC_APP_URL: z.string().trim().url().optional(),
    SUPABASE_URL: REQUIRED_URL,
    NEXT_PUBLIC_SUPABASE_URL: z.string().trim().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: REQUIRED_TEXT,
    TOKEN_ENCRYPTION_KEY: TOKEN_KEY_HEX,
    SUPABASE_ANON_KEY: z.string().trim().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().optional(),
  })
  .superRefine((input, ctx) => {
    const anonKey =
      input.SUPABASE_ANON_KEY?.trim() ||
      input.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!anonKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is required.",
        path: ["SUPABASE_ANON_KEY"],
      });
    }
  });

export type GoogleServerEnv = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_REDIRECT_URIS: string[];
  NEXT_PUBLIC_APP_URL: string;
  SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  TOKEN_ENCRYPTION_KEY_HEX: string;
  TOKEN_ENCRYPTION_KEY_BYTES: Buffer;
};

export class GoogleConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Google configuration invalid: ${issues.join(" | ")}`);
    this.name = "GoogleConfigError";
  }
}

function normalizeRedirectUris(raw: string): string[] {
  const items = raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(items));
  if (unique.length === 0) {
    throw new GoogleConfigError([
      "GOOGLE_REDIRECT_URI must include at least one valid URI.",
    ]);
  }

  for (const item of unique) {
    try {
      const parsed = new URL(item);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new GoogleConfigError([
        `GOOGLE_REDIRECT_URI contains invalid URL: ${item}`,
      ]);
    }
  }

  return unique;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

function parseServerEnv(): GoogleServerEnv {
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new GoogleConfigError(formatIssues(parsed.error));
  }

  const anonKey =
    parsed.data.SUPABASE_ANON_KEY?.trim() ||
    parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) {
    throw new GoogleConfigError([
      "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is required.",
    ]);
  }

  const redirectUris = normalizeRedirectUris(parsed.data.GOOGLE_REDIRECT_URI);
  const tokenHex = parsed.data.TOKEN_ENCRYPTION_KEY.trim();
  const tokenBytes = Buffer.from(tokenHex, "hex");
  if (tokenBytes.byteLength !== 32) {
    throw new GoogleConfigError([
      "TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM.",
    ]);
  }

  return {
    GOOGLE_CLIENT_ID: parsed.data.GOOGLE_CLIENT_ID.trim(),
    GOOGLE_CLIENT_SECRET: parsed.data.GOOGLE_CLIENT_SECRET.trim(),
    GOOGLE_REDIRECT_URI: parsed.data.GOOGLE_REDIRECT_URI.trim(),
    GOOGLE_REDIRECT_URIS: redirectUris,
    NEXT_PUBLIC_APP_URL:
      parsed.data.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
    SUPABASE_URL: parsed.data.SUPABASE_URL.trim(),
    NEXT_PUBLIC_SUPABASE_URL:
      parsed.data.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      parsed.data.SUPABASE_URL.trim(),
    SUPABASE_SERVICE_ROLE_KEY: parsed.data.SUPABASE_SERVICE_ROLE_KEY.trim(),
    SUPABASE_ANON_KEY: anonKey,
    TOKEN_ENCRYPTION_KEY_HEX: tokenHex,
    TOKEN_ENCRYPTION_KEY_BYTES: tokenBytes,
  };
}

let cachedEnv: GoogleServerEnv | null = null;

export function getGoogleServerEnv(): GoogleServerEnv {
  if (cachedEnv) return cachedEnv;
  cachedEnv = parseServerEnv();
  return cachedEnv;
}

export function getGoogleServerEnvSafe():
  | { ok: true; env: GoogleServerEnv }
  | { ok: false; error: GoogleConfigError } {
  try {
    return { ok: true, env: getGoogleServerEnv() };
  } catch (error) {
    if (error instanceof GoogleConfigError) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: new GoogleConfigError([
        error instanceof Error ? error.message : "Unknown configuration error",
      ]),
    };
  }
}

function normalizeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input.replace(/\/+$/, "");
  }
}

export function pickGoogleRedirectUri(
  env: GoogleServerEnv,
  requestOrigin: string
): string {
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  const isLocalRequestOrigin =
    normalizedRequestOrigin.startsWith("http://localhost") ||
    normalizedRequestOrigin.startsWith("http://127.0.0.1");
  const callbackForOrigin = `${normalizeOrigin(requestOrigin)}/api/google/callback`;
  if (env.GOOGLE_REDIRECT_URIS.includes(callbackForOrigin)) {
    return callbackForOrigin;
  }

  if (isLocalRequestOrigin) {
    const localConfigured = env.GOOGLE_REDIRECT_URIS.find(
      (uri) =>
        uri.startsWith("http://localhost/") ||
        uri.startsWith("http://localhost:") ||
        uri.startsWith("http://127.0.0.1/") ||
        uri.startsWith("http://127.0.0.1:")
    );
    if (localConfigured) {
      return localConfigured;
    }
    // Keep local runs local even when env redirect configuration is incomplete.
    return callbackForOrigin;
  }

  const callbackForPublicApp = `${normalizeOrigin(env.NEXT_PUBLIC_APP_URL)}/api/google/callback`;
  if (env.GOOGLE_REDIRECT_URIS.includes(callbackForPublicApp)) {
    return callbackForPublicApp;
  }

  return env.GOOGLE_REDIRECT_URIS[0]!;
}
