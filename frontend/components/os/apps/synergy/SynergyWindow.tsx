"use client";

/** Search-Synergie – Google Ads × Search Console: wo zahlt man doppelt, wo fehlt SEO, wo fehlt Paid? */

import { useMemo, useState } from "react";
import { Download, FileUp, Loader2, Sparkles, Wand2 } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { Markdown } from "@/components/os/apps/toolbox/ToolboxWindow";
import { downloadText, toCsv } from "@/lib/data/table";
import {
  analyzeSynergy, CLASS_LABEL, DEMO_ORGANIC, DEMO_PAID, parseOrganic, parsePaid, type SynergyClass, type SynergyResult,
} from "@/lib/synergy/analyze";

const ACCENT = "#0e7490";
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";
const area = "h-28 w-full resize-y rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-2 font-mono text-[11px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]";
const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const CLASS_COLOR: Record<SynergyClass, string> = {
  sparen: "#b45309", seo_chance: "#047857", paid_chance: "#4338ca", doppelt: "#0e7490", nur_paid: "#6b7280", nur_organisch: "#6b7280",
};

function Upload({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={card}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] font-semibold">{label}</p>
        <label className={`${btn} cursor-pointer`}>
          <FileUp size={12} /> Datei
          <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await f.text()); e.target.value = ""; }} />
        </label>
      </div>
      <p className="mb-2 text-[11px] text-[color:var(--text-muted)]">{hint}</p>
      <textarea className={area} value={value} onChange={(e) => onChange(e.target.value)} placeholder="…oder CSV hier einfügen" />
      <p className="mt-1 text-[10.5px] text-[color:var(--text-muted)]">{value ? `${value.split("\n").length} Zeilen` : "leer"}</p>
    </div>
  );
}

