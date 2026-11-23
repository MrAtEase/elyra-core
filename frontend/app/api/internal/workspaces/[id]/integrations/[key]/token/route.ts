/**
 * Internal Token Bridge
 * GET /api/internal/workspaces/[id]/integrations/[key]/token
 *
 * Server-to-server only. Called by the Cloudflare Worker to resolve
 * credential status without ever exposing secrets to the browser.
 *
 * Auth: x-elyra-internal-secret header must match ELYRA_INTERNAL_SECRET env var
 * (falls back to INTERNAL_API_SECRET for backward compat).
 *
 * Returns a TokenBridgePayload — presence flags + decrypted credentials
 * stripped of anything beyond what the Worker needs to derive connected/state.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptIntegrationSecret } from "@/lib/integrations/crypto";
import { loadStoredGoogleTokens } from "@/lib/google/tokenStore";
import { loadStoredGitHubToken } from "@/lib/github/tokenStore";
import { getGoogleServerEnvSafe } from "@/lib/google/env";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function resolveInternalSecret(): string {
  return (
    process.env.ELYRA_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.INTERNAL_API_KEY ||
    ""
  ).trim();
}

function isAuthorized(request: NextRequest): boolean {
  const expected = resolveInternalSecret();
  if (!expected) return false; // secret must be configured
  const provided = (request.headers.get("x-elyra-internal-secret") ?? "").trim();
  if (!provided || provided.length !== expected.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const LEGACY_IMAP_TOKEN_PREFIX = "imap_v1:";

function decodeLegacyImap(value: string | null | undefined): {
  username?: string | null;
  encryptedPassword?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
} | null {
  if (!value?.startsWith(LEGACY_IMAP_TOKEN_PREFIX)) return null;
  try {
    const raw = Buffer.from(value.slice(LEGACY_IMAP_TOKEN_PREFIX.length), "base64url").toString("utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider resolvers
// ---------------------------------------------------------------------------
async function resolveGoogle(workspaceId: string): Promise<NextResponse> {
  const envStatus = getGoogleServerEnvSafe();
  if (!envStatus.ok) {
    return NextResponse.json({ integrationKey: "google_oauth", present: false });
  }
  try {
    const stored = await loadStoredGoogleTokens(workspaceId, null);
    if (!stored) {
      return NextResponse.json({ integrationKey: "google_oauth", present: false });
    }
    return NextResponse.json({
      integrationKey: "google_oauth",
      present: Boolean(stored.accessToken || stored.refreshToken),
      scopes: stored.scopes ?? [],
      accessToken: stored.accessToken ?? null,
      refreshToken: stored.refreshToken ?? null,
      expiresAt: stored.expiresAtMs ? new Date(stored.expiresAtMs).toISOString() : null,
    });
  } catch {
    return NextResponse.json({ integrationKey: "google_oauth", present: false });
  }
}

async function resolveImap(workspaceId: string, integrationKey: string): Promise<NextResponse> {
  const supabase = getSupabaseAdminClient();

  // Try new columns first
  const { data: rows, error } = await supabase
    .from("integrations")
    .select("id,provider,status,username,encrypted_password,imap_host,imap_port,smtp_host,smtp_port,ssl_tls_enabled,updated_at")
    .eq("workspace_id", workspaceId)
    .in("provider", ["imap", "icloud_imap"])
    .order("updated_at", { ascending: false });

  if (!error && Array.isArray(rows) && rows.length > 0) {
    // Pick best row: connected > error > rest, imap > icloud_imap
    const sorted = [...rows].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const sr = (s: unknown) => (s === "connected" ? 3 : s === "error" ? 2 : 1);
      const pr = (p: unknown) => (p === "imap" ? 2 : p === "icloud_imap" ? 1 : 0);
      const sd = sr(b.status) - sr(a.status);
      if (sd !== 0) return sd;
      return pr(b.provider) - pr(a.provider);
    });
    const row = sorted[0] as Record<string, unknown>;
    const encPw = typeof row?.encrypted_password === "string" ? row.encrypted_password : null;
    const username = typeof row?.username === "string" ? row.username : null;

    if (encPw && username) {
      try {
        const password = decryptIntegrationSecret(encPw);
        return NextResponse.json({
          integrationKey,
          present: true,
          host: row.imap_host ?? "imap.mail.me.com",
          port: row.imap_port ?? 993,
          username,
          password,
        });
      } catch {
        // fall through to legacy
      }
    }
  }

  // Legacy fallback: read from integration_tokens.refresh_token
  const { data: intRows } = await supabase
    .from("integrations")
    .select("id,status,updated_at,provider")
    .eq("workspace_id", workspaceId)
    .in("provider", ["imap", "icloud_imap"])
    .order("updated_at", { ascending: false });

  if (!Array.isArray(intRows) || intRows.length === 0) {
    return NextResponse.json({ integrationKey, present: false });
  }
  const bestInt = (intRows as Array<Record<string, unknown>>)[0]!;
  if (!bestInt.id) return NextResponse.json({ integrationKey, present: false });

  const { data: tokenRows } = await supabase
    .from("integration_tokens")
    .select("refresh_token")
    .eq("integration_id", String(bestInt.id))
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  const tokenRow = Array.isArray(tokenRows) ? (tokenRows[0] as Record<string, unknown> | undefined) : undefined;
  const legacy = decodeLegacyImap(typeof tokenRow?.refresh_token === "string" ? tokenRow.refresh_token : null);
  if (!legacy?.username || !legacy?.encryptedPassword) {
    return NextResponse.json({ integrationKey, present: false });
  }
  try {
    const password = decryptIntegrationSecret(legacy.encryptedPassword);
    return NextResponse.json({
      integrationKey,
      present: true,
      host: legacy.imapHost ?? "imap.mail.me.com",
      port: legacy.imapPort ?? 993,
      username: legacy.username,
      password,
    });
  } catch {
    return NextResponse.json({ integrationKey, present: false });
  }
}

async function resolveCalDAV(workspaceId: string): Promise<NextResponse> {
  const supabase = getSupabaseAdminClient();
  const { data: rows } = await supabase
    .from("integrations")
    .select("id,status,username,encrypted_password,imap_host,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "icloud_caldav")
    .order("updated_at", { ascending: false })
    .limit(1);

  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return NextResponse.json({ integrationKey: "icloud_caldav", present: false });

  const encPw = typeof row.encrypted_password === "string" ? row.encrypted_password : null;
  const username = typeof row.username === "string" ? row.username : null;
  if (!encPw || !username) return NextResponse.json({ integrationKey: "icloud_caldav", present: false });

  try {
    const password = decryptIntegrationSecret(encPw);
    return NextResponse.json({
      integrationKey: "icloud_caldav",
      present: true,
      host: row.imap_host ?? "caldav.icloud.com",
      username,
      password,
    });
  } catch {
    return NextResponse.json({ integrationKey: "icloud_caldav", present: false });
  }
}

async function resolveGitHub(workspaceId: string): Promise<NextResponse> {
  try {
    const stored = await loadStoredGitHubToken(workspaceId);
    if (!stored?.accessToken) {
      return NextResponse.json({ integrationKey: "github", present: false });
    }
    return NextResponse.json({
      integrationKey: "github",
      present: true,
      accessToken: stored.accessToken,
      scopes: stored.scopes,
      updatedAt: stored.updatedAt,
    });
  } catch {
    return NextResponse.json({ integrationKey: "github", present: false });
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; key: string }> },
): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id: workspaceId, key: integrationKey } = await context.params;

  if (!workspaceId || !integrationKey) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

  try {
    if (integrationKey === "google_oauth" || integrationKey === "google") {
      return await resolveGoogle(workspaceId);
    }
    if (integrationKey === "imap" || integrationKey === "icloud_imap") {
      return await resolveImap(workspaceId, integrationKey);
    }
    if (integrationKey === "icloud_caldav") {
      return await resolveCalDAV(workspaceId);
    }
    if (integrationKey === "github") {
      return await resolveGitHub(workspaceId);
    }
    return NextResponse.json({ integrationKey, present: false });
  } catch (err) {
    console.error("[token-bridge] error", { workspaceId, integrationKey, err });
    return NextResponse.json({ integrationKey, present: false });
  }
}
