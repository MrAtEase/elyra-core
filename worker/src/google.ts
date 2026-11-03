import { Env } from "./types";
import { safeNext } from "./lib/safeNext";

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  obtained_at: number;
  expires_at?: number;
  refreshToken?: string;
};

function userTokenKey(userKey: string) {
  return `google_tokens:${userKey}`;
}

function workspaceTokenKey(userKey: string, workspaceId?: string) {
  if (!workspaceId) return userTokenKey(userKey);
  return `${userTokenKey(userKey)}:${workspaceId}`;
}

export function kvKey(env: Env, user = env.DEFAULT_USER_KEY || "paul") {
  return userTokenKey(user);
}

export const DEFAULT_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

async function loadGoogleTokens(env: Env, userKey: string, workspaceId?: string): Promise<any | null> {
  if (!env.ASSISTANT_KV) return null;
  const keys: string[] = [];
  if (workspaceId) keys.push(workspaceTokenKey(userKey, workspaceId));
  keys.push(userTokenKey(userKey));

  for (const key of keys) {
    console.log("[google] loadGoogleTokens trying key", { key, userKey, workspaceId });
    const raw = await env.ASSISTANT_KV.get(key);
    if (!raw) {
      console.log("[google] loadGoogleTokens no token at key", key);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      console.log("[google] loadGoogleTokens found tokens for key", key);
      return parsed;
    } catch (err) {
      console.error("[google] loadGoogleTokens failed to parse key", key, err);
    }
  }

  console.log("[google] loadGoogleTokens nothing found", { userKey, workspaceId });
  return null;
}

export async function saveGoogleTokens(env: Env, tokens: any, userKey: string, workspaceId?: string): Promise<void> {
  if (!env.ASSISTANT_KV) return;
  await env.ASSISTANT_KV.put(userTokenKey(userKey), JSON.stringify(tokens));
  if (workspaceId) {
    await env.ASSISTANT_KV.put(workspaceTokenKey(userKey, workspaceId), JSON.stringify(tokens));
  }
}

export async function refreshGoogleAccessTokenIfNeeded(env: Env, userKey: string, workspaceId?: string): Promise<any> {
  const clientId = (env.GOOGLE_CLIENT_ID || "").toString().trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || "").toString().trim();

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }
  if (!env.ASSISTANT_KV) {
    throw new Error("ASSISTANT_KV binding not configured");
  }

  let tokens = await loadGoogleTokens(env, userKey, workspaceId);
  if (!tokens) {
    throw new Error("No Google tokens stored – run /api/google/auth first");
  }

  const now = Math.floor(Date.now() / 1000);

  if (tokens.access_token && typeof tokens.expires_at === "number" && tokens.expires_at - 60 > now) {
    return tokens;
  }

  const refreshToken = tokens.refresh_token || tokens.refreshToken;
  if (!refreshToken) {
    throw new Error("No refresh_token available to refresh Google access token");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Failed to refresh Google token: ${resp.status} ${text}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Failed to parse Google token refresh response");
  }

  const obtainedAt = Math.floor(Date.now() / 1000);
  tokens.access_token = json.access_token || tokens.access_token;
  if (json.expires_in) {
    tokens.expires_at = obtainedAt + Number(json.expires_in);
  }
  if (json.refresh_token) {
    tokens.refresh_token = json.refresh_token;
  }
  tokens.obtained_at = obtainedAt;

  await saveGoogleTokens(env, tokens, userKey, workspaceId);
  return tokens;
}

function encodeBase64Url(value: string) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : "";
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRawMessage(options: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
}) {
  const headers = [];
  if (options.from) headers.push(`From: ${options.from}`);
  headers.push(`To: ${options.to}`);
  headers.push(`Subject: ${options.subject}`);
  if (options.inReplyTo) headers.push(`In-Reply-To: <${options.inReplyTo}>`);
  if (options.references) headers.push(`References: <${options.references}>`);
  headers.push("Content-Type: text/plain; charset=utf-8");
  headers.push("");
  headers.push(options.body);
  return headers.join("\r\n");
}

