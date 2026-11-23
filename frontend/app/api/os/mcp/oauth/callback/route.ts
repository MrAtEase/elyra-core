import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/mcp/oauth";
import { findByOAuthState, getServer, refreshServer, updateServer } from "@/lib/mcp/store";

export const runtime = "nodejs";

/** GET /api/os/mcp/oauth/callback?code=…&state=… – finishes the OAuth sign-in of a remote MCP server. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const back = (path: string, query: Record<string, string>) => {
    const url = new URL(path, request.nextUrl.origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  if (!state) return back("/os", { mcp_error: "Anmeldung ohne state-Parameter" });
  const row = await findByOAuthState(state).catch(() => null);
  if (!row?.oauth_pending) return back("/os", { mcp_error: "Anmeldung abgelaufen – bitte erneut verbinden" });

  const pending = row.oauth_pending as { verifier: string; redirect_uri: string; return_to?: string };
  const returnTo = pending.return_to ?? "/os";

  if (params.get("error") || !code) {
    await updateServer(row.workspace_id, row.id, { oauth_pending: null, status: "needs_auth", last_error: params.get("error_description") ?? params.get("error") ?? "Abgebrochen" });
    return back(returnTo, { mcp_error: params.get("error_description") ?? params.get("error") ?? "Anmeldung abgebrochen" });
  }

  try {
    const { secrets } = await getServer(row.workspace_id, row.id);
    if (!secrets.oauth) throw new Error("OAuth-Daten fehlen");
    const tokens = await exchangeCode(secrets.oauth.server, secrets.oauth.client, code, pending.verifier, pending.redirect_uri);
    await updateServer(row.workspace_id, row.id, { oauth_pending: null, auth_type: "oauth", secrets: { ...secrets, oauth: { ...secrets.oauth, tokens } } });
    const result = await refreshServer(row.workspace_id, row.id);
    const url = new URL(returnTo, request.nextUrl.origin);
    url.searchParams.set(result.status === "connected" ? "mcp_ok" : "mcp_error", result.status === "connected" ? `${row.name}: ${result.tools.length} Werkzeuge` : result.error ?? "Verbindung fehlgeschlagen");
    return NextResponse.redirect(url);
  } catch (err) {
    await updateServer(row.workspace_id, row.id, { oauth_pending: null, status: "error", last_error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    return back(returnTo, { mcp_error: err instanceof Error ? err.message : "Anmeldung fehlgeschlagen" });
  }
}
