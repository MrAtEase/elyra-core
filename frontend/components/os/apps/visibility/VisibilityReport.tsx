"use client";

/**
 * Druckbericht „KI-Sichtbarkeit" – eigenes A4-Layout ohne App-Oberfläche.
 * Wird per Portal direkt in <body> gerendert; alles andere wird beim Drucken ausgeblendet.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ProviderId = "gemini" | "openai" | "anthropic";
type Summary = {
  total: number; answered: number; mentioned: number; rate: number; avg_position: number | null;
  by_provider: Record<string, { answered: number; mentioned: number; rate: number }>;
  competitors: Array<{ name: string; mentions: number; rate: number }>;
  others: Array<{ name: string; mentions: number }>;
};
type Result = {
  prompt: string; provider: ProviderId; model: string; ok: boolean; error?: string; answer: string; mentioned: boolean; position: number | null;
  brands: Array<{ name: string; rank: number }>; competitors_mentioned: string[]; sources: string[]; searched: boolean;
};
export type ReportRun = { id: string; created_at: string; summary: Summary; results: Result[]; recommendations: string | null };
export type ReportProject = { name: string; domain: string | null; industry: string | null; location: string | null; competitors: string[]; prompts: string[] };

const PROVIDER: Record<string, string> = { gemini: "Gemini", openai: "ChatGPT", anthropic: "Claude" };
const ACCENT = "#6d28d9";
const pct = (x: number) => `${Math.round(x * 100)} %`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

// ── minimal Markdown (headings, lists, bold, paragraphs) for the recommendations ──
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <em key={i}>{part.slice(1, -1)}</em>
        : <Fragment key={i}>{part}</Fragment>,
  );
}
function Md({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = (lines[i] ?? "").trim();
    if (!t || /^-{3,}$/.test(t)) { i++; continue; }
    if (/^#{1,4}\s/.test(t)) {
      const level = t.match(/^#+/)![0].length;
      const c = t.replace(/^#+\s*/, "");
      out.push(level <= 2 ? <h3 key={i} className="r-h3">{inline(c)}</h3> : <h4 key={i} className="r-h4">{inline(c)}</h4>);
      i++; continue;
    }
    if (/^([-*•]|\d+[.)])\s/.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s/.test(lines[i] ?? "")) { items.push((lines[i] ?? "").trim().replace(/^([-*•]|\d+[.)])\s+/, "")); i++; }
      const L = ordered ? "ol" : "ul";
      out.push(<L key={`l${i}`} className="r-list">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,4}\s|([-*•]|\d+[.)])\s|-{3,}$)/.test((lines[i] ?? "").trim())) { para.push((lines[i] ?? "").trim()); i++; }
    out.push(<p key={`p${i}`} className="r-p">{inline(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

function Bar({ value, color }: { value: number; color: string }) {
  return <div className="r-bar"><div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>;
}

function Trend({ runs }: { runs: Array<{ created_at: string; summary: Summary }> }) {
  if (runs.length < 2) return <p className="r-muted">Der Verlauf wird ab der zweiten Messung angezeigt.</p>;
  const W = 640, H = 160, P = 40;
  const sameDay = new Set(runs.map((r) => r.created_at.slice(0, 10))).size < runs.length;
  const x = (i: number) => P + (i * (W - 2 * P)) / (runs.length - 1);
  const y = (r: number) => H - P - r * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, 0.5, 1].map((g) => (
        <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#e5e7eb" /><text x={P - 8} y={y(g) + 3} fontSize={10} textAnchor="end" fill="#6b7280">{g * 100} %</text></g>
      ))}
      <polyline points={runs.map((r, i) => `${x(i)},${y(r.summary.rate)}`).join(" ")} fill="none" stroke={ACCENT} strokeWidth={2.5} />
      {runs.map((r, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(r.summary.rate)} r={4} fill={ACCENT} />
          <text x={x(i)} y={y(r.summary.rate) - 9} fontSize={10} textAnchor="middle" fill="#111827">{pct(r.summary.rate)}</text>
          <text x={x(i)} y={H - 8} fontSize={10} textAnchor="middle" fill="#6b7280">{new Date(r.created_at).toLocaleString("de-DE", sameDay ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" })}</text>
        </g>
      ))}
    </svg>
  );
}

function Report({ project, run, history }: { project: ReportProject; run: ReportRun; history: Array<{ created_at: string; summary: Summary }> }) {
  const s = run.summary;
  const prev = history.length > 1 ? history[history.length - 2]! : null;
  const delta = prev ? Math.round((s.rate - prev.summary.rate) * 100) : null;
  const providers = Object.keys(s.by_provider).map((p) => PROVIDER[p] ?? p).join(", ");
  const searched = run.results.some((r) => r.searched);
  const rivals = s.competitors.length
    ? s.competitors.map((c) => ({ name: c.name, mentions: c.mentions, you: false }))
    : s.others.slice(0, 5).map((o) => ({ name: o.name, mentions: o.mentions, you: false }));
  const comparison = [{ name: project.name, mentions: s.mentioned, you: true }, ...rivals].sort((a, b) => b.mentions - a.mentions);
  const sources = [...new Set(run.results.flatMap((r) => r.sources))];

  return (
    <div className="r-doc">
      {/* Cover / header */}
      <header className="r-header">
        <div className="r-brand">
          <span className="r-mark" aria-hidden />
          <span>ELYRA</span>
        </div>
        <div className="r-header-right">KI-Sichtbarkeitsbericht · {fmtDate(run.created_at)}</div>
      </header>

      <section className="r-cover">
        <p className="r-kicker">KI-Sichtbarkeit (GEO)</p>
        <h1 className="r-title">{project.name}</h1>
        <p className="r-sub">{[project.industry, project.location, project.domain].filter(Boolean).join(" · ")}</p>
        <p className="r-meta">
          {s.answered} Antworten ausgewertet · {project.prompts.length} Kundenfragen · Assistenten: {providers || "–"} · {searched ? "mit Websuche" : "ohne Websuche"}
        </p>
      </section>

      {/* KPIs */}
      <section className="r-kpis">
        <div className="r-kpi r-kpi-main">
          <p className="r-label">Erwähnt in KI-Antworten</p>
          <p className="r-big">{s.mentioned}<span> von {s.answered}</span></p>
          <p className="r-small">{pct(s.rate)} Sichtbarkeit{delta !== null ? ` · ${delta >= 0 ? "+" : ""}${delta} Punkte zur Vormessung` : ""}</p>
        </div>
        <div className="r-kpi">
          <p className="r-label">Ø Position</p>
          <p className="r-big">{s.avg_position ?? "–"}</p>
          <p className="r-small">wenn genannt (1 = zuerst)</p>
        </div>
        <div className="r-kpi">
          <p className="r-label">Je Assistent</p>
          {Object.entries(s.by_provider).map(([k, v]) => (
            <div key={k} className="r-prov">
              <div className="r-row"><span>{PROVIDER[k] ?? k}</span><span>{v.mentioned}/{v.answered}</span></div>
              <Bar value={v.rate} color={ACCENT} />
            </div>
          ))}
        </div>
      </section>

      {/* Summary sentence */}
      <section className="r-callout">
        {s.mentioned === 0
          ? <>Bei {s.answered} typischen Kundenfragen hat keine KI <strong>{project.name}</strong> empfohlen.{s.others[0] ? <> Am häufigsten genannt wurde stattdessen <strong>{s.others[0].name}</strong> ({s.others[0].mentions}×).</> : null}</>
          : <><strong>{project.name}</strong> wurde in {s.mentioned} von {s.answered} Antworten genannt ({pct(s.rate)}).{s.others[0] ? <> Häufigster anderer Anbieter: <strong>{s.others[0].name}</strong> ({s.others[0].mentions}×).</> : null}</>}
      </section>

      {/* Competition */}
      <section className="r-grid2">
        <div>
          <h2 className="r-h2">Im Vergleich</h2>
          {comparison.map((c) => (
            <div key={c.name} className="r-comp">
              <div className="r-row"><span className={c.you ? "r-you" : ""}>{c.name}{c.you ? " (Sie)" : ""}</span><span>{c.mentions}×</span></div>
              <Bar value={s.answered ? c.mentions / s.answered : 0} color={c.you ? ACCENT : "#9ca3af"} />
            </div>
          ))}
          {s.competitors.length === 0 ? <p className="r-muted">Keine Wettbewerber hinterlegt – verglichen mit den am häufigsten empfohlenen Anbietern.</p> : null}
        </div>
        <div>
          <h2 className="r-h2">Stattdessen empfohlen</h2>
          {s.others.length === 0 ? <p className="r-muted">Keine weiteren Anbieter genannt.</p> : (
            <table className="r-table">
              <tbody>
                {s.others.slice(0, 12).map((o, i) => (
                  <tr key={o.name}><td className="r-num">{i + 1}.</td><td>{o.name}</td><td className="r-right">{o.mentions}×</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="r-h2">Verlauf</h2>
        <Trend runs={history} />
      </section>

      {/* Overview table */}
      <section className="r-break">
        <h2 className="r-h2">Alle Fragen im Überblick</h2>
        <table className="r-table r-overview">
          <thead><tr><th>#</th><th>Frage</th><th>KI</th><th>Ergebnis</th><th>Genannt wurden</th></tr></thead>
          <tbody>
            {run.results.map((r, i) => (
              <tr key={i}>
                <td className="r-num">{i + 1}</td>
                <td>{r.prompt}</td>
                <td>{PROVIDER[r.provider]}</td>
                <td>{!r.ok ? <span className="r-warn">Fehler</span> : r.mentioned ? <span className="r-ok">✓ {r.position ? `Platz ${r.position}` : "genannt"}</span> : <span className="r-no">✕ nicht genannt</span>}</td>
                <td>{r.brands.slice(0, 5).map((b) => b.name).join(", ") || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Full answers */}
      <section className="r-break">
        <h2 className="r-h2">Antworten im Wortlaut</h2>
        {run.results.map((r, i) => (
          <article key={i} className="r-answer">
            <div className="r-answer-head">
              <span className="r-num">{i + 1}.</span>
              <span className="r-q">{r.prompt}</span>
              <span className={r.mentioned ? "r-ok" : r.ok ? "r-no" : "r-warn"}>{!r.ok ? "Fehler" : r.mentioned ? `✓ genannt${r.position ? ` (Platz ${r.position})` : ""}` : "✕ nicht genannt"}</span>
            </div>
            <p className="r-answer-meta">{PROVIDER[r.provider]} · {r.model}{r.searched ? " · mit Websuche" : ""}</p>
            {r.ok ? <div className="r-answer-text"><Md text={r.answer} /></div> : <p className="r-warn">{r.error}</p>}
            {r.sources.length ? <p className="r-answer-meta">Quellen: {r.sources.join(", ")}</p> : null}
          </article>
        ))}
      </section>

      {sources.length ? (
        <section>
          <h2 className="r-h2">Von den KIs genutzte Quellen</h2>
          <p className="r-p">{sources.join(" · ")}</p>
        </section>
      ) : null}

      {run.recommendations ? (
        <section className="r-break">
          <h2 className="r-h2">Maßnahmen für mehr KI-Sichtbarkeit</h2>
          <Md text={run.recommendations} />
        </section>
      ) : null}

      <section className="r-method">
        <h2 className="r-h2">Methodik</h2>
        <p className="r-p">
          Elyra stellt KI-Assistenten typische Fragen potenzieller Kunden – ohne Nennung des Firmennamens – und prüft jede Antwort,
          ob das Unternehmen (inkl. Schreibvarianten und Website) genannt wird und welche Anbieter stattdessen empfohlen werden.
          KI-Antworten variieren von Anfrage zu Anfrage; aussagekräftig ist daher der Verlauf über mehrere Messungen.
        </p>
      </section>

      <footer className="r-footer">Erstellt mit Elyra Core · {new Date(run.created_at).toLocaleString("de-DE")}</footer>
    </div>
  );
}

const CSS = `
@media screen { #elyra-print-report { position: fixed; left: -100000px; top: 0; width: 800px; } }
@media print {
  @page { size: A4; margin: 14mm 14mm 16mm; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(#elyra-print-report) { display: none !important; }
  #elyra-print-report { position: static !important; display: block !important; }
}
#elyra-print-report { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #111827; background: #fff;
  font-family: var(--font-inter, Inter), -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; }
#elyra-print-report * { box-sizing: border-box; }
.r-doc { width: 100%; }
.r-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 2px solid ${ACCENT}; }
.r-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: 0.22em; font-size: 10pt; }
.r-mark { width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #c4b5fd, ${ACCENT} 70%); display: inline-block; }
.r-header-right { font-size: 8.5pt; color: #6b7280; }
.r-cover { padding: 22px 0 14px; }
.r-kicker { color: ${ACCENT}; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; margin: 0; }
.r-title { font-size: 26pt; line-height: 1.1; margin: 6px 0 4px; font-weight: 700; }
.r-sub { margin: 0; color: #374151; font-size: 11pt; }
.r-meta { margin: 6px 0 0; color: #6b7280; font-size: 9pt; }
.r-kpis { display: grid; grid-template-columns: 1.4fr 1fr 1.2fr; gap: 10px; margin: 6px 0 12px; }
.r-kpi { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; break-inside: avoid; }
.r-kpi-main { background: #f5f3ff; border-color: #ddd6fe; }
.r-label { margin: 0; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; }
.r-big { margin: 4px 0 2px; font-size: 28pt; font-weight: 700; color: ${ACCENT}; line-height: 1; }
.r-big span { font-size: 13pt; color: #6b7280; font-weight: 500; }
.r-small { margin: 4px 0 0; font-size: 9pt; color: #374151; }
.r-prov { margin-top: 6px; }
.r-row { display: flex; justify-content: space-between; gap: 8px; font-size: 9.5pt; }
.r-bar { height: 7px; border-radius: 4px; background: #f3f4f6; margin-top: 3px; overflow: hidden; }
.r-bar > div { height: 100%; border-radius: 4px; }
.r-callout { border-left: 4px solid ${ACCENT}; background: #faf9ff; padding: 10px 14px; margin: 4px 0 14px; font-size: 10.5pt; break-inside: avoid; }
.r-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 10px; break-inside: avoid; }
.r-h2 { font-size: 12.5pt; margin: 14px 0 8px; font-weight: 700; break-after: avoid; }
.r-h3 { font-size: 11.5pt; margin: 14px 0 6px; font-weight: 700; color: ${ACCENT}; break-after: avoid; }
.r-h4 { font-size: 10.5pt; margin: 10px 0 4px; font-weight: 700; break-after: avoid; }
.r-p { margin: 4px 0 8px; }
.r-list { margin: 4px 0 8px; padding-left: 18px; }
.r-list li { margin: 2px 0; }
.r-comp { margin-bottom: 7px; }
.r-you { font-weight: 700; color: ${ACCENT}; }
.r-muted { color: #6b7280; font-size: 9.5pt; }
.r-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.r-table td, .r-table th { padding: 4px 6px; border-bottom: 1px solid #f0f0f3; vertical-align: top; text-align: left; }
.r-table th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; border-bottom: 1px solid #d1d5db; }
.r-table tr { break-inside: avoid; }
.r-overview td:nth-child(2) { width: 42%; }
.r-num { color: #9ca3af; width: 22px; }
.r-right { text-align: right; white-space: nowrap; }
.r-ok { color: #047857; font-weight: 600; white-space: nowrap; }
.r-no { color: #b91c1c; font-weight: 600; white-space: nowrap; }
.r-warn { color: #b45309; font-weight: 600; }
.r-break { break-before: page; }
.r-answer { border-top: 1px solid #e5e7eb; padding: 10px 0 6px; margin-bottom: 4px; }
.r-answer-head { break-after: avoid; }
.r-answer-head { display: flex; gap: 8px; align-items: baseline; }
.r-q { flex: 1; font-weight: 600; }
.r-answer-meta { margin: 3px 0; color: #6b7280; font-size: 8.5pt; }
.r-answer-text { margin: 6px 0 2px; font-size: 9pt; color: #1f2937; }
.r-answer-text .r-h3 { font-size: 10pt; color: #111827; margin: 8px 0 3px; }
.r-answer-text .r-h4 { font-size: 9.5pt; margin: 6px 0 2px; }
.r-answer-text .r-p { margin: 3px 0 5px; }
.r-answer-text .r-list { margin: 2px 0 5px; }
.r-method { margin-top: 16px; break-inside: avoid; }
.r-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af; }
`;

/** Renders the report off-screen and opens the print dialog (→ „Als PDF sichern"). */
export function PrintVisibilityReport({ project, run, history, onDone }: {
  project: ReportProject; run: ReportRun; history: Array<{ created_at: string; summary: Summary }>; onDone: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const prevTitle = document.title;
    document.title = `KI-Sichtbarkeit – ${project.name} – ${new Date(run.created_at).toLocaleDateString("de-DE")}`;
    const finish = () => { document.title = prevTitle; doneRef.current(); };
    window.addEventListener("afterprint", finish, { once: true });
    const t = window.setTimeout(() => window.print(), 400);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", finish); document.title = prevTitle; };
  }, [mounted, project.name, run.created_at]);
  if (!mounted) return null;
  return createPortal(
    <div id="elyra-print-report">
      <style>{CSS}</style>
      <Report project={project} run={run} history={history} />
    </div>,
    document.body,
  );
}
