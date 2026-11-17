import { callModel } from "../models/router.js";
import { logger } from "../lib/logger.js";
import type { SampleLead } from "./sample-leads.js";
import type { LeadScore } from "./score.js";

export type OutreachDraft = { subject: string; body: string; source: "model" | "template"; model?: string };

export type SenderProfile = { name: string; company: string; offer: string };

export const DEFAULT_SENDER: SenderProfile = {
  name: "Paul Odak",
  company: "Elyra (Demo)",
  offer: "lokale Google-Ads- und Landingpage-Kampagnen für KMU",
};

function templateDraft(lead: SampleLead, score: LeadScore, sender: SenderProfile): OutreachDraft {
  const hook = score.reasons[0] ?? "Ihr Betrieb";
  const idea = score.opportunities[0] ?? "mehr Anfragen über Google";
  return {
    subject: `${lead.company.replace(" (fiktiv)", "")}: kurze Idee für mehr Anfragen`,
    body:
      `Guten Tag,\n\n` +
      `mir ist aufgefallen: ${hook}. Das ist eine gute Ausgangslage – viele Betriebe in ${lead.city} ` +
      `holen genau dort mit ${idea} zusätzliche Anfragen.\n\n` +
      `Ich helfe Unternehmen wie Ihrem mit ${sender.offer}. Hätten Sie nächste Woche 15 Minuten ` +
      `für einen kurzen Austausch? Ich bringe zwei konkrete Vorschläge mit.\n\n` +
      `Viele Grüße\n${sender.name}\n${sender.company}`,
    source: "template",
  };
}

/** Personalised first-touch email. The model gets only the facts we have. */
export async function draftOutreach(
  lead: SampleLead,
  score: LeadScore,
  sender: SenderProfile = DEFAULT_SENDER,
): Promise<OutreachDraft> {
  try {
    const response = await callModel(
      `Du schreibst eine kurze, persönliche B2B-Erstansprache per E-Mail auf Deutsch (Sie-Form).
Regeln: max. 110 Wörter, kein Marketing-Sprech, keine Superlative, keine erfundenen Fakten oder Zahlen.
Beziehe dich auf genau EINE konkrete Beobachtung aus "reasons" und schlage EINE Idee aus "opportunities" vor.
Ende mit einer einfachen Frage nach 15 Minuten Austausch. Signatur mit Name und Firma des Absenders.
Antworte ausschließlich als JSON: {"subject": string, "body": string}`,
      JSON.stringify({ lead, reasons: score.reasons, opportunities: score.opportunities, sender }),
      { json: true },
    );
    const raw = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject === "string" && typeof parsed.body === "string" && parsed.body.length > 40) {
      return { subject: parsed.subject, body: parsed.body, source: "model", model: response.model };
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "leads: model unavailable, using template draft");
  }
  return templateDraft(lead, score, sender);
}
