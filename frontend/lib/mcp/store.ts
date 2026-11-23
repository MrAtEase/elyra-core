/**
 * Storage + connections for MCP servers of a workspace (table public.mcp_servers, migration 0014).
 * Secrets (tokens, env vars, OAuth tokens) are stored AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY.
 */
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptGoogleSecret, encryptGoogleSecret } from "@/lib/google/crypto";
import { HttpTransport, McpAuthRequiredError, McpClient, StdioTransport, type McpTool } from "@/lib/mcp/protocol";
import { refreshTokens, type OAuthClient, type OAuthServerInfo, type OAuthTokens } from "@/lib/mcp/oauth";

export type McpSecrets = {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: { server: OAuthServerInfo; client: OAuthClient; tokens?: OAuthTokens };
};

export type McpServerRow = {
  id: string;
  workspace_id: string;
  name: string;
  catalog_id: string | null;
  transport: "http" | "stdio";
  url: string | null;
  command: string | null;
  args: string[];
  auth_type: "none" | "token" | "oauth";
  status: "connected" | "needs_auth" | "error" | "new";
  last_error: string | null;
  tools: McpTool[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type DbRow = McpServerRow & { secrets_enc: string | null; oauth_pending: Record<string, unknown> | null };

const TABLE = "mcp_servers";
const PUBLIC_COLUMNS = "id,workspace_id,name,catalog_id,transport,url,command,args,auth_type,status,last_error,tools,enabled,created_at,updated_at";

export class McpStoreError extends Error {}

function encKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new McpStoreError("TOKEN_ENCRYPTION_KEY fehlt oder ist ungültig – wird zum sicheren Speichern von Zugangsdaten gebraucht.");
  return Buffer.from(hex, "hex");
}

export function sealSecrets(secrets: McpSecrets): string {
  return encryptGoogleSecret(JSON.stringify(secrets), encKey());
}

function openSecrets(enc: string | null): McpSecrets {
  if (!enc) return {};
  const plain = decryptGoogleSecret(enc, encKey());
  if (!plain) return {};
  try { return JSON.parse(plain) as McpSecrets; } catch { return {}; }
}

function dbError(message: string): never {
  if (/relation .*mcp_servers.* does not exist|Could not find the table/i.test(message)) {
    throw new McpStoreError("Tabelle für MCP fehlt – bitte frontend/db/migrations/0014_mcp_servers.sql im Supabase SQL Editor ausführen.");
  }
  throw new McpStoreError(message);
}

export async function listServers(workspaceId: string): Promise<McpServerRow[]> {
  const { data, error } = await getSupabaseAdminClient().from(TABLE).select(PUBLIC_COLUMNS).eq("workspace_id", workspaceId).order("created_at");
  if (error) dbError(error.message);
  return (data ?? []) as unknown as McpServerRow[];
}

async function getRow(workspaceId: string, id: string): Promise<DbRow> {
  const { data, error } = await getSupabaseAdminClient().from(TABLE).select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) dbError(error.message);
  if (!data) throw new McpStoreError("MCP-Server nicht gefunden.");
  return data as unknown as DbRow;
}

export async function getServer(workspaceId: string, id: string) {
  const row = await getRow(workspaceId, id);
  return { row, secrets: openSecrets(row.secrets_enc) };
}

export async function createServer(input: {
  workspaceId: string; name: string; catalogId: string | null; transport: "http" | "stdio";
  url?: string | null; command?: string | null; args?: string[]; authType: "none" | "token" | "oauth"; secrets: McpSecrets;
}): Promise<McpServerRow> {
  const { data, error } = await getSupabaseAdminClient()
    .from(TABLE)
    .insert({
      workspace_id: input.workspaceId, name: input.name, catalog_id: input.catalogId, transport: input.transport,
      url: input.url ?? null, command: input.command ?? null, args: input.args ?? [], auth_type: input.authType,
      secrets_enc: Object.keys(input.secrets).length ? sealSecrets(input.secrets) : null, status: "new", tools: [], enabled: true,
    })
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) dbError(error.message);
  return data as unknown as McpServerRow;
}

