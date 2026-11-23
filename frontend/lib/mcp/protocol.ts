/**
 * Minimal MCP client (Model Context Protocol) – JSON-RPC 2.0 over
 *  - Streamable HTTP (remote servers like Notion, Linear, GitHub, Sentry …)
 *  - stdio (local servers started with a command, e.g. `npx -y @modelcontextprotocol/server-filesystem ~/Docs`)
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "Elyra Core", version: "1.0.0" };

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
};

export type McpCallResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string } }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export class McpAuthRequiredError extends Error {
  constructor(readonly resourceMetadataUrl: string | null, message = "Anmeldung beim MCP-Server erforderlich") {
    super(message);
  }
}

export class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

type JsonRpcResponse = { jsonrpc: "2.0"; id?: number | string; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export interface McpTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): void;
}

// ── Streamable HTTP ─────────────────────────────────────────────────────────

function parseResourceMetadata(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/resource_metadata="?([^",\s]+)"?/i);
  return m?.[1] ?? null;
}

async function readSseForId(res: Response, id: number): Promise<JsonRpcResponse> {
  const reader = res.body?.getReader();
  if (!reader) throw new McpError("Leere Antwort vom MCP-Server");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
        const data = rawEvent
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          const msg = JSON.parse(data) as JsonRpcResponse | JsonRpcResponse[];
          const list = Array.isArray(msg) ? msg : [msg];
          const hit = list.find((m) => m.id === id);
          if (hit) return hit;
        } catch {
          /* ignore non-JSON events */
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  throw new McpError("Keine Antwort im Event-Stream");
}

export class HttpTransport implements McpTransport {
  private sessionId: string | null = null;
  private nextId = 1;
  private negotiatedVersion: string | null = null;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly timeoutMs = 45_000,
  ) {}

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.negotiatedVersion ? { "MCP-Protocol-Version": this.negotiatedVersion } : {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...this.headers,
    };
  }

  private async post(body: unknown): Promise<Response> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "follow",
    });
    if (res.status === 401) throw new McpAuthRequiredError(parseResourceMetadata(res.headers.get("www-authenticate")));
    if (res.status === 403) {
      const text = await res.text().catch(() => "");
      throw new McpError(`Zugriff verweigert (403)${text ? `: ${text.slice(0, 160)}` : ""}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    return res;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpError(`MCP-Server antwortet mit HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    const type = res.headers.get("content-type") ?? "";
    const msg: JsonRpcResponse = type.includes("text/event-stream") ? await readSseForId(res, id) : ((await res.json()) as JsonRpcResponse);
    if (msg.error) throw new McpError(msg.error.message, msg.error.code);
    if (method === "initialize") {
      const v = (msg.result as { protocolVersion?: string } | undefined)?.protocolVersion;
      this.negotiatedVersion = v ?? MCP_PROTOCOL_VERSION;
    }
    return msg.result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const res = await this.post({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
    await res.body?.cancel().catch(() => undefined);
  }

  close(): void {
    if (!this.sessionId) return;
    const headers = this.buildHeaders();
    fetch(this.url, { method: "DELETE", headers, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  }
}

// ── stdio ───────────────────────────────────────────────────────────────────

export class StdioTransport implements McpTransport {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = "";
  private stderr = "";
  private exited: string | null = null;

  constructor(command: string, args: string[], env: Record<string, string>, private readonly timeoutMs = 60_000) {
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.proc.on("error", (err) => this.fail(`Start fehlgeschlagen: ${err.message}`));
    this.proc.on("exit", (code) => this.fail(`Prozess beendet (Code ${code ?? "?"})${this.stderr ? `: ${this.stderr.trim().slice(-300)}` : ""}`));
  }

  private fail(reason: string) {
    this.exited = reason;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new McpError(reason)); }
    this.pending.clear();
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse & { method?: string };
        if (typeof msg.id === "number" && this.pending.has(msg.id) && !msg.method) {
          const p = this.pending.get(msg.id)!;
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve(msg);
        } else if (msg.method && msg.id !== undefined) {
          // Server → client request (e.g. ping, roots/list): answer minimally.
          const result = msg.method === "roots/list" ? { roots: [] } : {};
          this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
        }
      } catch {
        /* log lines on stdout – ignore */
      }
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.exited) throw new McpError(this.exited);
    const id = this.nextId++;
    const msg = await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`Zeitüberschreitung bei ${method}${this.stderr ? ` – ${this.stderr.trim().slice(-200)}` : ""}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`);
    });
    if (msg.error) throw new McpError(msg.error.message, msg.error.code);
    return msg.result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.exited) return;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })}\n`);
  }

  get alive() { return !this.exited; }

  close(): void {
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (!this.exited) this.proc.kill("SIGTERM"); }, 500);
  }
}

// ── Client ──────────────────────────────────────────────────────────────────

export class McpClient {
  serverInfo: { name?: string; version?: string } | null = null;
  instructions: string | null = null;
  private initialized = false;

  constructor(readonly transport: McpTransport) {}

  async connect(): Promise<void> {
    if (this.initialized) return;
    const result = (await this.transport.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as { serverInfo?: { name?: string; version?: string }; instructions?: string };
    this.serverInfo = result?.serverInfo ?? null;
    this.instructions = result?.instructions ?? null;
    await this.transport.notify("notifications/initialized");
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = (await this.transport.request("tools/list", cursor ? { cursor } : {})) as { tools?: McpTool[]; nextCursor?: string };
      tools.push(...(res?.tools ?? []));
      if (!res?.nextCursor) break;
      cursor = res.nextCursor;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.connect();
    return (await this.transport.request("tools/call", { name, arguments: args })) as McpCallResult;
  }

  close() { this.transport.close(); }
}

/**
 * True if a tool only reads. Uses the server's annotations; if the server gives none,
 * typical read verbs in the name (search, get, list, read, ask …) count as read-only.
 */
export function isReadOnlyTool(t: McpTool): boolean {
  if (t.annotations?.readOnlyHint === true) return true;
  if (t.annotations?.readOnlyHint === false || t.annotations?.destructiveHint === true) return false;
  return /^(get|list|search|read|fetch|find|query|ask|describe|show|lookup|view|retrieve|count|check|resolve)(_|-|[A-Z]|$)/.test(t.name);
}

/** Plain text of a tool result, for display and for the model. */
export function resultToText(result: McpCallResult, max = 20_000): string {
  const parts: string[] = [];
  for (const c of result.content ?? []) {
    if (c.type === "text" && c.text) parts.push(c.text);
    else if (c.type === "resource" && c.resource?.text) parts.push(c.resource.text);
    else if (c.type === "resource" && c.resource?.uri) parts.push(`[Ressource] ${c.resource.uri}`);
    else if (c.type === "image") parts.push(`[Bild ${c.mimeType ?? ""}]`);
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  const text = parts.join("\n\n").trim() || "(keine Ausgabe)";
  return text.length > max ? `${text.slice(0, max)}\n… (gekürzt)` : text;
}
