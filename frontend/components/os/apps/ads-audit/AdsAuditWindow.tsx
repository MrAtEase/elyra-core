"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Download, FileText, RotateCcw, ScanSearch, ShieldAlert, Sparkles, Upload, X } from "lucide-react";
import ChatMarkdown from "@/components/agent/ChatMarkdown";
import {
  analyzeAdsAudit,
  exportAdsAuditApproved,
  fetchAdsAuditDemo,
  fetchAdsAuditSummary,
  type AdsAuditInput,
  type AdsAuditProposal,
  type AdsAuditResponse,
  type AdsAuditSummary,
} from "@/components/os/kernel/aiClient";

/**
 * Marketing Tools › Ads Audit
 * Analysiert einen Google-Ads-Suchbegriff-Bericht: verschwendetes Budget, Ausschluss-Keywords,
 * auffällige Klickzeiten. Die Analyse ist deterministischer Code im AI-Service; Elly schreibt
 * nur den Bericht. Kein Vorschlag wird ohne menschliche Freigabe exportiert.
 */

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const pct = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

const TYPE_LABEL: Record<AdsAuditProposal["type"], string> = {
  negative_keyword_phrase: "Ausschluss (Wortgruppe)",
  negative_keyword_exact: "Ausschluss (genau)",
  review_term: "Prüfen: teurer Begriff",
  review_hours: "Prüfen: Klickzeiten",
};

type LogEntry = { at: string; id: string; action: "freigegeben" | "abgelehnt" | "zurückgesetzt" | "exportiert"; detail: string };

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string | undefined; tone?: "warn" | "ok" | undefined }) {
  const color = tone === "warn" ? "#dc2626" : tone === "ok" ? "#16a34a" : "var(--text-primary)";
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tabular-nums" style={{ color }}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{sub}</p> : null}
    </div>
  );
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const readFile = (file: File) => file.text();

