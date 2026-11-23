import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { executeTool } from "../tools/registry.js";
import { analyzeCampaigns } from "../reporting/analyze.js";
import { SAMPLE_ACCOUNT, SAMPLE_CAMPAIGNS } from "../reporting/sample-campaigns.js";
import { searchLeads } from "../routes/leads.js";

/**
 * Werkzeuge der Agenten. Alle sind LESEND – kein Agent sendet Mails, legt Termine an
 * oder ändert Werbekonten. Ergebnisse gehen als Fakten an das Modell.
 */

export type ToolContext = { task: string; brief: string; workspaceId: string | null };

/** Reporting-Agent: Kennzahlen aus der Reporting-App (Beispieldaten), deterministisch berechnet. */
export async function reportingFacts(): Promise<string> {
  const analysis = analyzeCampaigns(SAMPLE_CAMPAIGNS, SAMPLE_ACCOUNT.targetRoas);
  return JSON.stringify({
    hinweis: "Beispieldaten der Reporting-App (fiktiv) – Kennzahlen im Code berechnet",
    konto: SAMPLE_ACCOUNT,
    gesamt: analysis.totals,
    kanaele: analysis.channels,
    kampagnen: analysis.campaigns.map((c) => ({ kanal: c.channel, kampagne: c.campaign, spend: c.spend, roas: c.roas, cpa: c.cpa, roasAenderungPct: c.roasChangePct, flags: c.flags })),
    budgetVerschiebung: analysis.budgetShift,
  });
}

/** Lead-Agent: bewertete Leads aus der Leads-App (fiktive Beispieldaten). */
export async function leadFacts(ctx: ToolContext): Promise<string> {
  const text = `${ctx.task} ${ctx.brief}`.toLowerCase();
  const industry = text.includes("zahn") ? "Zahnarztpraxis" : text.includes("elektr") ? "Elektrobetrieb" : text.includes("physio") ? "Physiotherapie" : undefined;
  const region = ["stuttgart", "münchen", "hamburg"].find((r) => text.includes(r));
  const leads = searchLeads({ ...(industry ? { industry } : {}), ...(region ? { region: region[0]!.toUpperCase() + region.slice(1) } : {}) }).slice(0, 8);
  return JSON.stringify({
    hinweis: "Fiktive Beispieldaten der Leads-App – Scoring regelbasiert im Code",
    leads: leads.map((l) => ({ firma: l.company, branche: l.industry, stadt: l.city, score: l.score, stufe: l.tier, gruende: l.reasons.slice(0, 3), ansatz: l.opportunities.slice(0, 2) })),
  });
}

/** Mail-&-Termine-Agent: Posteingang und Kalender der nächsten 7 Tage LESEN (Google). */
export async function mailCalendarFacts(ctx: ToolContext): Promise<string> {
  if (!ctx.workspaceId) return JSON.stringify({ hinweis: "Kein Workspace-Zugriff – Mails und Termine konnten nicht gelesen werden." });
  const [mail, cal] = await Promise.allSettled([
    executeTool("gmail.list", { query: "is:inbox newer_than:7d", maxResults: 12 }, ctx.workspaceId),
    executeTool("calendar.list", {}, ctx.workspaceId),
  ]);
  const pick = (r: PromiseSettledResult<Record<string, unknown>>, key: string) =>
    r.status === "fulfilled" ? (r.value["connected"] === false ? { nichtVerbunden: r.value["text"] } : r.value[key] ?? []) : { fehler: (r.reason as Error).message };
  return JSON.stringify({
    hinweis: "Gelesen aus Google (nur lesend). Der Agent sendet nichts und legt keine Termine an.",
    mails: pick(mail, "emails"),
    termineNaechste7Tage: pick(cal, "events"),
    jetzt: new Date().toISOString(),
  });
}

type GroundingChunk = { web?: { uri?: string; title?: string } };
type GeminiSearchResult = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: { groundingChunks?: GroundingChunk[] } }>;
  error?: { message?: string };
};

/** Recherche-Agent: Gemini mit Google-Suche (Grounding). Quellen kommen aus den Metadaten, nicht vom Modell. */
export async function callGeminiWithSearch(system: string, user: string): Promise<{ text: string; model: string }> {
  const { GEMINI_API_KEY, GEMINI_MODEL } = config();
  if (!GEMINI_API_KEY) throw new Error("No AI model providers configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
    const data = (await resp.json().catch(() => ({}))) as GeminiSearchResult;
    if (!resp.ok || data.error) throw new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`);
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
      .flatMap((c) => (c.web?.uri ? [{ uri: c.web.uri, title: c.web.title ?? c.web.uri }] : []))
      .filter((s, i, arr) => arr.findIndex((x) => x.uri === s.uri) === i)
      .slice(0, 12);
    const list = sources.length
      ? `\n\n### Quellen\n${sources.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]]/g, "")}](${s.uri})`).join("\n")}`
      : "\n\n_Hinweis: Die Suche hat keine Quellen zurückgegeben – Aussagen bitte selbst prüfen._";
    return { text: `${text}${list}`, model: `${GEMINI_MODEL} + Google-Suche` };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "agent-team: gemini search failed");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
