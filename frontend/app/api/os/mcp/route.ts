import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import { MCP_CATALOG, catalogEntry } from "@/lib/mcp/catalog";
import {
  createServer, deleteServer, getServer, listServers, McpStoreError, refreshServer, updateServer, withClient, type McpSecrets,
} from "@/lib/mcp/store";
import { buildAuthorizeUrl, createPkce, discoverOAuth, registerClient } from "@/lib/mcp/oauth";
import { resultToText } from "@/lib/mcp/protocol";
import { runMcpAgent } from "@/lib/mcp/agent";

export const runtime = "nodejs";
export const maxDuration = 120;

type Auth = { workspaceId: string; requested: string; userId: string | null; role: string };

async function authorize(request: NextRequest, requested: string): Promise<Auth | NextResponse> {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const payload = who.payload;
  const workspaces = (payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requested || null, workspaces) ?? requested;
  if (!workspaceId || !(hasWorkspaceAccess(payload, workspaceId) || hasWorkspaceAccess(payload, requested))) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  return { workspaceId, requested: requested || workspaceId, userId: getWhoamiUserId(payload), role: String(payload.membership?.role ?? "owner").toLowerCase() };
}

const canManage = (role: string) => role === "owner" || role === "admin" || role === "manager";

async function startOAuth(request: NextRequest, auth: Auth, id: string, resourceMetadataUrl: string | null): Promise<string> {
  const { row, secrets } = await getServer(auth.workspaceId, id);
  if (!row.url) throw new McpStoreError("Keine Server-URL.");
  const redirectUri = `${request.nextUrl.origin}/api/os/mcp/oauth/callback`;
  const server = await discoverOAuth(row.url, resourceMetadataUrl);
  const client = secrets.oauth?.client && secrets.oauth.server.issuer === server.issuer ? secrets.oauth.client : await registerClient(server, redirectUri);
  const pkce = createPkce();
  await updateServer(auth.workspaceId, id, {
    auth_type: "oauth",
    status: "needs_auth",
    secrets: { ...secrets, oauth: { server, client, ...(secrets.oauth?.tokens ? { tokens: secrets.oauth.tokens } : {}) } },
    oauth_pending: { state: pkce.state, verifier: pkce.verifier, redirect_uri: redirectUri, return_to: `/os?workspaceId=${encodeURIComponent(auth.requested)}&mcp=${encodeURIComponent(row.name)}` },
  });
  return buildAuthorizeUrl(server, client, redirectUri, pkce);
}

/** GET /api/os/mcp?workspaceId=… → catalog + configured servers */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, (request.nextUrl.searchParams.get("workspaceId") ?? "").trim());
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ ok: true, role: auth.role, catalog: MCP_CATALOG, servers: await listServers(auth.workspaceId) });
  } catch (error) {
    return NextResponse.json({ ok: true, role: auth.role, catalog: MCP_CATALOG, servers: [], setup_error: error instanceof Error ? error.message : String(error) });
  }
}