export async function sendGmailReply(
  env: Env,
  userKey: string,
  workspaceId: string | undefined,
  message: {
    threadId?: string;
    to: string;
    from?: string;
    subject: string;
    bodyText: string;
    inReplyToMessageId?: string;
  }
): Promise<{ id: string; threadId?: string }> {
  const tokenData = await getAccessTokenFromKV(env, userKey, workspaceId);
  const accessToken = (tokenData as any).accessToken || (tokenData as any).access_token;
  if (!accessToken) {
    throw new Error("sendGmailReply: no access token available");
  }
  const raw = buildRawMessage({
    to: message.to,
    subject: message.subject,
    body: message.bodyText,
    inReplyTo: message.inReplyToMessageId,
    references: message.inReplyToMessageId,
    from: message.from,
  });
  const payload: any = {
    raw: encodeBase64Url(raw),
  };
  if (message.threadId) {
    payload.threadId = message.threadId;
  }
  console.log("[gmail] send reply", { userKey, threadId: message.threadId });
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error("[gmail] send failed", resp.status, text);
    throw new Error(`gmail send failed: ${resp.status} ${text}`);
  }
  const json = JSON.parse(text || "{}");
  return { id: json?.id, threadId: json?.threadId };
}

export async function getAccessTokenFromKV(
  env: Env,
  userKey: string,
  workspaceId?: string
): Promise<{ accessToken: string; expiry?: number }> {
  if (!userKey) {
    throw new Error("getAccessTokenFromKV: userKey is required");
  }
  console.log("[google] getAccessTokenFromKV lookup", { userKey, workspaceId });
  const tokens = await refreshGoogleAccessTokenIfNeeded(env, userKey, workspaceId);
  if (!tokens?.access_token) {
    throw new Error("getAccessTokenFromKV: no access_token available");
  }
  const expirySeconds =
    typeof tokens.expires_at === "number"
      ? Number(tokens.expires_at)
      : typeof tokens.expires_at === "string"
      ? Number(tokens.expires_at)
      : undefined;
  return {
    accessToken: tokens.access_token,
    expiry: expirySeconds ? expirySeconds * 1000 : undefined,
  };
}

function localRedirectFromRequest(request: Request): string | null {
  try {
    const parsed = new URL(request.url);
    const host = parsed.hostname.toLowerCase();
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("192.168.");
    if (!isLocalHost) return null;
    return `${parsed.origin}/assistant/oauth/google/callback`;
  } catch {
    return null;
  }
}

export async function googleAuthUrl(env: Env, state: string, redirectUri?: string) {
  const redirect = redirectUri || getRedirectUri(env);
  const scopes = env.GOOGLE_SCOPES?.trim() || DEFAULT_SCOPES;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function getRedirectUri(env: Env, request?: Request) {
  const localFromRequest = request ? localRedirectFromRequest(request) : null;
  if (localFromRequest) {
    return localFromRequest;
  }

  // Prefer the configured redirect, otherwise fall back to a placeholder that
  // makes it obvious in the UI/config that it still needs to be set.
  const configured = env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) {
    return configured;
  }
  const publicApiOrigin = (env as any).PUBLIC_API_ORIGIN?.trim();
  if (publicApiOrigin) {
    try {
      return `${new URL(publicApiOrigin).origin}/assistant/oauth/google/callback`;
    } catch {
      // ignore invalid PUBLIC_API_ORIGIN and fall through to placeholder
    }
  }
  return "https://<your-worker-domain>/auth/google/callback";
}

