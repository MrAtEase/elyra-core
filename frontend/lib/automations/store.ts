/**
 * Automationen (n8n, Make, Zapier):
 *  - Ausgehend: Webhooks, die bei Elyra-Ereignissen aufgerufen werden (Digest fertig, Messung fertig …).
 *  - Eingehend: API-Tokens, mit denen n8n Elyra-Aktionen über POST /api/hooks/elyra auslöst.
 * Tabellen: automation_hooks, automation_tokens (Migration 0016).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";

export class AutomationError extends Error {}

export const EVENTS = [
  { id: "digest.created", label: "Newsletter-Digest erstellt" },
  { id: "visibility.completed", label: "KI-Sichtbarkeit gemessen" },
  { id: "brand.completed", label: "Marken-Wahrnehmung geprüft" },
  { id: "task.created", label: "Aufgabe über API angelegt" },
] as const;
export type EventId = (typeof EVENTS)[number]["id"];

export const ACTIONS = [
  { id: "ping", label: "Verbindung testen", example: {} },
  { id: "digest.run", label: "Newsletter-Digest erstellen", example: { days: 7, focus: "KI, MarTech, Retail Media" } },
  { id: "visibility.run", label: "KI-Sichtbarkeit messen", example: { project: "hurra gmbh" } },
  { id: "brand.run", label: "Marken-Wahrnehmung prüfen", example: { project: "hurra gmbh" } },
  { id: "task.create", label: "Aufgabe anlegen", example: { title: "Report an Kunde senden", due_at: "2026-12-01" } },
] as const;

export type Hook = {
  id: string; workspace_id: string; name: string; url: string; events: string[]; active: boolean; has_secret: boolean;
  last_status: number | null; last_error: string | null; last_fired_at: string | null; created_at: string;
};
export type TokenInfo = { id: string; name: string; prefix: string; last_used_at: string | null; created_at: string };

const db = () => getSupabaseAdminClient();

function dbFail(message: string): never {
  if (/relation .*automation_|Could not find the table/i.test(message)) {
    throw new AutomationError("Tabellen fehlen – bitte frontend/db/migrations/0016_insights_automations.sql im Supabase SQL Editor ausführen.");
  }
  throw new AutomationError(message);
}

type HookRow = Omit<Hook, "has_secret"> & { secret_enc: string | null };
const toHook = ({ secret_enc, ...h }: HookRow): Hook => ({ ...h, has_secret: Boolean(secret_enc) });

// ── Outgoing hooks ──────────────────────────────────────────────────────────

export async function listHooks(workspaceId: string): Promise<Hook[]> {
  const { data, error } = await db().from("automation_hooks").select("*").eq("workspace_id", workspaceId).order("created_at");
  if (error) dbFail(error.message);
  return ((data ?? []) as HookRow[]).map(toHook);
}

function validUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new AutomationError("Bitte eine gültige Webhook-URL angeben (https://…)."); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) {
    throw new AutomationError("Nur https-URLs (oder http://localhost für Tests) sind erlaubt.");
  }
  return u.toString();
}

export async function saveHook(workspaceId: string, id: string | null, input: { name?: string; url?: string; events?: unknown; secret?: string | null; active?: boolean }) {
  const events = (Array.isArray(input.events) ? input.events.map(String) : []).filter((e) => EVENTS.some((x) => x.id === e));
  const row: Record<string, unknown> = {
    name: String(input.name ?? "").trim().slice(0, 80) || "n8n Webhook",
    url: validUrl(String(input.url ?? "")),
    events,
    active: input.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (typeof input.secret === "string") row.secret_enc = input.secret.trim() ? encryptIntegrationSecret(input.secret.trim()) : null;
  const q = id
    ? db().from("automation_hooks").update(row).eq("workspace_id", workspaceId).eq("id", id).select("*").single()
    : db().from("automation_hooks").insert({ ...row, workspace_id: workspaceId }).select("*").single();
  const { data, error } = await q;
  if (error) dbFail(error.message);
  return toHook(data as HookRow);
}

export async function deleteHook(workspaceId: string, id: string) {
  const { error } = await db().from("automation_hooks").delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbFail(error.message);
}

async function deliver(row: HookRow, event: string, data: unknown) {
  const body = JSON.stringify({ event, workspace_id: row.workspace_id, sent_at: new Date().toISOString(), data });
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Elyra-Automations/1.0", "X-Elyra-Event": event };
  if (row.secret_enc) {
    try {
      const secret = decryptIntegrationSecret(row.secret_enc);
      headers["X-Elyra-Signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    } catch { /* secret unreadable – send unsigned */ }
  }
  let status: number | null = null;
  let err: string | null = null;
  let response = "";
  try {
    const res = await fetch(row.url, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    response = (await res.text().catch(() => "")).slice(0, 500);
    if (!res.ok) err = `HTTP ${res.status}`;
  } catch (e) {
    err = (e as Error).message;
  }
  await db().from("automation_hooks").update({ last_status: status, last_error: err, last_fired_at: new Date().toISOString() }).eq("id", row.id);
  return { ok: !err, status, error: err, response };
}

export async function testHook(workspaceId: string, id: string) {
  const { data, error } = await db().from("automation_hooks").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) dbFail(error.message);
  if (!data) throw new AutomationError("Webhook nicht gefunden.");
  return deliver(data as HookRow, "test", { message: "Testnachricht von Elyra Core", hint: "Wenn du das in n8n siehst, funktioniert die Verbindung." });
}

/** Best effort: never throws, never blocks the caller for long. */
export async function fireEvent(workspaceId: string, event: EventId, data: unknown): Promise<void> {
  try {
    const { data: rows } = await db().from("automation_hooks").select("*").eq("workspace_id", workspaceId).eq("active", true).contains("events", [event]);
    await Promise.all(((rows ?? []) as HookRow[]).map((r) => deliver(r, event, data)));
  } catch { /* tables missing or network issue – ignore */ }
}

// ── Inbound tokens ──────────────────────────────────────────────────────────

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listTokens(workspaceId: string): Promise<TokenInfo[]> {
  const { data, error } = await db().from("automation_tokens").select("id,name,prefix,last_used_at,created_at").eq("workspace_id", workspaceId).order("created_at");
  if (error) dbFail(error.message);
  return (data ?? []) as TokenInfo[];
}

export async function createToken(workspaceId: string, userId: string | null, name: string) {
  const token = `elyra_${randomBytes(24).toString("base64url")}`;
  const { data, error } = await db().from("automation_tokens")
    .insert({ workspace_id: workspaceId, name: name.trim().slice(0, 80) || "n8n", prefix: token.slice(0, 12), token_hash: hash(token), created_by: userId })
    .select("id,name,prefix,last_used_at,created_at").single();
  if (error) dbFail(error.message);
  return { token, info: data as TokenInfo };
}

export async function revokeToken(workspaceId: string, id: string) {
  const { error } = await db().from("automation_tokens").delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbFail(error.message);
}

export async function verifyToken(token: string): Promise<{ workspaceId: string; userId: string | null } | null> {
  if (!token.startsWith("elyra_")) return null;
  const { data, error } = await db().from("automation_tokens").select("id,workspace_id,created_by").eq("token_hash", hash(token)).maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; workspace_id: string; created_by: string | null };
  await db().from("automation_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { workspaceId: row.workspace_id, userId: row.created_by };
}