/** POST /api/os/mcp – { workspaceId, action: add|connect|auth|remove|toggle|call|agent, … } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await authorize(request, typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
  if (auth instanceof NextResponse) return auth;
  const action = String(body.action ?? "");
  const id = typeof body.id === "string" ? body.id : "";
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  try {
    if (action === "agent") {
      const prompt = str(body.prompt);
      if (!prompt) return NextResponse.json({ ok: false, error: "Bitte eine Aufgabe eingeben." }, { status: 400 });
      const approved = body.approvedCall as { serverId?: string; tool?: string; args?: Record<string, unknown> } | undefined;
      const result = await runMcpAgent({
        workspaceId: auth.workspaceId,
        prompt,
        ...(Array.isArray(body.serverIds) ? { serverIds: body.serverIds.filter((x): x is string => typeof x === "string") } : {}),
        allowWrites: body.allowWrites === true,
        ...(approved?.serverId && approved.tool ? { approvedCall: { serverId: approved.serverId, tool: approved.tool, args: approved.args ?? {} } } : {}),
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "call") {
      const tool = str(body.tool);
      const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
      const out = await withClient(auth.workspaceId, id, (c) => c.callTool(tool, args));
      return NextResponse.json({ ok: true, isError: Boolean(out.isError), text: resultToText(out) });
    }

    if (!canManage(auth.role)) return NextResponse.json({ ok: false, error: "Nur Owner/Admin können Dienste verbinden." }, { status: 403 });

    if (action === "add") {
      const entry = catalogEntry(str(body.catalogId));
      const transport = entry?.transport ?? (str(body.transport) === "stdio" ? "stdio" : "http");
      const token = str(body.token);
      const secrets: McpSecrets = {};
      let url: string | null = null;
      let command: string | null = null;
      let args: string[] = [];

      if (transport === "http") {
        url = entry?.url ?? str(body.url);
        if (!/^https:\/\/|^http:\/\/localhost|^http:\/\/127\.0\.0\.1/.test(url)) return NextResponse.json({ ok: false, error: "Bitte eine gültige https-URL angeben." }, { status: 400 });
        if (/\/sse\/?$/.test(url)) return NextResponse.json({ ok: false, error: "Diese URL nutzt das alte SSE-Verfahren. Bitte die Streamable-HTTP-URL des Dienstes verwenden (meist …/mcp)." }, { status: 400 });
        if (token) secrets.headers = { [str(body.headerName) || "Authorization"]: str(body.headerName) ? token : `Bearer ${token}` };
      } else {
        command = entry?.command ?? str(body.command);
        args = [...(entry?.args ?? []), ...(Array.isArray(body.args) ? body.args.map(String) : str(body.argsLine) ? str(body.argsLine).split(/\s+/) : [])];
        const extra = str(body.argValue);
        if (extra) args.push(extra);
        if (!command) return NextResponse.json({ ok: false, error: "Startbefehl fehlt." }, { status: 400 });
        const envText = str(body.env);
        if (envText) {
          secrets.env = Object.fromEntries(envText.split(/\n/).map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
        }
      }

      const wantsOAuth = transport === "http" && !token && (entry?.auth === "oauth" || entry?.auth === "oauth_or_token");
      const server = await createServer({
        workspaceId: auth.workspaceId,
        name: str(body.name) || entry?.name || (url ? new URL(url).hostname : command ?? "MCP"),
        catalogId: entry?.id ?? null,
        transport, url, command, args,
        authType: token ? "token" : wantsOAuth ? "oauth" : "none",
        secrets,
      });

      if (wantsOAuth) {
        const authUrl = await startOAuth(request, auth, server.id, null);
        return NextResponse.json({ ok: true, id: server.id, status: "needs_auth", authUrl });
      }
      const result = await refreshServer(auth.workspaceId, server.id);
      if (result.status === "needs_auth" && transport === "http" && !token) {
        try {
          const authUrl = await startOAuth(request, auth, server.id, result.resourceMetadataUrl ?? null);
          return NextResponse.json({ ok: true, id: server.id, status: "needs_auth", authUrl });
        } catch (err) {
          return NextResponse.json({ ok: true, id: server.id, status: "needs_auth", error: err instanceof Error ? err.message : String(err) });
        }
      }
      return NextResponse.json({ ok: true, id: server.id, ...result });
    }

    if (action === "connect") {
      const result = await refreshServer(auth.workspaceId, id);
      if (result.status === "needs_auth") {
        const { row } = await getServer(auth.workspaceId, id);
        if (row.transport === "http" && row.auth_type !== "token") {
          const authUrl = await startOAuth(request, auth, id, result.resourceMetadataUrl ?? null);
          return NextResponse.json({ ok: true, status: "needs_auth", authUrl });
        }
      }
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "auth") {
      return NextResponse.json({ ok: true, authUrl: await startOAuth(request, auth, id, null) });
    }

    if (action === "remove") {
      await deleteServer(auth.workspaceId, id);
      return NextResponse.json({ ok: true });
    }

    if (action === "toggle") {
      await updateServer(auth.workspaceId, id, { enabled: body.enabled === true });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: error instanceof McpStoreError ? 400 : 502 });
  }
}
