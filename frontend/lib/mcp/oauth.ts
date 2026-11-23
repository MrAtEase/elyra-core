/**
 * OAuth 2.1 for remote MCP servers (MCP authorization spec):
 * protected-resource discovery → authorization-server metadata → dynamic client registration → PKCE.
 */
import { createHash, randomBytes } from "node:crypto";

export type OAuthServerInfo = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes?: string[];
  resource: string;
};

export type OAuthClient = { client_id: string; client_secret?: string };

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  token_type?: string;
  scope?: string;
};

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "MCP-Protocol-Version": "2025-06-18" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function wellKnown(base: string, name: string): string[] {
  const u = new URL(base);
  const path = u.pathname.replace(/\/$/, "");
  const urls = [];
  if (path && path !== "/") urls.push(`${u.origin}/.well-known/${name}${path}`);
  urls.push(`${u.origin}/.well-known/${name}`);
  return urls;
}

export async function discoverOAuth(serverUrl: string, resourceMetadataUrl: string | null): Promise<OAuthServerInfo> {
  // 1) Protected Resource Metadata (RFC 9728)
  const prmCandidates = [...(resourceMetadataUrl ? [resourceMetadataUrl] : []), ...wellKnown(serverUrl, "oauth-protected-resource")];
  let prm: Record<string, unknown> | null = null;
  for (const url of prmCandidates) {
    prm = await getJson(url);
    if (prm) break;
  }
  const authServers = Array.isArray(prm?.authorization_servers) ? (prm!.authorization_servers as string[]) : [];
  const issuer = authServers[0] ?? new URL(serverUrl).origin;
  const resource = typeof prm?.resource === "string" ? (prm.resource as string) : serverUrl;

  // 2) Authorization Server Metadata (RFC 8414 / OIDC)
  let asm: Record<string, unknown> | null = null;
  for (const url of [...wellKnown(issuer, "oauth-authorization-server"), ...wellKnown(issuer, "openid-configuration")]) {
    asm = await getJson(url);
    if (asm?.authorization_endpoint && asm?.token_endpoint) break;
    asm = null;
  }
  if (!asm) throw new Error("Der Server unterstützt keine automatische Anmeldung (keine OAuth-Metadaten gefunden). Nutze stattdessen einen API-Schlüssel/Token.");

  const scopes = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as string[]) : undefined;
  return {
    issuer,
    authorization_endpoint: String(asm.authorization_endpoint),
    token_endpoint: String(asm.token_endpoint),
    ...(typeof asm.registration_endpoint === "string" ? { registration_endpoint: asm.registration_endpoint } : {}),
    ...(scopes?.length ? { scopes } : {}),
    resource,
  };
}

export async function registerClient(info: OAuthServerInfo, redirectUri: string): Promise<OAuthClient> {
  if (!info.registration_endpoint) {
    throw new Error("Der Server erlaubt keine automatische App-Registrierung. Bitte einen API-Schlüssel/Token verwenden.");
  }
  const res = await fetch(info.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      client_name: "Elyra Core",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(info.scopes?.length ? { scope: info.scopes.join(" ") } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error_description?: string; error?: string };
  if (!res.ok || !data.client_id) throw new Error(`App-Registrierung fehlgeschlagen: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  return { client_id: data.client_id, ...(data.client_secret ? { client_secret: data.client_secret } : {}) };
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function createPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(24));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(info: OAuthServerInfo, client: OAuthClient, redirectUri: string, pkce: { challenge: string; state: string }): string {
  const url = new URL(info.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("resource", info.resource);
  if (info.scopes?.length) url.searchParams.set("scope", info.scopes.join(" "));
  return url.toString();
}

async function tokenRequest(info: Pick<OAuthServerInfo, "token_endpoint">, client: OAuthClient, params: Record<string, string>): Promise<OAuthTokens> {
  const body = new URLSearchParams({ client_id: client.client_id, ...params });
  if (client.client_secret) body.set("client_secret", client.client_secret);
  const res = await fetch(info.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Token-Abruf fehlgeschlagen: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
  return {
    access_token: data.access_token,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    ...(data.expires_in ? { expires_at: Date.now() + data.expires_in * 1000 } : {}),
    ...(data.token_type ? { token_type: data.token_type } : {}),
    ...(data.scope ? { scope: data.scope } : {}),
  };
}

export function exchangeCode(info: OAuthServerInfo, client: OAuthClient, code: string, verifier: string, redirectUri: string) {
  return tokenRequest(info, client, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, resource: info.resource });
}

export async function refreshTokens(info: OAuthServerInfo, client: OAuthClient, refreshToken: string): Promise<OAuthTokens> {
  const t = await tokenRequest(info, client, { grant_type: "refresh_token", refresh_token: refreshToken, resource: info.resource });
  return { ...t, refresh_token: t.refresh_token ?? refreshToken };
}
