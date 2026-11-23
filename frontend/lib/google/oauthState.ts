import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { safeNext } from "@/lib/safeNext";

export const GOOGLE_OAUTH_STATE_COOKIE = "elyra_google_oauth_state";
const MAX_STATE_AGE_MS = 30 * 60 * 1000;

type OAuthStatePayload = {
  nonce: string;
  workspaceId: string;
  userId: string;
  accessToken?: string;
  next: string;
  returnOrigin?: string;
  redirectUri: string;
  createdAt: number;
};

type SerializedOAuthState = {
  payload: OAuthStatePayload;
  encodedPayload: string;
  signature: string;
};

function signPayload(encodedPayload: string, key: Buffer): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

function encodePayload(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): OAuthStatePayload {
  const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as OAuthStatePayload;
  const accessToken =
    typeof parsed.accessToken === "string" && parsed.accessToken.trim().length > 0
      ? parsed.accessToken.trim()
      : null;
  return {
    nonce: parsed.nonce,
    workspaceId: parsed.workspaceId,
    userId: parsed.userId,
    ...(accessToken ? { accessToken } : {}),
    next: safeNext(parsed.next, "/os"),
    ...(typeof parsed.returnOrigin === "string" && parsed.returnOrigin.trim().length > 0
      ? { returnOrigin: parsed.returnOrigin.trim() }
      : {}),
    redirectUri: parsed.redirectUri,
    createdAt: Number(parsed.createdAt),
  };
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function serializeState(state: SerializedOAuthState): string {
  return `${state.encodedPayload}.${state.signature}`;
}

function parseSerializedState(serialized: string): SerializedOAuthState {
  const [encodedPayload, signature] = serialized.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid OAuth state payload.");
  }
  return {
    payload: decodePayload(encodedPayload),
    encodedPayload,
    signature,
  };
}

export function createOAuthState(input: {
  workspaceId: string;
  userId: string;
  accessToken?: string;
  next: string;
  returnOrigin?: string;
  redirectUri: string;
  key: Buffer;
}): { state: string; cookieValue: string; maxAgeSeconds: number } {
  const accessToken =
    typeof input.accessToken === "string" && input.accessToken.trim().length > 0
      ? input.accessToken.trim()
      : null;
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    workspaceId: input.workspaceId,
    userId: input.userId,
    ...(accessToken ? { accessToken } : {}),
    next: safeNext(input.next, "/os"),
    ...(typeof input.returnOrigin === "string" && input.returnOrigin.trim().length > 0
      ? { returnOrigin: input.returnOrigin.trim() }
      : {}),
    redirectUri: input.redirectUri,
    createdAt: Date.now(),
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload, input.key);

  return {
    state: payload.nonce,
    cookieValue: serializeState({ payload, encodedPayload, signature }),
    maxAgeSeconds: Math.floor(MAX_STATE_AGE_MS / 1000),
  };
}

export function verifyOAuthState(input: {
  stateParam: string | null;
  cookieValue: string | null;
  key: Buffer;
}):
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: string } {
  if (!input.stateParam || !input.cookieValue) {
    return { ok: false, reason: "Missing OAuth state." };
  }

  let parsed: SerializedOAuthState;
  try {
    parsed = parseSerializedState(input.cookieValue);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "Invalid OAuth state cookie.",
    };
  }

  const expectedSignature = signPayload(parsed.encodedPayload, input.key);
  if (!secureEquals(parsed.signature, expectedSignature)) {
    return { ok: false, reason: "OAuth state signature mismatch." };
  }

  if (!secureEquals(parsed.payload.nonce, input.stateParam)) {
    return { ok: false, reason: "OAuth state value mismatch." };
  }

  if (!Number.isFinite(parsed.payload.createdAt)) {
    return { ok: false, reason: "OAuth state timestamp missing." };
  }

  if (Date.now() - parsed.payload.createdAt > MAX_STATE_AGE_MS) {
    return { ok: false, reason: "OAuth state expired." };
  }

  return { ok: true, payload: parsed.payload };
}
