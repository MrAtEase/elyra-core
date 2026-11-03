import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8788),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  GCP_PROJECT_ID: z.string().default(""),
  GCP_LOCATION: z.string().default("us-central1"),
  VERTEX_MODEL: z.string().default("gemini-2.0-flash"),

  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),

  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:8788/v1/google/callback"),

  // Must be exactly 32 bytes encoded as 64 hex characters.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).",
    ),

  FRONTEND_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let _config: Env | null = null;
let _dotEnvLoaded = false;

function parseLine(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  const equalsIndex = line.indexOf("=");
  if (equalsIndex <= 0) return null;

  const key = line.slice(0, equalsIndex).trim();
  if (!key) return null;

  let value = line.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadDotEnvFile(): void {
  if (_dotEnvLoaded) return;
  _dotEnvLoaded = true;

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

export function loadConfig(): Env {
  if (_config) return _config;
  loadDotEnvFile();
  _config = envSchema.parse(process.env);
  return _config;
}

export function config(): Env {
  if (!_config) throw new Error("Config not loaded — call loadConfig() first");
  return _config;
}
