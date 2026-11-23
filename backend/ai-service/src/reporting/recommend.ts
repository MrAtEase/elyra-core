import { callModel } from "../models/router.js";
import { logger } from "../lib/logger.js";
import { SAMPLE_ACCOUNT } from "./sample-campaigns.js";
import { fallbackRecommendations, type AnalysisResult } from "./analyze.js";

/**
 * Strategic recommendations on top of deterministic KPIs.
 * The model only sees computed numbers and is told not to invent new ones.
 */
export async function generateRecommendations(
  result: AnalysisResult,
  targetRoas: number,
  focus = "",
): Promise<{ markdown: string; source: "model" | "rules"; model?: string }> {
  try {
    const response = await callModel(
      `Du bist Elly, KI-Analystin für Performance-Marketing in einer Agentur.
Du bekommst bereits berechnete Kennzahlen (JSON) eines Kundenkontos.
Schreibe auf Deutsch, in Markdown, ohne Tabellen:
"### Fazit" (2–3 Sätze), dann "### Handlungsempfehlungen" mit genau 3 nummerierten, konkreten Maßnahmen
(jeweils: was, warum mit Bezug auf die Zahlen, erwarteter Effekt), dann "### Nächste Schritte" (2 kurze Punkte).
Regeln: Verwende NUR Zahlen aus dem JSON, erfinde keine neuen Zahlen. Eine Umsatzschätzung aus "budgetShift"
immer als grobe Schätzung kennzeichnen. Awareness-Kampagnen nicht allein nach ROAS bewerten. Keine Einleitung.`,
      JSON.stringify({
        client: SAMPLE_ACCOUNT.client,
        period: SAMPLE_ACCOUNT.period,
        previousPeriod: SAMPLE_ACCOUNT.previousPeriod,
        targetRoas,
        userFocus: focus || null,
        ...result,
      }),
    );
    const markdown = response.text.trim();
    if (markdown) return { markdown, source: "model", model: response.model };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "reporting: model unavailable, using rule-based recommendations");
  }
  return { markdown: fallbackRecommendations(result), source: "rules" };
}
