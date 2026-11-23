"use client";

/** Workspace Admin › Marketplace › Dienste über MCP verbinden (Notion, Linear, GitHub, eigene Server …). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Plug, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type CatalogEntry = {
  id: string; name: string; category: string; description: string; transport: "http" | "stdio"; url?: string;
  auth: "oauth" | "token" | "none" | "oauth_or_token"; tokenLabel?: string; tokenHelp?: string; command?: string; args?: string[]; argLabel?: string; docs?: string;
};
type Tool = { name: string; title?: string; description?: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };

const readOnly = (t: Tool) =>
  t.annotations?.readOnlyHint === true ||
  (t.annotations?.readOnlyHint !== false && t.annotations?.destructiveHint !== true &&
    /^(get|list|search|read|fetch|find|query|ask|describe|show|lookup|view|retrieve|count|check|resolve)(_|-|[A-Z]|$)/.test(t.name));
type Server = {
  id: string; name: string; catalog_id: string | null; transport: "http" | "stdio"; url: string | null; command: string | null; args: string[];
  auth_type: string; status: "connected" | "needs_auth" | "error" | "new"; last_error: string | null; tools: Tool[]; enabled: boolean;
};

const card = "rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const btn = "inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";
const input = "w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]";
const h4 = "text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/os/mcp", {
    method: "POST", credentials: "include",
    headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || data.ok === false) throw new Error(String(data?.error ?? `Fehler ${res.status}`));
  return data;
}

function StatusBadge({ s }: { s: Server }) {
  if (!s.enabled) return <span className="rounded-full bg-[color:var(--bg-surface-hover)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">Pausiert</span>;
  if (s.status === "connected") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] text-emerald-700"><CheckCircle2 size={10} /> Verbunden</span>;
  if (s.status === "needs_auth") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] text-amber-700"><AlertTriangle size={10} /> Anmeldung nötig</span>;
  if (s.status === "error") return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] text-rose-600"><XCircle size={10} /> Fehler</span>;
  return <span className="rounded-full bg-[color:var(--bg-surface-hover)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">Neu</span>;
}

export default function McpMarketplace({ workspaceId }: { workspaceId: string }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/os/mcp?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: "include", cache: "no-store", headers: await withSupabaseAuthorization() });
      const data = (await res.json()) as { ok: boolean; catalog?: CatalogEntry[]; servers?: Server[]; setup_error?: string; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Fehler");
      setCatalog(data.catalog ?? []);
      setServers(data.servers ?? []);
      setSetupError(data.setup_error ?? null);
    } catch (err) {
      setSetupError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Result of an OAuth round trip (?mcp_ok=… / ?mcp_error=…)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("mcp_ok");
    const err = p.get("mcp_error");
    if (ok || err) {
      setNote(ok ? { ok: true, text: `Verbunden – ${ok}` } : { ok: false, text: err ?? "" });
      p.delete("mcp_ok"); p.delete("mcp_error"); p.delete("mcp");
      const q = p.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
  }, []);

  async function run(key: string, body: Record<string, unknown>, success?: string) {
    setBusy(key); setNote(null);
    try {
      const data = await post({ workspaceId, ...body });
      if (typeof data.authUrl === "string") { window.location.href = data.authUrl; return; }
      if (data.status === "error" || data.error) setNote({ ok: false, text: String(data.error ?? "Verbindung fehlgeschlagen") });
      else if (success) setNote({ ok: true, text: success });
      setOpenForm(null); setForm({});
      await load();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const connectedIds = useMemo(() => new Set(servers.map((s) => s.catalog_id).filter(Boolean)), [servers]);
  const categories = useMemo(() => Array.from(new Set(catalog.map((c) => c.category))), [catalog]);

  function connectCatalog(entry: CatalogEntry) {
    const needsInput = entry.auth === "token" || Boolean(entry.argLabel);
    if (needsInput && openForm !== entry.id) { setOpenForm(entry.id); setForm({}); return; }
    void run(`cat:${entry.id}`, {
      action: "add", catalogId: entry.id,
      ...(form.token ? { token: form.token } : {}),
      ...(form.arg ? { argValue: form.arg } : {}),
    }, `${entry.name} verbunden`);
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className={h4}>Dienste verbinden (MCP)</h4>
          <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Verbinde Notion, Linear, GitHub & Co. über das Model Context Protocol – Elly kann sie dann unter „Werkzeuge › Dienste“ benutzen.</p>
        </div>
        <button type="button" onClick={() => void load()} className={btn} disabled={loading}><RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Aktualisieren</button>
      </div>

      {setupError ? <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2.5 text-[12px] text-amber-700">{setupError}</p> : null}
      {note ? <p className={`mb-3 rounded-lg border p-2.5 text-[12px] ${note.ok ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700" : "border-rose-400/40 bg-rose-500/10 text-rose-600"}`}>{note.text}</p> : null}

      {servers.length > 0 ? (
        <div className="mb-6 space-y-2">
          {servers.map((s) => (
            <div key={s.id} className={card}>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {expanded === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{s.name}</span>
                  <StatusBadge s={s} />
                  <span className="text-[11px] text-[color:var(--text-muted)]">{s.status === "connected" ? `${s.tools.length} Werkzeuge` : ""}</span>
                </button>
                <div className="flex items-center gap-1.5">
                  {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : (
                    <>
                      <button type="button" className={btn} onClick={() => void run(s.id, { action: "connect", id: s.id }, `${s.name} aktualisiert`)}>
                        <Plug size={11} /> {s.status === "needs_auth" ? "Anmelden" : "Neu verbinden"}
                      </button>
                      <button type="button" className={btn} onClick={() => void run(s.id, { action: "toggle", id: s.id, enabled: !s.enabled })}>{s.enabled ? "Pausieren" : "Aktivieren"}</button>
                      <button type="button" className={`${btn} text-rose-600`} onClick={() => { if (window.confirm(`${s.name} wirklich entfernen? Gespeicherte Zugangsdaten werden gelöscht.`)) void run(s.id, { action: "remove", id: s.id }, `${s.name} entfernt`); }}>
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {s.last_error && s.status !== "connected" ? <p className="mt-2 text-[11.5px] text-rose-600">{s.last_error}</p> : null}
              {expanded === s.id ? (
                <div className="mt-3 border-t border-[color:var(--os-border-soft)] pt-3">
                  <p className="mb-2 font-mono text-[11px] text-[color:var(--text-muted)]">{s.transport === "http" ? s.url : `${s.command} ${s.args.join(" ")}`}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.tools.map((t) => (
                      <span key={t.name} title={t.description} className={`rounded-full border px-2 py-0.5 text-[10.5px] ${readOnly(t) ? "border-[color:var(--os-border-soft)] text-[color:var(--text-secondary)]" : "border-amber-400/40 text-amber-700"}`}>
                        {t.title ?? t.name}
                      </span>
                    ))}
                    {s.tools.length === 0 ? <span className="text-[11.5px] text-[color:var(--text-muted)]">Noch keine Werkzeuge geladen.</span> : null}
                  </div>
                  <p className="mt-2 text-[10.5px] text-[color:var(--text-muted)]">Gelb = verändert Daten und braucht deine Freigabe.</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {categories.map((cat) => (
        <div key={cat} className="mb-5">
          <p className="mb-2 text-[11px] font-medium text-[color:var(--text-muted)]">{cat}</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {catalog.filter((c) => c.category === cat).map((entry) => {
              const added = connectedIds.has(entry.id);
              return (
                <div key={entry.id} className={card}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{entry.name}</p>
                    <span className="shrink-0 rounded-full bg-[color:var(--bg-surface-hover)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">
                      {entry.transport === "stdio" ? "Lokal" : entry.auth === "none" ? "Ohne Login" : entry.auth === "token" ? "Token" : "Anmeldung"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-[color:var(--text-muted)]">{entry.description}</p>
                  {openForm === entry.id ? (
                    <div className="mt-3 space-y-2">
                      {entry.auth === "token" || entry.auth === "oauth_or_token" ? (
                        <input type="password" autoComplete="off" value={form.token ?? ""} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder={entry.tokenLabel ?? "Token"} className={input} />
                      ) : null}
                      {entry.tokenHelp ? <p className="text-[10.5px] text-[color:var(--text-muted)]">{entry.tokenHelp}</p> : null}
                      {entry.argLabel ? <input value={form.arg ?? ""} onChange={(e) => setForm({ ...form, arg: e.target.value })} placeholder={entry.argLabel} className={input} /> : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" className={btn} disabled={busy === `cat:${entry.id}`} onClick={() => connectCatalog(entry)}>
                      {busy === `cat:${entry.id}` ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} {added ? "Weiteren verbinden" : "Verbinden"}
                    </button>
                    {entry.auth === "oauth_or_token" && openForm !== entry.id ? (
                      <button type="button" className="text-[11px] text-[color:var(--text-muted)] underline" onClick={() => { setOpenForm(entry.id); setForm({}); }}>mit Token</button>
                    ) : null}
                    {entry.docs ? <a href={entry.docs} target="_blank" rel="noreferrer noopener" className="ml-auto text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]" title="Dokumentation"><ExternalLink size={12} /></a> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Custom server */}
      <div className={card}>
        <button type="button" onClick={() => { setOpenForm(openForm === "custom" ? null : "custom"); setForm({ kind: "http" }); }} className="flex w-full items-center gap-2 text-left">
          {openForm === "custom" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">Eigenen MCP-Server hinzufügen</span>
        </button>
        {openForm === "custom" ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="flex gap-2 md:col-span-2">
              {(["http", "stdio"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })} className={`${btn} ${form.kind === k ? "border-transparent bg-[color:var(--os-accent,#6366f1)] text-white" : ""}`}>
                  {k === "http" ? "Remote (URL)" : "Lokal (Befehl)"}
                </button>
              ))}
            </div>
            <input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, z. B. Mein CRM" className={input} />
            {form.kind === "stdio" ? (
              <>
                <input value={form.command ?? ""} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="Befehl, z. B. npx" className={input} />
                <input value={form.argsLine ?? ""} onChange={(e) => setForm({ ...form, argsLine: e.target.value })} placeholder="Argumente, z. B. -y @modelcontextprotocol/server-memory" className={`${input} md:col-span-2`} />
                <textarea value={form.env ?? ""} onChange={(e) => setForm({ ...form, env: e.target.value })} rows={3} placeholder={"Umgebungsvariablen (eine pro Zeile)\nAPI_KEY=…"} className={`${input} md:col-span-2 font-mono`} />
                <p className="text-[10.5px] text-amber-700 md:col-span-2">Lokale Server laufen als Programm auf deinem Mac – nur Befehle aus vertrauenswürdigen Quellen eintragen.</p>
              </>
            ) : (
              <>
                <input value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/mcp" className={input} />
                <input type="password" autoComplete="off" value={form.token ?? ""} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Token (optional – sonst Anmeldung per OAuth)" className={`${input} md:col-span-2`} />
              </>
            )}
            <div className="md:col-span-2">
              <button type="button" className={btn} disabled={busy === "custom"} onClick={() => void run("custom", form.kind === "stdio"
                ? { action: "add", transport: "stdio", name: form.name, command: form.command, argsLine: form.argsLine, env: form.env }
                : { action: "add", transport: "http", name: form.name, url: form.url, ...(form.token ? { token: form.token } : {}) }, "Server hinzugefügt")}>
                {busy === "custom" ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Hinzufügen & verbinden
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
