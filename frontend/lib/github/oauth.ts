import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { safeNext } from "@/lib/safeNext";

export const GITHUB_OAUTH_STATE_COOKIE = "elyra_github_oauth_state";
const MAX_STATE_AGE_MS = 30 * 60 * 1000;

type GitHubOAuthStatePayload = {
  nonce: string;
  workspaceId: string;
  userId: string;
  next: string;
  redirectUri: string;
  createdAt: number;
};

type GitHubOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateKey: Buffer;
};

function resolveStateKey(): Buffer {
  const raw =
    process.env.INTEGRATIONS_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.ELYRA_INTERNAL_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!raw.trim()) {
    throw new Error("INTEGRATIONS_SECRET (or INTERNAL_API_SECRET) is required for GitHub OAuth.");
  }
  return createHmac("sha256", "elyra-github-oauth").update(raw).digest();
}

function normalizeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input.replace(/\/+$/, "");
  }
}

export function getGitHubOAuthEnv(requestOrigin?: string): GitHubOAuthEnv {
  const clientId = (process.env.GITHUB_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET || "").trim();
  const configuredRedirect = (process.env.GITHUB_REDIRECT_URI || "").trim();
  const publicAppUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();

  if (!clientId) {
    throw new Error("GITHUB_CLIENT_ID is not configured.");
  }
  if (!clientSecret) {
    throw new Error("GITHUB_CLIENT_SECRET is not configured.");
  }

  const fallbackRedirectBase =
    configuredRedirect ||
    (publicAppUrl ? `${normalizeOrigin(publicAppUrl)}/api/github/callback` : "") ||
    (requestOrigin ? `${normalizeOrigin(requestOrigin)}/api/github/callback` : "");

  if (!fallbackRedirectBase) {
    throw new Error("GITHUB_REDIRECT_URI or NEXT_PUBLIC_APP_URL is required for GitHub OAuth.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: fallbackRedirectBase,
    stateKey: resolveStateKey(),
  };
}

function signPayload(encodedPayload: string, key: Buffer): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: GitHubOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): GitHubOAuthStatePayload {
  const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as GitHubOAuthStatePayload;
  return {
    nonce: parsed.nonce,
    workspaceId: parsed.workspaceId,
    userId: parsed.userId,
    next: safeNext(parsed.next, "/os"),
    redirectUri: parsed.redirectUri,
    createdAt: Number(parsed.createdAt),
  };
}

export function createGitHubOAuthState(input: {
  workspaceId: string;
  userId: string;
  next: string;
  redirectUri: string;
  key: Buffer;
}): { state: string; cookieValue: string; maxAgeSeconds: number } {
  const payload: GitHubOAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    workspaceId: input.workspaceId,
    userId: input.userId,
    next: safeNext(input.next, "/os"),
    redirectUri: input.redirectUri,
    createdAt: Date.now(),
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload, input.key);

  return {
    state: payload.nonce,
    cookieValue: `${encodedPayload}.${signature}`,
    maxAgeSeconds: Math.floor(MAX_STATE_AGE_MS / 1000),
  };
}

export function verifyGitHubOAuthState(input: {
  stateParam: string | null;
  cookieValue: string | null;
  key: Buffer;
}):
  | { ok: true; payload: GitHubOAuthStatePayload }
  | { ok: false; reason: string } {
  if (!input.stateParam || !input.cookieValue) {
    return { ok: false, reason: "Missing OAuth state." };
  }

  const [encodedPayload, signature] = input.cookieValue.split(".");
  if (!encodedPayload || !signature) {
    return { ok: false, reason: "Invalid OAuth state payload." };
  }

  const expectedSignature = signPayload(encodedPayload, input.key);
  if (!secureEquals(signature, expectedSignature)) {
    return { ok: false, reason: "OAuth state signature mismatch." };
  }

  let payload: GitHubOAuthStatePayload;
  try {
    payload = decodePayload(encodedPayload);
  } catch {
    return { ok: false, reason: "Invalid OAuth state cookie." };
  }

  if (!secureEquals(payload.nonce, input.stateParam)) {
    return { ok: false, reason: "OAuth state value mismatch." };
  }
  if (!Number.isFinite(payload.createdAt)) {
    return { ok: false, reason: "OAuth state timestamp missing." };
  }
  if (Date.now() - payload.createdAt > MAX_STATE_AGE_MS) {
    return { ok: false, reason: "OAuth state expired." };
  }

  return { ok: true, payload };
}