export async function exchangeCodeForTokens(env: Env, code: string, redirectUri?: string): Promise<Tokens> {
  const redirect_uri = redirectUri || getRedirectUri(env);
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token exchange failed: ${r.status} ${t}`);
  }
  const json = (await r.json()) as Tokens;
  json.obtained_at = Date.now();
  return json;
}

export async function getAccessToken(env: Env): Promise<string> {
  const store = env.ASSISTANT_KV;
  if (!store) {
    throw new Error("ASSISTANT_KV binding is not configured");
  }
  const key = kvKey(env);
  const raw = await store.get(key);
  if (!raw) throw new Error("No Google tokens stored. Visit /auth/google/start first.");
  const tokens = JSON.parse(raw) as Tokens;
  const expiresAt = tokens.obtained_at + (tokens.expires_in - 60) * 1000;
  if (Date.now() < expiresAt) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("No refresh_token stored; re-link account.");
  const refreshed = await refreshAccessToken(env, tokens.refresh_token);
  await store.put(key, JSON.stringify(refreshed));
  return refreshed.access_token;
}

async function refreshAccessToken(env: Env, refresh_token: string): Promise<Tokens> {
  const body = new URLSearchParams({
    refresh_token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Refresh failed: ${r.status} ${t}`);
  }
  const json = (await r.json()) as Tokens;
  json.refresh_token = json.refresh_token || refresh_token;
  json.obtained_at = Date.now();
  return json;
}

function nowMs() {
  return Date.now();
}

function newState() {
  return crypto.randomUUID();
}

function redirectOAuthErrorToApp(env: Env, message: string, next = "/os"): Response {
  const appOrigin = env.PUBLIC_APP_ORIGIN || "http://localhost:3000";
  const target = new URL(next, appOrigin);
  target.searchParams.set("google_error", message);
  return Response.redirect(target.toString(), 302);
}

function pickUserKey(env: Env) {
  // Prefer configured default user key if your system uses it (prod has DEFAULT_USER_KEY).
  // Fallback to the Vision bootstrap owner.
  return (env as any).DEFAULT_USER_KEY?.trim() || "vision-bootstrap-owner";
}

export async function googleOAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ ok: false, message: "Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (!env.ASSISTANT_KV) {
    return new Response(JSON.stringify({ ok: false, message: "Missing ASSISTANT_KV binding" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") || "/os";
  const next = safeNext(nextRaw, "/os");

  const state = newState();
  const userKey = pickUserKey(env);
  const redirectUri = getRedirectUri(env, request);

  // Store state -> next (+ userKey) in KV for callback validation
  await env.ASSISTANT_KV.put(
    `google_oauth_state:${state}`,
    JSON.stringify({ next, userKey, redirectUri, createdAt: nowMs() }),
    { expirationTtl: 30 * 60 } // 30 min
  );

  const authUrl = await googleAuthUrl(env, state, redirectUri);
  return Response.redirect(authUrl, 302);
}

export async function googleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!env.ASSISTANT_KV) {
    return new Response(JSON.stringify({ ok: false, message: "Missing ASSISTANT_KV binding" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  if (!code || !state) {
    return redirectOAuthErrorToApp(env, "Missing OAuth callback params. Please reconnect Google.");
  }

  const raw = await env.ASSISTANT_KV.get(`google_oauth_state:${state}`);
  if (!raw) {
    return redirectOAuthErrorToApp(env, "Google OAuth state expired. Please reconnect Google.");
  }

  const parsed = JSON.parse(raw) as { next: string; userKey: string; redirectUri?: string };
  await env.ASSISTANT_KV.delete(`google_oauth_state:${state}`);

  const redirectUri = parsed.redirectUri || getRedirectUri(env, request);
  const tokens = await exchangeCodeForTokens(env, code, redirectUri);

  // IMPORTANT: store tokens using the SAME key scheme the rest of google.ts expects.
  // google.ts already uses kvKey(env) in getAccessToken(), so we reuse it here.
  const key = kvKey(env, parsed.userKey);
  await env.ASSISTANT_KV.put(key, JSON.stringify(tokens));

  const appOrigin = env.PUBLIC_APP_ORIGIN || "http://localhost:3000";
  return Response.redirect(`${appOrigin}${parsed.next}`, 302);
}
