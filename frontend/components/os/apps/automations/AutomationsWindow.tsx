"use client";

/** Automationen – Elyra mit n8n, Make oder Zapier verbinden (eingehende API-Tokens, ausgehende Webhooks). */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Send, Trash2, Webhook, Workflow } from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type Hook = { id: string; name: string; url: string; events: string[]; active: boolean; has_secret: boolean; last_status: number | null; last_error: string | null; last_fired_at: string | null };
type Token = { id: string; name: string; prefix: string; last_used_at: string | null; created_at: string };
type Meta = { events: Array<{ id: string; label: string }>; actions: Array<{ id: string; label: string; example: Record<string, unknown> }>; endpoint: string };

const ACCENT = "#ea4b71"; // n8n-Rosa
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const input = "w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12.5px] outline-none";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";

async function api<T>(ws: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(body ? "/api/os/automations" : `/api/os/automations?workspaceId=${encodeURIComponent(ws)}`, {
    method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
    headers: await withSupabaseAuthorization(body ? { "Content-Type": "application/json" } : undefined),
    ...(body ? { body: JSON.stringify({ workspaceId: ws, ...body }) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-[color:var(--bg-elevated)] p-3 pr-10 font-mono text-[11px] leading-relaxed">{text}</pre>
      <button type="button" className="absolute right-2 top-2 rounded-md p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)]" onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }} title="Kopieren">
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export default function AutomationsWindow() {
  const { activeWorkspace } = useKernel();
  const ws = activeWorkspace.id;
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "n8n", url: "", secret: "", events: ["digest.created"] as string[] });
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [action, setAction] = useState("digest.run");

  const load = useCallback(async () => {
    try {
      const d = await api<Meta & { hooks: Hook[]; tokens: Token[]; setup_error?: string }>(ws);
      setMeta({ events: d.events, actions: d.actions, endpoint: d.endpoint });
      setHooks(d.hooks); setTokens(d.tokens); setSetupError(d.setup_error ?? null);
    } catch (err) { setSetupError((err as Error).message); }
  }, [ws]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  const createToken = () => act("token", async () => {
    const d = await api<{ token: string }>(ws, { action: "token.create", name: "n8n" });
    setNewToken(d.token);
    await load();
  });
  const revoke = (id: string) => act(`rev-${id}`, async () => {
    if (!window.confirm("Token widerrufen? Automationen mit diesem Token funktionieren danach nicht mehr.")) return;
    await api(ws, { action: "token.revoke", id });
    await load();
  });
  const saveHook = () => act("hook", async () => {
    await api(ws, { action: "hook.save", hook: draft });
    setDraft({ name: "n8n", url: "", secret: "", events: ["digest.created"] });
    await load();
  });
  const deleteHook = (id: string) => act(`del-${id}`, async () => {
    if (!window.confirm("Webhook löschen?")) return;
    await api(ws, { action: "hook.delete", id });
    await load();
  });
  const testHook = (id: string) => act(`test-${id}`, async () => {
    const d = await api<{ result: { ok: boolean; status: number | null; error: string | null } }>(ws, { action: "hook.test", id });
    setTestResult((p) => ({ ...p, [id]: d.result.ok ? `✓ angekommen (HTTP ${d.result.status})` : `✗ ${d.result.error}` }));
    await load();
  });

  const endpoint = meta?.endpoint ?? "/api/hooks/elyra";
  const tokenShown = newToken ?? "elyra_DEIN_TOKEN";
  const example = meta?.actions.find((a) => a.id === action)?.example ?? {};
  const curl = `curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer ${tokenShown}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ action, ...example })}'`;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[color:var(--bg-canvas)] p-6 text-[color:var(--text-primary)]">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: ACCENT }}><Workflow size={20} /></div>
          <div>
            <h2 className="text-[20px] font-semibold">Automationen</h2>
            <p className="text-[12.5px] text-[color:var(--text-muted)]">Elyra mit n8n, Make oder Zapier verbinden: Workflows lösen Elyra-Aktionen aus – und Elyra meldet Ergebnisse zurück.</p>
          </div>
        </div>
        {setupError ? <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-700">{setupError}</p> : null}
        {error ? <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12.5px] text-rose-600">{error}</p> : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {/* Inbound */}
          <div className={card}>
            <p className="flex items-center gap-1.5 text-[14px] font-semibold"><KeyRound size={15} /> n8n → Elyra (API-Token)</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Ein HTTP-Request-Node in n8n ruft Elyra auf, z. B. jeden Montag „Digest erstellen“ oder monatlich „KI-Sichtbarkeit messen“.</p>
            <div className="mt-3 space-y-1.5">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg bg-[color:var(--bg-elevated)] px-3 py-1.5 text-[12px]">
                  <span><span className="font-mono">{t.prefix}…</span> · {t.name}</span>
                  <span className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">{t.last_used_at ? `zuletzt ${new Date(t.last_used_at).toLocaleString("de-DE")}` : "nie benutzt"}
                    <button type="button" className="text-rose-600" onClick={() => void revoke(t.id)} title="Widerrufen"><Trash2 size={12} /></button>
                  </span>
                </div>
              ))}
            </div>
            <button type="button" className={`${btn} mt-2`} disabled={busy === "token"} onClick={() => void createToken()}>{busy === "token" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Neuen Token erstellen</button>
            {newToken ? (
              <div className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3">
                <p className="mb-1 text-[12px] font-semibold text-emerald-700">Token nur jetzt sichtbar – sicher speichern (z. B. als n8n-Credential „Header Auth“):</p>
                <CopyBlock text={newToken} />
              </div>
            ) : null}

            <p className="mb-1 mt-4 text-[12.5px] font-semibold">Aktionen</p>
            <div className="flex flex-wrap gap-1.5">
              {meta?.actions.map((a) => (
                <button key={a.id} type="button" onClick={() => setAction(a.id)} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${action === a.id ? "text-white" : "border-[color:var(--os-border-soft)]"}`} style={action === a.id ? { background: ACCENT, borderColor: ACCENT } : undefined}>{a.label}</button>
              ))}
            </div>
            <p className="mb-1 mt-3 text-[11.5px] text-[color:var(--text-secondary)]">Test im Terminal:</p>
            <CopyBlock text={curl} />
            <p className="mb-1 mt-3 text-[11.5px] text-[color:var(--text-secondary)]">In n8n: <b>Schedule Trigger</b> → <b>HTTP Request</b> (POST, URL oben, Header <code>Authorization: Bearer …</code>, Body JSON) → z. B. <b>Slack</b>/<b>Gmail</b>-Node mit <code>{"{{ $json.digest.content }}"}</code>.</p>
          </div>

          {/* Outbound */}
          <div className={card}>
            <p className="flex items-center gap-1.5 text-[14px] font-semibold"><Webhook size={15} /> Elyra → n8n (Webhooks)</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Elyra ruft die URL eines n8n-„Webhook“-Nodes auf, sobald etwas passiert – z. B. Digest fertig → an Teams posten.</p>
            <div className="mt-3 space-y-2">
              {hooks.map((h) => (
                <div key={h.id} className="rounded-lg bg-[color:var(--bg-elevated)] px-3 py-2 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0"><span className="font-semibold">{h.name}</span> <span className="block truncate font-mono text-[10.5px] text-[color:var(--text-muted)]">{h.url}</span></span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" className={btn} disabled={busy === `test-${h.id}`} onClick={() => void testHook(h.id)}>{busy === `test-${h.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Test</button>
                      <button type="button" className={`${btn} text-rose-600`} onClick={() => void deleteHook(h.id)}><Trash2 size={12} /></button>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{h.events.map((e) => meta?.events.find((x) => x.id === e)?.label ?? e).join(" · ") || "keine Ereignisse"}{h.has_secret ? " · signiert" : ""}</p>
                  {testResult[h.id] ? <p className="mt-1 text-[11px]">{testResult[h.id]}</p> : h.last_fired_at ? <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">Zuletzt {new Date(h.last_fired_at).toLocaleString("de-DE")} · {h.last_error ?? `HTTP ${h.last_status}`}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2 rounded-xl border border-dashed border-[color:var(--os-border-soft)] p-3">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
                <input className={`${input} font-mono text-[11.5px]`} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…n8n.cloud/webhook/…" />
              </div>
              <input className={input} value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} placeholder="Signatur-Secret (optional, HMAC-SHA256 im Header X-Elyra-Signature)" />
              <div className="flex flex-wrap gap-3">
                {meta?.events.map((ev) => (
                  <label key={ev.id} className="flex items-center gap-1.5 text-[11.5px]">
                    <input type="checkbox" checked={draft.events.includes(ev.id)} onChange={() => setDraft({ ...draft, events: draft.events.includes(ev.id) ? draft.events.filter((x) => x !== ev.id) : [...draft.events, ev.id] })} />{ev.label}
                  </label>
                ))}
              </div>
              <button type="button" disabled={busy === "hook" || !draft.url} onClick={() => void saveHook()} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                {busy === "hook" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Webhook hinzufügen
              </button>
            </div>
            <p className="mb-1 mt-3 text-[11.5px] text-[color:var(--text-secondary)]">Beispiel-Payload:</p>
            <CopyBlock text={JSON.stringify({ event: "digest.created", workspace_id: "…", sent_at: "2026-11-23T07:00:00Z", data: { id: "…", message_count: 18, content: "## Das Wichtigste in 30 Sekunden …", sources: ["…"] } }, null, 2)} />
          </div>
        </div>

        <div className={`${card} mt-4`}>
          <p className="text-[14px] font-semibold">Vorlagen-Ideen</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3 text-[12px]">
            <div className="rounded-xl bg-[color:var(--bg-elevated)] p-3"><b>Montags-Briefing</b><p className="text-[color:var(--text-muted)]">Schedule (Mo 7:00) → HTTP <code>digest.run</code> → Slack/Teams-Kanal „#innovation“.</p></div>
            <div className="rounded-xl bg-[color:var(--bg-elevated)] p-3"><b>GEO-Monitoring pro Kunde</b><p className="text-[color:var(--text-muted)]">Schedule (1. des Monats) → <code>visibility.run</code> je Kunde → Ergebnis in Google Sheets → Mail an Account Manager.</p></div>
            <div className="rounded-xl bg-[color:var(--bg-elevated)] p-3"><b>Lead → Aufgabe</b><p className="text-[color:var(--text-muted)]">Formular/CRM-Trigger → <code>task.create</code> in Elyra → Elyra plant Follow-up.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
