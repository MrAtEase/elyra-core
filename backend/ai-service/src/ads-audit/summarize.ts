import { callModel } from "../models/router.js";
import { logger } from "../lib/logger.js";
import type { AuditReport } from "./analyze.js";

export type AuditSummary = {
  markdown: string;
  headlines: string[];
  source: "model" | "rules";
  model?: string;
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Regelbasierte Zusammenfassung, wenn kein Modell erreichbar ist. */
function fallbackSummary(report: AuditReport, account: string): AuditSummary {
  const share = report.totals.cost > 0 ? (report.wastedCost / report.totals.cost) * 100 : 0;
  const top = report.negativeTokens.slice(0, 3).map((t) => `„${t.token}“`).join(", ");
  const lines = [
    "### Fazit",
    `Im Konto ${account} entfielen ${eur(report.wastedCost)} von ${eur(report.totals.cost)} ` +
      `(${share.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %) auf Suchbegriffe ohne Conversion.`,
    top ? `Die größten Kostentreiber sind Suchanfragen mit ${top}.` : "",
    report.hourAnomalies.length
      ? `Auffällig: viele Klicks, aber kaum Conversions (${report.hourAnomalies.map((h) => `${h.hour}–${h.hour + 1}`).join(", ")} Uhr) – möglicher ungültiger Traffic.`
      : "",
    "\n### Nächste Schritte",
    `1. ${report.proposals.length} Vorschläge prüfen und freigeben.`,
    "2. Freigegebene Ausschlüsse per Google Ads Editor importieren.",
    "3. In zwei Wochen erneut auswerten.",
  ];
  return { markdown: lines.filter((l) => l !== "").join("\n"), headlines: [], source: "rules" };
}

/**
 * Kundenbericht + Anzeigentitel. Das Modell bekommt nur berechnete Fakten
 * und darf keine eigenen Zahlen erfinden.
 */
export async function summarizeAudit(report: AuditReport, account: string): Promise<AuditSummary> {
  const facts = {
    account,
    totals: report.totals,
    wastedCost: report.wastedCost,
    topNegativeWords: report.negativeTokens.slice(0, 6).map((t) => ({ word: t.token, cost: t.cost })),
    expensiveTerms: report.expensive.slice(0, 3).map((e) => ({ term: e.term, cpa: e.cpa })),
    suspiciousHours: report.hourAnomalies.map((h) => ({ hour: h.hour, clicks: h.clicks, conversions: h.conversions })),
    proposalCount: report.proposals.length,
    bestConvertingTerms: [...report.topConverting].slice(0, 5),
  };

  try {
    const response = await callModel(
      `Du bist Elly, Senior-SEA-Beraterin einer deutschen Performance-Agentur.
Du bekommst berechnete Fakten (JSON) aus einem Google-Ads-Suchbegriff-Audit.
Antworte NUR mit JSON in dieser Form: {"markdown": string, "headlines": string[]}.
"markdown": Deutsch, ohne Tabellen: "### Fazit" (2–3 Sätze), "### Empfehlungen" (genau 3 nummerierte Punkte
mit Bezug auf die Zahlen), "### Nächste Schritte" (2 Punkte).
"headlines": genau 5 neue Anzeigentitel für Responsive Search Ads, jeweils höchstens 30 Zeichen,
passend zu "bestConvertingTerms".
Regeln: Verwende NUR Zahlen aus dem JSON. Erfinde keine Zahlen. Auffällige Stunden nur als
"möglicher ungültiger Traffic" bezeichnen, nie als bewiesenen Betrug.`,
      JSON.stringify(facts),
    );
    const raw = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw) as { markdown?: unknown; headlines?: unknown };
    const markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
    const headlines = Array.isArray(parsed.headlines)
      ? parsed.headlines.filter((h): h is string => typeof h === "string").map((h) => h.trim()).filter((h) => h.length > 0 && h.length <= 30).slice(0, 5)
      : [];
    if (markdown) return { markdown, headlines, source: "model", model: response.model };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "ads-audit: model unavailable or invalid JSON, using rule-based summary");
  }
  return fallbackSummary(report, account);
}
