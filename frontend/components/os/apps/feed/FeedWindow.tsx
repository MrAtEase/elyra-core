"use client";

/** Feed-Optimierer – Google-Shopping-Feed prüfen, Titel/Beschreibungen per KI verbessern, freigeben, exportieren. */

import { useMemo, useState } from "react";
import { Check, Download, FileUp, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { downloadText } from "@/lib/data/table";
import { checkFeed, DEMO_FEED, exportFeed, parseFeed, type CheckedProduct, type Product } from "@/lib/feed/analyze";

const ACCENT = "#c2410c";
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";

type Suggestion = { title: string; description: string; reason: string; status: "open" | "accepted" | "rejected" };

const scoreColor = (s: number) => (s >= 85 ? "#047857" : s >= 60 ? "#b45309" : "#b91c1c");

export default function FeedWindow() {
  const [raw, setRaw] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const checked: CheckedProduct[] = useMemo(() => checkFeed(products), [products]);

  function load(text: string) {
    setError(null); setSuggestions({});
    try {
      const { products: p, columns: c } = parseFeed(text);
      if (!p.length) throw new Error("Keine Produkte erkannt. Erwartet wird ein Merchant-Center-Feed (CSV/TSV mit Spalten id, title … oder XML).");
      setProducts(p);
      setColumns(c);
      const worst = checkFeed(p).map((x, i) => ({ i, s: x.score })).sort((a, b) => a.s - b.s).filter((x) => x.s < 85).slice(0, 15).map((x) => x.i);
      setSelected(new Set(worst));
    } catch (err) { setError((err as Error).message); setProducts([]); }
  }

  const stats = useMemo(() => {
    const errors = checked.reduce((n, c) => n + c.issues.filter((i) => i.level === "error").length, 0);
    const warns = checked.reduce((n, c) => n + c.issues.filter((i) => i.level === "warn").length, 0);
    const avg = checked.length ? Math.round(checked.reduce((n, c) => n + c.score, 0) / checked.length) : 0;
    const byMsg = new Map<string, number>();
    for (const c of checked) for (const i of c.issues) { const key = i.msg.replace(/\(.*?\)|„.*?“/g, "").trim(); byMsg.set(key, (byMsg.get(key) ?? 0) + 1); }
    const top = [...byMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { errors, warns, avg, top, clean: checked.filter((c) => c.issues.length === 0).length };
  }, [checked]);

  async function optimize() {
    const idx = [...selected].slice(0, 60);
    if (!idx.length) return;
    setBusy(true); setError(null);
    try {
      for (let start = 0; start < idx.length; start += 15) {
        const batch = idx.slice(start, start + 15);
        setProgress(`${Math.min(start + 15, idx.length)} / ${idx.length}`);
        const res = await fetch("/api/os/feed", {
          method: "POST", credentials: "include",
          headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
          body: JSON.stringify({ products: batch.map((i) => ({ ...products[i], id: String(i) })) }),
        });
        const d = (await res.json()) as { ok: boolean; error?: string; suggestions?: Array<{ id: string; title: string; description: string; reason: string }> };
        if (!d.ok) throw new Error(d.error ?? "Fehler");
        setSuggestions((prev) => {
          const next = { ...prev };
          for (const s of d.suggestions ?? []) next[Number(s.id)] = { title: s.title, description: s.description, reason: s.reason, status: "open" };
          return next;
        });
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); setProgress(""); }
  }

  function decide(i: number, status: "accepted" | "rejected") {
    setSuggestions((prev) => (prev[i] ? { ...prev, [i]: { ...prev[i]!, status } } : prev));
  }

  function acceptAll() {
    setSuggestions((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.status === "open" ? { ...v, status: "accepted" as const } : v])));
  }

  function exportResult() {
    const out = products.map((p, i) => {
      const s = suggestions[i];
      return s?.status === "accepted" ? { ...p, title: s.title, description: s.description || p.description } : p;
    });
    downloadText(`feed-optimiert-${new Date().toISOString().slice(0, 10)}.tsv`, exportFeed(out as Product[], columns), "text/tab-separated-values;charset=utf-8");
  }

  const accepted = Object.values(suggestions).filter((s) => s.status === "accepted").length;
  const openCount = Object.values(suggestions).filter((s) => s.status === "open").length;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[color:var(--bg-canvas)] p-6 text-[color:var(--text-primary)]">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold">Feed-Optimierer</h2>
            <p className="text-[12.5px] text-[color:var(--text-muted)]">Google-Shopping-Feed prüfen, Titel und Beschreibungen per KI verbessern, freigeben und als neuen Feed exportieren.</p>
          </div>
          <div className="flex gap-2">
            <label className={`${btn} cursor-pointer`}><FileUp size={12} /> Feed laden
              <input type="file" accept=".csv,.tsv,.txt,.xml" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const t = await f.text(); setRaw(t); load(t); } e.target.value = ""; }} />
            </label>
            <button type="button" className={btn} onClick={() => { setRaw(DEMO_FEED); load(DEMO_FEED); }}><Sparkles size={12} /> Demo-Feed</button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className={`${card} mt-4`}>
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Feed hier einfügen (CSV, TSV oder XML aus dem Merchant Center) …" className="h-40 w-full resize-y rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-2 font-mono text-[11px] outline-none" />
            <button type="button" className="mt-2 rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white" style={{ background: ACCENT }} onClick={() => load(raw)}>Prüfen</button>
          </div>
        ) : null}
        {error ? <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12.5px] text-rose-600">{error}</p> : null}

        {products.length ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Feed-Qualität</p><p className="mt-1 text-[28px] font-semibold" style={{ color: scoreColor(stats.avg) }}>{stats.avg}<span className="text-[14px] text-[color:var(--text-muted)]"> / 100</span></p></div>
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Produkte</p><p className="mt-1 text-[28px] font-semibold">{products.length}</p><p className="text-[11.5px] text-[color:var(--text-muted)]">{stats.clean} ohne Befund</p></div>
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Fehler / Hinweise</p><p className="mt-1 text-[28px] font-semibold"><span className="text-rose-600">{stats.errors}</span> <span className="text-[16px] text-amber-600">/ {stats.warns}</span></p><p className="text-[11.5px] text-[color:var(--text-muted)]">Fehler können zur Ablehnung führen</p></div>
              <div className={card}><p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Häufigste Befunde</p>{stats.top.map(([m, n]) => <p key={m} className="truncate text-[11.5px]">{n}× {m}</p>)}</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-[color:var(--text-muted)]">{selected.size} ausgewählt</span>
              <button type="button" className={btn} onClick={() => setSelected(new Set(checked.map((_, i) => i).filter((i) => checked[i]!.score < 85)))}>Alle mit Befund</button>
              <button type="button" className={btn} onClick={() => setSelected(new Set())}>Keine</button>
              <button type="button" disabled={busy || selected.size === 0} onClick={() => void optimize()} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {busy ? `KI arbeitet … ${progress}` : `${Math.min(selected.size, 60)} mit KI optimieren`}
              </button>
              <div className="ml-auto flex gap-2">
                {openCount ? <button type="button" className={btn} onClick={acceptAll}><Check size={12} /> Alle {openCount} übernehmen</button> : null}
                <button type="button" className={btn} onClick={exportResult}><Download size={12} /> Export ({accepted} geändert)</button>
                <button type="button" className={btn} onClick={() => { setProducts([]); setSuggestions({}); }}>Neuer Feed</button>
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--os-border-soft)]">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[color:var(--bg-surface)] text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                  <tr><th className="w-8 px-3 py-2" /><th className="px-3 py-2">ID</th><th className="px-3 py-2">Titel</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2">Befunde</th><th className="px-3 py-2">KI</th></tr>
                </thead>
                <tbody>
                  {checked.map((c, i) => {
                    const s = suggestions[i];
                    return (
                      <FragmentRow key={i}>
                        <tr className="border-t border-[color:var(--os-border-soft)] align-top">
                          <td className="px-3 py-2"><input type="checkbox" checked={selected.has(i)} onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })} /></td>
                          <td className="px-3 py-2 font-mono text-[11px]">{c.product.id || "–"}</td>
                          <td className="max-w-[340px] px-3 py-2"><button type="button" className="text-left hover:underline" onClick={() => setOpen(open === i ? null : i)}>{s?.status === "accepted" ? s.title : c.product.title || <i className="text-[color:var(--text-muted)]">ohne Titel</i>}</button></td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: scoreColor(c.score) }}>{c.score}</td>
                          <td className="px-3 py-2">
                            {c.issues.slice(0, 3).map((x, j) => <p key={j} className={`text-[11px] ${x.level === "error" ? "text-rose-600" : "text-amber-700"}`}>{x.msg}</p>)}
                            {c.issues.length > 3 ? <p className="text-[10.5px] text-[color:var(--text-muted)]">+{c.issues.length - 3} weitere</p> : null}
                          </td>
                          <td className="px-3 py-2 text-[11px]">{s ? (s.status === "accepted" ? <span className="text-emerald-600">übernommen</span> : s.status === "rejected" ? <span className="text-[color:var(--text-muted)]">verworfen</span> : <button type="button" className="font-medium" style={{ color: ACCENT }} onClick={() => setOpen(i)}>Vorschlag ansehen</button>) : "–"}</td>
                        </tr>
                        {open === i ? (
                          <tr className="bg-[color:var(--bg-elevated)]">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Aktuell</p>
                                  <p className="text-[12.5px] font-semibold">{c.product.title || "–"}</p>
                                  <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-[color:var(--text-secondary)]">{c.product.description || "–"}</p>
                                  <div className="mt-2 space-y-0.5">{c.issues.map((x, j) => <p key={j} className={`text-[11px] ${x.level === "error" ? "text-rose-600" : "text-amber-700"}`}>• {x.msg}</p>)}</div>
                                </div>
                                <div>
                                  <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">KI-Vorschlag</p>
                                  {s ? (
                                    <>
                                      <p className="text-[12.5px] font-semibold">{s.title} <span className="font-normal text-[color:var(--text-muted)]">({s.title.length} Z.)</span></p>
                                      <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-[color:var(--text-secondary)]">{s.description}</p>
                                      <p className="mt-2 text-[11px] italic text-[color:var(--text-muted)]">{s.reason}</p>
                                      <div className="mt-2 flex gap-2">
                                        <button type="button" className={btn} onClick={() => decide(i, "accepted")}><Check size={12} /> Übernehmen</button>
                                        <button type="button" className={btn} onClick={() => decide(i, "rejected")}><X size={12} /> Verwerfen</button>
                                      </div>
                                    </>
                                  ) : <p className="text-[11.5px] text-[color:var(--text-muted)]">Noch kein Vorschlag – Produkt auswählen und „mit KI optimieren“.</p>}
                                  <p className="mt-2 text-[10.5px] text-[color:var(--text-muted)]">Pflichtangaben wie GTIN, Bild-Link oder Verfügbarkeit kann die KI nicht erfinden – diese im Shop-System ergänzen.</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
