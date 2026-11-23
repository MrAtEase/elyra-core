"use client";

/** KI-Newsletter-Digest – Branchen-Newsletter aus Gmail zu einem Briefing mit Quellen verdichten. */

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Mail, Newspaper, Settings2, Trash2 } from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { Markdown } from "@/components/os/apps/toolbox/ToolboxWindow";

type Source = { n: number; subject: string; from: string; date: string; url: string };
type Digest = { id: string; created_at: string; query: string; focus: string; days: number; message_count: number; content: string; sources: Source[] };

const ACCENT = "#0f766e";
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const input = "w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12.5px] outline-none";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";

async function api<T>(ws: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(body ? "/api/os/insights" : `/api/os/insights?workspaceId=${encodeURIComponent(ws)}`, {
    method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
    headers: await withSupabaseAuthorization(body ? { "Content-Type": "application/json" } : undefined),
    ...(body ? { body: JSON.stringify({ workspaceId: ws, ...body }) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

/** Only the mails the briefing actually cites – keeps the numbering from the text. */
function citedSources(d: Digest): Source[] {
  const cited = new Set<number>();
  for (const m of d.content.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) for (const n of m[1]!.split(",")) cited.add(Number(n.trim()));
  return cited.size ? d.sources.filter((s) => cited.has(s.n)) : d.sources;
}

export default function InsightsWindow() {
  const { activeWorkspace } = useKernel();
  const ws = activeWorkspace.id;
  const [digests, setDigests] = useState<Digest[]>([]);
  const [active, setActive] = useState<Digest | null>(null);
  const [days, setDays] = useState(7);
  const [focus, setFocus] = useState("");
  const [query, setQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [source, setSource] = useState<"rss" | "both" | "gmail">("rss");
  const [feeds, setFeeds] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [feedTest, setFeedTest] = useState<Array<{ url: string; ok: boolean; count: number; source: string; error: string | null }> | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ digests: Digest[]; defaults: { query: string; focus: string; feeds: string[] }; setup_error?: string }>(ws);
      setDigests(d.digests);
      setSetupError(d.setup_error ?? null);
      setFocus((f) => f || d.defaults.focus);
      setQuery((q) => q || d.defaults.query);
      let saved: { source?: "rss" | "both" | "gmail"; feeds?: string; v?: number } = {};
      try { saved = JSON.parse(localStorage.getItem("elyra.insights.sources") ?? "{}"); } catch { /* ignore */ }
      if (saved.source) setSource(saved.source);
      setFeeds((f) => f || (saved.v === 2 && saved.feeds) || d.defaults.feeds.join("\n"));
      setActive((a) => a ?? d.digests[0] ?? null);
    } catch (err) { setSetupError((err as Error).message); }
  }, [ws]);

  useEffect(() => { void load(); }, [load]);

  async function run() {
    setBusy(true); setError(null);
    try {
      const feedList = feeds.split("\n").map((x) => x.trim()).filter(Boolean);
      try { localStorage.setItem("elyra.insights.sources", JSON.stringify({ source, feeds, v: 2 })); } catch { /* ignore */ }
      const d = await api<{ digest: Digest & { warnings?: string[] } }>(ws, { days, focus, query, source, feeds: feedList });
      setWarnings(d.digest.warnings ?? []);
      setActive(d.digest);
      setDigests((prev) => [d.digest, ...prev]);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function checkFeeds() {
    setTesting(true); setFeedTest(null);
    try {
      const d = await api<{ results: Array<{ url: string; ok: boolean; count: number; source: string; error: string | null }> }>(ws, { action: "testFeeds", days, feeds: feeds.split("\n").map((x) => x.trim()).filter(Boolean) });
      setFeedTest(d.results);
    } catch (err) { setError((err as Error).message); } finally { setTesting(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Digest löschen?")) return;
    await api(ws, { action: "delete", id }).catch(() => undefined);
    setDigests((prev) => prev.filter((d) => d.id !== id));
    if (active?.id === id) setActive(null);
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] bg-[color:var(--bg-canvas)] text-[color:var(--text-primary)]">
      <aside className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-[color:var(--os-border-soft)] p-3">
        <span className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Briefings</span>
        {digests.map((d) => (
          <button key={d.id} type="button" onClick={() => setActive(d)} className={`rounded-xl px-2.5 py-2 text-left transition ${active?.id === d.id ? "bg-[color:var(--bg-surface-hover)]" : "hover:bg-[color:var(--bg-surface)]"}`}>
            <span className="block text-[12.5px] font-medium">{new Date(d.created_at).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
            <span className="block text-[11px] text-[color:var(--text-muted)]">{d.message_count} Beiträge · {d.days} Tage</span>
          </button>
        ))}
        {digests.length === 0 ? <p className="px-2 text-[11.5px] text-[color:var(--text-muted)]">Noch kein Briefing.</p> : null}
      </aside>

      <section className="min-h-0 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold">KI-Newsletter-Digest</h2>
              <p className="text-[12.5px] text-[color:var(--text-muted)]">Liest Fachseiten (RSS) und auf Wunsch Branchen-Newsletter aus Gmail und macht daraus ein Briefing mit Quellen – inklusive „Was bedeutet das für uns?“.</p>
            </div>
          </div>
          {setupError ? <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-700">{setupError}</p> : null}

          <div className={`${card} mt-4`}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="w-32"><span className="mb-1 block text-[11.5px] text-[color:var(--text-secondary)]">Zeitraum</span>
                <select className={input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>letzte {d} {d === 1 ? "Tag" : "Tage"}</option>)}
                </select>
              </label>
              <label className="min-w-[260px] flex-1"><span className="mb-1 block text-[11.5px] text-[color:var(--text-secondary)]">Fokus</span>
                <input className={input} value={focus} onChange={(e) => setFocus(e.target.value)} />
              </label>
              <label className="w-40"><span className="mb-1 block text-[11.5px] text-[color:var(--text-secondary)]">Quellen</span>
                <select className={input} value={source} onChange={(e) => setSource(e.target.value as "rss" | "both" | "gmail")}>
                  <option value="rss">Fachseiten (RSS)</option>
                  <option value="both">RSS + Gmail</option>
                  <option value="gmail">Nur Gmail</option>
                </select>
              </label>
              <button type="button" className={btn} onClick={() => setShowFilter(!showFilter)}><Settings2 size={12} /> Quellen & Filter</button>
              <button type="button" disabled={busy} onClick={() => void run()} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Newspaper size={13} />} {busy ? "Lese Quellen …" : "Briefing erstellen"}
              </button>
            </div>
            {showFilter && source !== "gmail" ? (
              <label className="mt-3 block"><span className="mb-1 block text-[11.5px] text-[color:var(--text-secondary)]">RSS-Feeds (einer pro Zeile – fast jede Fachseite hat einen, oft unter /feed oder /rss)</span>
                <textarea rows={8} className={`${input} font-mono text-[11.5px]`} value={feeds} onChange={(e) => setFeeds(e.target.value)} />
                <span className="mt-1 flex items-center gap-2">
                  <button type="button" className={btn} disabled={testing} onClick={() => void checkFeeds()}>{testing ? <Loader2 size={12} className="animate-spin" /> : null} Feeds prüfen</button>
                  <span className="text-[10.5px] text-[color:var(--text-muted)]">{feeds.split("\n").filter((x) => x.trim()).length} Feeds</span>
                </span>
                {feedTest ? (
                  <span className="mt-2 block space-y-0.5">
                    {feedTest.map((t) => (
                      <span key={t.url} className="flex gap-2 text-[11px]">
                        <span className={t.ok ? "text-emerald-600" : "text-rose-600"}>{t.ok ? "✓" : "✗"}</span>
                        <span className="min-w-0 flex-1 truncate">{t.ok ? t.source || t.url : t.url}</span>
                        <span className="shrink-0 text-[color:var(--text-muted)]">{t.ok ? `${t.count} Beiträge in ${days} T.` : t.error}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </label>
            ) : null}
            {showFilter && source !== "rss" ? (
              <label className="mt-3 block"><span className="mb-1 block text-[11.5px] text-[color:var(--text-secondary)]">Gmail-Suchfilter (Gmail-Syntax, z. B. from:newsletter@… oder label:Branche)</span>
                <input className={`${input} font-mono text-[11.5px]`} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            ) : null}
            {warnings.length ? <div className="mt-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700">{warnings.map((w) => <p key={w}>{w}</p>)}</div> : null}
            <p className="mt-2 text-[10.5px] text-[color:var(--text-muted)]">Tipp: Über „Automationen“ lässt sich das Briefing per n8n jeden Montag automatisch erstellen und an Slack/Teams/E-Mail schicken.</p>
          </div>
          {error ? <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12.5px] text-rose-600">{error}</p> : null}

          {active ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className={card}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11.5px] text-[color:var(--text-muted)]">{new Date(active.created_at).toLocaleString("de-DE")} · {active.message_count} Beiträge · Fokus: {active.focus}</p>
                  <div className="flex gap-1.5">
                    <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(active.content)}><Copy size={12} /> Kopieren</button>
                    <button type="button" className={`${btn} text-rose-600`} onClick={() => void remove(active.id)}><Trash2 size={12} /></button>
                  </div>
                </div>
                <Markdown text={active.content} />
              </div>
              <div className={`${card} h-fit`}>
                <p className="mb-2 text-[13px] font-semibold">Quellen</p>
                <ol className="space-y-1.5">
                  {citedSources(active).map((s) => (
                    <li key={s.n} className="text-[11.5px]">
                      <a href={s.url} target="_blank" rel="noreferrer" className="flex gap-1.5 hover:underline">
                        <span className="shrink-0 text-[color:var(--text-muted)]">[{s.n}]</span>
                        <span className="min-w-0"><span className="block truncate font-medium">{s.subject}</span><span className="flex items-center gap-1 truncate text-[10.5px] text-[color:var(--text-muted)]"><Mail size={10} />{s.from}</span></span>
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : !busy ? (
            <div className={`${card} mt-4 text-center text-[12.5px] text-[color:var(--text-secondary)]`}>Noch kein Briefing – Zeitraum wählen und <b>Briefing erstellen</b>.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