export async function updateServer(workspaceId: string, id: string, patch: Partial<Omit<DbRow, "id" | "workspace_id">> & { secrets?: McpSecrets }) {
  const { secrets, ...rest } = patch;
  const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (secrets) update.secrets_enc = sealSecrets(secrets);
  const { error } = await getSupabaseAdminClient().from(TABLE).update(update).eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbError(error.message);
}

export async function deleteServer(workspaceId: string, id: string) {
  closeStdio(id);
  const { error } = await getSupabaseAdminClient().from(TABLE).delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbError(error.message);
}

export async function findByOAuthState(state: string): Promise<DbRow | null> {
  const { data, error } = await getSupabaseAdminClient().from(TABLE).select("*").eq("oauth_pending->>state", state).maybeSingle();
  if (error) dbError(error.message);
  return (data as unknown as DbRow) ?? null;
}

// ── Connections ─────────────────────────────────────────────────────────────

type StdioEntry = { client: McpClient; transport: StdioTransport; lastUsed: number };
const g = globalThis as unknown as { __elyraMcpStdio?: Map<string, StdioEntry> };
const stdioPool: Map<string, StdioEntry> = g.__elyraMcpStdio ?? (g.__elyraMcpStdio = new Map());

function closeStdio(id: string) {
  const entry = stdioPool.get(id);
  if (entry) { entry.client.close(); stdioPool.delete(id); }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of stdioPool) if (now - entry.lastUsed > 10 * 60_000 || !entry.transport.alive) closeStdio(id);
}, 60_000).unref?.();

async function authHeaders(row: DbRow, secrets: McpSecrets): Promise<Record<string, string>> {
  const headers = { ...(secrets.headers ?? {}) };
  const oauth = secrets.oauth;
  if (row.auth_type === "oauth") {
    if (!oauth?.tokens?.access_token) throw new McpAuthRequiredError(null);
    let tokens = oauth.tokens;
    if (tokens.expires_at && tokens.expires_at < Date.now() + 60_000) {
      if (!tokens.refresh_token) throw new McpAuthRequiredError(null, "Anmeldung abgelaufen – bitte neu verbinden");
      tokens = await refreshTokens(oauth.server, oauth.client, tokens.refresh_token);
      await updateServer(row.workspace_id, row.id, { secrets: { ...secrets, oauth: { ...oauth, tokens } } });
    }
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  return headers;
}

/** Runs fn with a connected client; HTTP clients are per call, stdio processes are pooled. */
export async function withClient<T>(workspaceId: string, id: string, fn: (client: McpClient) => Promise<T>): Promise<T> {
  const { row, secrets } = await getServer(workspaceId, id);
  if (row.transport === "stdio") {
    let entry = stdioPool.get(id);
    if (!entry || !entry.transport.alive) {
      if (!row.command) throw new McpStoreError("Kein Startbefehl hinterlegt.");
      const transport = new StdioTransport(row.command, row.args ?? [], secrets.env ?? {});
      entry = { client: new McpClient(transport), transport, lastUsed: Date.now() };
      stdioPool.set(id, entry);
    }
    entry.lastUsed = Date.now();
    return fn(entry.client);
  }
  if (!row.url) throw new McpStoreError("Keine Server-URL hinterlegt.");
  const client = new McpClient(new HttpTransport(row.url, await authHeaders(row, secrets)));
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Connects, refreshes the tool list and stores status. */
export async function refreshServer(workspaceId: string, id: string): Promise<{ status: McpServerRow["status"]; tools: McpTool[]; error?: string; resourceMetadataUrl?: string | null }> {
  try {
    const tools = await withClient(workspaceId, id, (c) => c.listTools());
    await updateServer(workspaceId, id, { status: "connected", last_error: null, tools });
    return { status: "connected", tools };
  } catch (err) {
    if (err instanceof McpAuthRequiredError) {
      await updateServer(workspaceId, id, { status: "needs_auth", last_error: err.message });
      return { status: "needs_auth", tools: [], error: err.message, resourceMetadataUrl: err.resourceMetadataUrl };
    }
    const message = err instanceof Error ? err.message : String(err);
    await updateServer(workspaceId, id, { status: "error", last_error: message.slice(0, 500) }).catch(() => undefined);
    return { status: "error", tools: [], error: message };
  }
}
