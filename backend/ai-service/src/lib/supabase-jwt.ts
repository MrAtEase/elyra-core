import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "./errors.js";

export type SupabaseJwtClaims = {
  sub: string;
  exp?: number;
  iat?: number;
  aud?: string | string[];
  role?: string;
  email?: string | null;
  [key: string]: unknown;
};

interface JwtSegments {
  header: string;
  payload: string;
  signature: string;
}

const MALFORMED_TOKEN = "Malformed token";
const TOKEN_SUBJECT = "Token subject missing";
const TOKEN_EXPIRATION = "Token expiration claim missing";

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new AuthError(MALFORMED_TOKEN);
  }
}

function parseJson<T>(encoded: string): T {
  const decoded = decodeBase64Url(encoded);
  try {
    return JSON.parse(decoded) as T;
  } catch {
    throw new AuthError(MALFORMED_TOKEN);
  }
}

function assertClaims(claims: SupabaseJwtClaims): void {
  if (!claims.sub || typeof claims.sub !== "string") {
    throw new AuthError(TOKEN_SUBJECT);
  }
  if (typeof claims.exp !== "number") {
    throw new AuthError(TOKEN_EXPIRATION);
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new AuthError("Token expired");
  }
}

function splitToken(token: string): JwtSegments {
  const normalizedToken = token.trim();
  const parts = normalizedToken.split(".");
  if (parts.length !== 3) {
    throw new AuthError(MALFORMED_TOKEN);
  }
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) {
    throw new AuthError(MALFORMED_TOKEN);
  }
  return { header, payload, signature };
}

function parseClaims(token: string): SupabaseJwtClaims {
  const { payload } = splitToken(token);
  const claims = parseJson<SupabaseJwtClaims>(payload);
  assertClaims(claims);
  return claims;
}

let adminClient: SupabaseClient | null = null;
let clientMeta = { url: "", key: "" };

function getSupabaseAdminClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  if (adminClient && clientMeta.url === supabaseUrl && clientMeta.key === serviceRoleKey) {
    return adminClient;
  }
  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-elyra-source": "ai-service" } },
  });
  clientMeta = { url: supabaseUrl, key: serviceRoleKey };
  return adminClient;
}

export async function verifySupabaseJwt(
  token: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<SupabaseJwtClaims> {
  const claims = parseClaims(token);
  const client = getSupabaseAdminClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await client.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) {
    throw new AuthError("Invalid token");
  }
  if (userId !== claims.sub) {
    throw new AuthError("Token subject mismatch");
  }
  return claims;
}

export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice(7).trim();
  return token ? token : null;
}