export default function SynergyWindow() {
  const [paidText, setPaidText] = useState("");
  const [orgText, setOrgText] = useState("");
  const [brands, setBrands] = useState("");
  const [result, setResult] = useState<SynergyResult | null>(null);
  const [filter, setFilter] = useState<SynergyClass | "alle">("alle");
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  function run() {
    setError(null); setAi(null);
    try {
      const paid = parsePaid(paidText);
      const organic = parseOrganic(orgText);
      if (!paid.length || !organic.length) throw new Error("Bitte beide Exporte einfügen (Google Ads und Search Console).");
      setResult(analyzeSynergy(paid, organic, brands.split(/[,\n]/)));
      setFilter("alle");
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    }
  }

  function demo() {
    setPaidText(DEMO_PAID);
    setOrgText(DEMO_ORGANIC);
    setBrands("musteragentur");
    setTimeout(() => {
      try { setResult(analyzeSynergy(parsePaid(DEMO_PAID), parseOrganic(DEMO_ORGANIC), ["musteragentur"])); setAi(null); setError(null); } catch (e) { setError((e as Error).message); }
    }, 0);
  }

  async function assess() {
    if (!result) return;
    setAiBusy(true); setError(null);
    try {
      const pick = (c: SynergyClass) => result.rows.filter((r) => r.cls === c).slice(0, 12).map((r) => ({
        term: r.term, brand: r.brand, cost: r.paid?.cost, conv: r.paid?.conversions, paidClicks: r.paid?.clicks,
        position: r.organic?.position, orgClicks: r.organic?.clicks, impressions: r.organic?.impressions,
      }));
      const res = await fetch("/api/os/synergy", {
        method: "POST", credentials: "include",
        headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
        body: JSON.stringify({ kpis: result.kpis, counts: result.counts, sparen: pick("sparen"), seo_chance: pick("seo_chance"), paid_chance: pick("paid_chance"), nur_paid_ohne_conversion: pick("nur_paid") }),
      });
      const d = (await res.json()) as { ok: boolean; markdown?: string; error?: string };
      if (!d.ok) throw new Error(d.error ?? "Fehler");
      setAi(d.markdown ?? "");
    } catch (err) { setError((err as Error).message); } finally { setAiBusy(false); }
  }

  function exportCsv() {
    if (!result) return;
    const rows = result.rows.map((r) => ({
      Suchbegriff: r.term, Kategorie: CLASS_LABEL[r.cls], Marke: r.brand ? "ja" : "", "Ads Kosten": r.paid?.cost.toFixed(2) ?? "", "Ads Klicks": r.paid?.clicks ?? "",
      "Ads Conversions": r.paid?.conversions ?? "", "Org. Position": r.organic?.position.toFixed(1) ?? "", "Org. Klicks": r.organic?.clicks ?? "",
      "Org. Impressionen": r.organic?.impressions ?? "", Empfehlung: r.note,
    }));
    downloadText(`search-synergie-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, Object.keys(rows[0] ?? { Suchbegriff: "" })));
  }

  const shown = useMemo(() => (result ? result.rows.filter((r) => filter === "alle" || r.cls === filter) : []), [result, filter]);
  const k = result?.kpis;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[color:var(--bg-canvas)] p-6 text-[color:var(--text-primary)]">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold">Search-Synergie</h2>
            <p className="text-[12.5px] text-[color:var(--text-muted)]">Google Ads × Search Console: Wo zahlst du für Klicks, die du organisch schon hast – und wo fehlt SEO oder eine Anzeige?</p>
          </div>
          <button type="button" className={btn} onClick={demo}><Sparkles size={12} /> Demo-Daten</button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Upload label="Google Ads – Suchbegriffe" hint="Google Ads › Statistiken und Berichte › Suchbegriffe › Herunterladen (CSV). Spalten: Suchbegriff, Klicks, Impr., Kosten, Conversions." value={paidText} onChange={setPaidText} />
          <Upload label="Search Console – Suchanfragen" hint="Search Console › Leistung › Exportieren › CSV › Datei „Suchanfragen“. Spalten: Häufigste Suchanfragen, Klicks, Impressionen, CTR, Position." value={orgText} onChange={setOrgText} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="Markenbegriffe (kommagetrennt), z. B. hurra, hurra.com" className="w-80 rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12.5px] outline-none" />
          <button type="button" onClick={run} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white" style={{ background: ACCENT }}>Auswerten</button>
          {error ? <span className="text-[12px] text-rose-600">{error}</span> : null}
        </div>

        {result && k ? (
          <>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Sparpotenzial</p><p className="mt-1 text-[26px] font-semibold" style={{ color: CLASS_COLOR.sparen }}>{eur(k.costOnTop3)}</p><p className="text-[11.5px] text-[color:var(--text-muted)]">Ads-Kosten für {result.counts.sparen} Begriffe mit organischem Top-3-Platz</p></div>
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">SEO-Chancen</p><p className="mt-1 text-[26px] font-semibold" style={{ color: CLASS_COLOR.seo_chance }}>{result.counts.seo_chance}</p><p className="text-[11.5px] text-[color:var(--text-muted)]">Begriffe mit {k.convOnSeoChances.toLocaleString("de-DE")} Conversions über Ads, organisch schwach</p></div>
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Paid-Lücken</p><p className="mt-1 text-[26px] font-semibold" style={{ color: CLASS_COLOR.paid_chance }}>{result.counts.paid_chance}</p><p className="text-[11.5px] text-[color:var(--text-muted)]">{k.paidGapImpressions.toLocaleString("de-DE")} organische Impressionen ohne Anzeige, Platz 4–20</p></div>
              <div className={card}><p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Überschneidung</p><p className="mt-1 text-[26px] font-semibold" style={{ color: ACCENT }}>{k.overlap}</p><p className="text-[11.5px] text-[color:var(--text-muted)]">von {k.paidTerms} bezahlten / {k.organicTerms} organischen Begriffen · Ads gesamt {eur(k.paidCost)}</p></div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {(["alle", "sparen", "seo_chance", "paid_chance", "doppelt", "nur_paid", "nur_organisch"] as const).map((c) => (
                <button key={c} type="button" onClick={() => setFilter(c)}
                  className={`rounded-full border px-3 py-1 text-[11.5px] ${filter === c ? "border-transparent text-white" : "border-[color:var(--os-border-soft)] text-[color:var(--text-secondary)]"}`}
                  style={filter === c ? { background: c === "alle" ? ACCENT : CLASS_COLOR[c] } : undefined}>
                  {c === "alle" ? `Alle (${result.rows.length})` : `${CLASS_LABEL[c]} (${result.counts[c]})`}
                </button>
              ))}
              <div className="ml-auto flex gap-2">
                <button type="button" className={btn} onClick={exportCsv}><Download size={12} /> CSV</button>
                <button type="button" className={btn} disabled={aiBusy} onClick={() => void assess()}>{aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} KI-Einschätzung</button>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-2xl border border-[color:var(--os-border-soft)]">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[color:var(--bg-surface)] text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                  <tr><th className="px-3 py-2">Suchbegriff</th><th className="px-3 py-2">Kategorie</th><th className="px-3 py-2 text-right">Ads-Kosten</th><th className="px-3 py-2 text-right">Conv.</th><th className="px-3 py-2 text-right">Org. Pos.</th><th className="px-3 py-2 text-right">Org. Klicks</th><th className="px-3 py-2">Empfehlung</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.term} className="border-t border-[color:var(--os-border-soft)]">
                      <td className="px-3 py-2 font-medium">{r.term}{r.brand ? <span className="ml-1.5 rounded bg-[color:var(--bg-surface-hover)] px-1 text-[9.5px] text-[color:var(--text-muted)]">Marke</span> : null}</td>
                      <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[10.5px] font-medium text-white" style={{ background: CLASS_COLOR[r.cls] }}>{CLASS_LABEL[r.cls]}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.paid ? eur(r.paid.cost) : "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.paid ? r.paid.conversions.toLocaleString("de-DE") : "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.organic?.position ? r.organic.position.toFixed(1) : "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.organic ? r.organic.clicks.toLocaleString("de-DE") : "–"}</td>
                      <td className="px-3 py-2 text-[11.5px] text-[color:var(--text-secondary)]">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ai ? <div className={`${card} mt-4`}><Markdown text={ai} /></div> : null}
            <p className="mt-3 text-[10.5px] text-[color:var(--text-muted)]">Hinweis: „Sparpotenzial“ ist das Budget, das man testweise einsparen kann – ob organische Klicks die bezahlten auffangen, zeigt erst ein sauberer Test (z. B. 2–4 Wochen pausieren und vergleichen).</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