export default function AdsAuditWindow() {
  const [input, setInput] = useState<AdsAuditInput | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [data, setData] = useState<AdsAuditResponse | null>(null);
  const [proposals, setProposals] = useState<AdsAuditProposal[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdsAuditSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const termsRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (next: AdsAuditInput, demo: boolean) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await analyzeAdsAudit(next);
      setInput(next);
      setIsDemo(demo);
      setData(res);
      setProposals(res.report.proposals);
      setLog([]);
    } catch (err) {
      setError((err as Error).message || "Analyse fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const demo = await fetchAdsAuditDemo();
      await run({ searchTermsCsv: demo.searchTermsCsv, hoursCsv: demo.hoursCsv, account: demo.account }, true);
    } catch (err) {
      setError((err as Error).message || "Demo-Daten konnten nicht geladen werden");
      setLoading(false);
    }
  }, [run]);

  const loadFiles = useCallback(async () => {
    const termsFile = termsRef.current?.files?.[0];
    if (!termsFile) {
      setError("Bitte zuerst einen Suchbegriff-Bericht (CSV) auswählen.");
      return;
    }
    const hoursFile = hoursRef.current?.files?.[0];
    const [searchTermsCsv, hoursCsv] = await Promise.all([readFile(termsFile), hoursFile ? readFile(hoursFile) : Promise.resolve(undefined)]);
    await run({ searchTermsCsv, ...(hoursCsv ? { hoursCsv } : {}), account: termsFile.name.replace(/\.csv$/i, "") }, false);
  }, [run]);

  const decide = useCallback((p: AdsAuditProposal, status: AdsAuditProposal["status"]) => {
    setProposals((prev) => prev.map((x) => (x.id === p.id ? { ...x, status } : x)));
    const action: LogEntry["action"] = status === "approved" ? "freigegeben" : status === "rejected" ? "abgelehnt" : "zurückgesetzt";
    setLog((prev) => [{ at: new Date().toLocaleTimeString("de-DE"), id: p.id, action, detail: String(p.payload["keyword"] ?? p.payload["hours"] ?? "") }, ...prev]);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!input) return;
    setSummaryLoading(true);
    try {
      setSummary(await fetchAdsAuditSummary(input));
    } catch (err) {
      setError((err as Error).message || "Bericht konnte nicht erstellt werden");
    } finally {
      setSummaryLoading(false);
    }
  }, [input]);

  const approvedCount = useMemo(() => proposals.filter((p) => p.status === "approved").length, [proposals]);
  const pendingCount = useMemo(() => proposals.filter((p) => p.status === "pending").length, [proposals]);
  const approvedSavings = useMemo(
    () => proposals.filter((p) => p.status === "approved" && p.type.startsWith("negative")).reduce((s, p) => s + p.affectedCost, 0),
    [proposals],
  );

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const res = await exportAdsAuditApproved(proposals);
      downloadText("ads-editor-ausschluesse.csv", res.csv, "text/csv");
      setLog((prev) => [{ at: new Date().toLocaleTimeString("de-DE"), id: "EXPORT", action: "exportiert", detail: `${res.approved} freigegebene Vorschläge → Google Ads Editor CSV` }, ...prev]);
    } catch (err) {
      setError((err as Error).message || "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  }, [proposals]);

  const exportReport = useCallback(() => {
    if (!data) return;
    const decisions = proposals.map((p) => `- ${p.id} (${TYPE_LABEL[p.type]}): **${p.status === "approved" ? "freigegeben" : p.status === "rejected" ? "abgelehnt" : "offen"}** – ${p.rationale}`);
    const text = [
      summary ? summary.markdown : "",
      "",
      data.markdown,
      "",
      "## Entscheidungen",
      ...decisions,
      isDemo ? "\n_Demo mit fiktiven Daten._" : "",
    ].join("\n");
    downloadText("ads-audit-bericht.md", text, "text/markdown");
  }, [data, proposals, summary, isDemo]);

  const report = data?.report;
  const share = report && report.totals.cost > 0 ? (report.wastedCost / report.totals.cost) * 100 : 0;
  const maxHourClicks = useMemo(() => Math.max(1, ...(data?.hours ?? []).map((h) => h.clicks)), [data]);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-canvas, transparent)" }}>
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <ScanSearch size={18} className="text-[color:var(--text-primary)]" />
        <div className="mr-auto">
          <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">Ads Audit</p>
          <p className="text-[11px] text-[color:var(--text-muted)]">Google-Ads-Suchbegriffe · Vorschläge werden nur nach Freigabe exportiert</p>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
          <Upload size={13} /> Suchbegriffe
          <input ref={termsRef} type="file" accept=".csv,text/csv" className="hidden" />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }}>
          <Upload size={13} /> Klicks/Stunde (optional)
          <input ref={hoursRef} type="file" accept=".csv,text/csv" className="hidden" />
        </label>
        <button type="button" onClick={() => void loadFiles()} disabled={loading}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "#7B61FF" }}>
          Analysieren
        </button>
        <button type="button" onClick={() => void loadDemo()} disabled={loading}
          className="rounded-lg border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)] disabled:opacity-50" style={{ borderColor: "var(--os-border-soft)" }}>
          Demo-Daten
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] text-[#dc2626]" style={{ borderColor: "#dc262655" }}>
            <ShieldAlert size={14} /> {error}
          </div>
        ) : null}

        {loading ? <p className="text-[12px] text-[color:var(--text-muted)]">Analysiere …</p> : null}

        {!data && !loading ? (
          <div className="mx-auto mt-16 max-w-md text-center text-[13px] text-[color:var(--text-muted)]">
            <ScanSearch size={28} className="mx-auto mb-3 opacity-60" />
            <p>Lade einen Suchbegriff-Bericht aus Google Ads (CSV, deutsch oder englisch) oder starte mit den Demo-Daten.</p>
            <p className="mt-2 text-[11px]">Elly schlägt vor – du entscheidest. Nichts wird automatisch geändert.</p>
          </div>
        ) : null}

        {data && report ? (
          <>
            {isDemo ? (
              <p className="mb-3 text-[11px] text-[color:var(--text-muted)]">Demo mit fiktiven Daten · {data.account}</p>
            ) : (
              <p className="mb-3 text-[11px] text-[color:var(--text-muted)]">{data.account} · {data.termCount} Suchbegriffe</p>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Kosten gesamt" value={eur(report.totals.cost)} sub={`CPA ${report.totals.cpa === null ? "–" : eur(report.totals.cpa)}`} />
              <Tile label="Ohne Conversion" value={eur(report.wastedCost)} sub={`${pct(share)} der Kosten`} tone="warn" />
              <Tile label="Freigegeben" value={`${approvedCount} / ${proposals.length}`} sub={`${pendingCount} offen · betrifft ${eur(approvedSavings)}`} tone={approvedCount ? "ok" : undefined} />
              <Tile label="Auffällige Stunden" value={String(report.hourAnomalies.length)} sub={report.hourAnomalies.length ? report.hourAnomalies.map((h) => `${h.hour}–${h.hour + 1} Uhr`).join(", ") : "keine"} tone={report.hourAnomalies.length ? "warn" : undefined} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
              {/* Vorschläge mit Freigabe */}
              <section className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-[color:var(--text-primary)]">Vorschläge zur Freigabe</h3>
                  <button type="button" onClick={() => void exportCsv()} disabled={!approvedCount || exporting}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40" style={{ background: "#16a34a" }}>
                    <Download size={12} /> Ads-Editor-CSV ({approvedCount})
                  </button>
                </div>
                <ul className="space-y-2">
                  {proposals.map((p) => (
                    <li key={p.id} className="rounded-xl border px-3 py-2" style={{
                      borderColor: p.status === "approved" ? "#16a34a66" : p.status === "rejected" ? "#dc262644" : "var(--os-border-soft)",
                      opacity: p.status === "rejected" ? 0.6 : 1,
                    }}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-[color:var(--text-primary)]">
                            <span className="mr-1.5 text-[10px] text-[color:var(--text-muted)]">{p.id}</span>
                            {TYPE_LABEL[p.type]}
                            {typeof p.payload["keyword"] === "string" ? <> · <code className="text-[11px]">{p.payload["keyword"]}</code></> : null}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">{p.rationale}</p>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--text-muted)]">{eur(p.affectedCost)}</span>
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        {p.status === "pending" ? (
                          <>
                            <button type="button" onClick={() => decide(p, "approved")} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-white" style={{ background: "#16a34a" }}>
                              <Check size={11} /> Freigeben
                            </button>
                            <button type="button" onClick={() => decide(p, "rejected")} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                              <X size={11} /> Ablehnen
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => decide(p, "pending")} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }}>
                            <RotateCcw size={11} /> {p.status === "approved" ? "Freigegeben" : "Abgelehnt"} · zurücksetzen
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="space-y-4">
                {/* Verschwendete Suchbegriffe */}
                <section className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                  <h3 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Suchbegriffe ohne Conversion</h3>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[color:var(--text-muted)]"><th className="py-1 font-medium">Suchbegriff</th><th className="py-1 text-right font-medium">Klicks</th><th className="py-1 text-right font-medium">Kosten</th></tr>
                    </thead>
                    <tbody>
                      {report.wasted.slice(0, 12).map((w) => (
                        <tr key={`${w.campaign}-${w.term}`} className="border-t" style={{ borderColor: "var(--os-border-soft)" }}>
                          <td className="py-1 text-[color:var(--text-primary)]">{w.term}</td>
                          <td className="py-1 text-right tabular-nums text-[color:var(--text-muted)]">{w.clicks}</td>
                          <td className="py-1 text-right tabular-nums text-[color:var(--text-primary)]">{eur(w.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {/* Klicks nach Stunde */}
                {data.hours.length ? (
                  <section className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                    <h3 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Klicks nach Stunde</h3>
                    <div className="flex h-24 items-end gap-[3px]">
                      {data.hours.map((h) => {
                        const flagged = report.hourAnomalies.some((a) => a.hour === h.hour);
                        return (
                          <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${h.hour} Uhr: ${h.clicks} Klicks, ${h.conversions.toLocaleString("de-DE")} Conversions`}>
                            <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (h.clicks / maxHourClicks) * 80)}px`, background: flagged ? "#dc2626" : "#7B61FF99" }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-[color:var(--text-muted)]"><span>0 Uhr</span><span>12 Uhr</span><span>23 Uhr</span></div>
                    {report.hourAnomalies.length ? (
                      <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">Rot: viele Klicks, kaum Conversions – möglicher ungültiger Traffic, kein Beweis.</p>
                    ) : null}
                  </section>
                ) : null}

                {/* Freigabe-Protokoll */}
                <section className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                  <h3 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Freigabe-Protokoll</h3>
                  {log.length === 0 ? (
                    <p className="text-[11px] text-[color:var(--text-muted)]">Noch keine Entscheidungen.</p>
                  ) : (
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">
                      {log.map((l, i) => (
                        <li key={`${l.at}-${l.id}-${i}`} className="text-[color:var(--text-muted)]">
                          <span className="tabular-nums">{l.at}</span> · <span className="text-[color:var(--text-primary)]">{l.id}</span> {l.action}{l.detail ? ` – ${l.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>

            {/* Elly-Bericht */}
            <section className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-[13px] font-semibold text-[color:var(--text-primary)]">Kundenbericht von Elly</h3>
                <button type="button" onClick={() => void loadSummary()} disabled={summaryLoading}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50" style={{ background: "#7B61FF" }}>
                  <Sparkles size={12} /> {summaryLoading ? "Schreibe …" : summary ? "Neu schreiben" : "Bericht schreiben"}
                </button>
                <button type="button" onClick={exportReport}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                  <FileText size={12} /> Bericht (.md)
                </button>
              </div>
              {summary ? (
                <>
                  <ChatMarkdown text={summary.markdown} />
                  {summary.headlines.length ? (
                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-medium text-[color:var(--text-muted)]">Neue Anzeigentitel (max. 30 Zeichen)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.headlines.map((h) => (
                          <span key={h} className="rounded-full border px-2 py-0.5 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                            {h} <span className="text-[color:var(--text-muted)]">{h.length}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <p className="mt-2 text-[10px] text-[color:var(--text-muted)]">
                    {summary.source === "model" ? `Geschrieben von ${summary.model ?? "KI-Modell"} auf Basis der berechneten Zahlen.` : "Regelbasierter Bericht (kein KI-Modell erreichbar)."}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-[color:var(--text-muted)]">Elly fasst die Ergebnisse für den Kunden zusammen und schlägt neue Anzeigentitel vor. Sie sieht nur die berechneten Zahlen.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
