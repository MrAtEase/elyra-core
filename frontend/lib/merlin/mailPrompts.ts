import type { MailThread } from "@/components/workspace/mail/mailTypes";
import type { MerlinIntentId } from "@/lib/merlin/intents";

const formatThreadContext = (thread: MailThread | null) => {
  if (!thread) {
    return "";
  }
  const lines: string[] = [];
  if (thread.subject) {
    lines.push(`Betreff: ${thread.subject}`);
  }
  const participants = thread.participants?.filter(Boolean).join(", ");
  if (participants) {
    lines.push(`Teilnehmer: ${participants}`);
  }
  const latestMessage = thread.messages?.[thread.messages.length - 1];
  const appendix = latestMessage?.textPlain ?? latestMessage?.snippet;
  if (appendix) {
    lines.push(`Letzte Nachricht: ${appendix}`);
  }
  return lines.join("\n");
};

const COMMON_PROMPT_RULES =
  "Regeln:\n" +
  "- Keine Meta-Texte wie \"Als KI ...\" oder \"Hier ist ...\".\n" +
  "- Keine Überschriften in GROSSBUCHSTABEN.\n" +
  "- Kurz und direkt verwendbar bleiben.";

const summarizeTemplate =
  "Fasse diese E-Mail in 4–6 klaren Stichpunkten zusammen. Beginne mit dem Zweck/Anliegen. Nenne konkrete Zahlen/Deadlines/Requests. Keine Floskeln, keine Einleitung.\n\n" +
  COMMON_PROMPT_RULES;

const draftTemplate =
  "Schreibe eine professionelle Antwort auf Deutsch. Ton: freundlich, klar, lösungsorientiert. 2–5 kurze Absätze. Wenn Informationen fehlen, stelle am Ende 1–3 konkrete Rückfragen. Keine Emojis.\n\n" +
  COMMON_PROMPT_RULES;

const extractTemplate =
  "Extrahiere Aufgaben aus der E-Mail. Gib eine Liste mit: Aufgabe, Owner (falls ableitbar), Due Date (falls genannt), Priorität (hoch/mittel/niedrig). Wenn unklar, markiere 'unklar'.\n\n" +
  COMMON_PROMPT_RULES;

export const buildMailPrompt = (
  intentId: MerlinIntentId,
  thread: MailThread | null,
  userInput?: string
): string => {
  const context = formatThreadContext(thread);
  const hint = userInput?.trim();
  const instructions = (() => {
    switch (intentId) {
      case "summarize_mail":
        return summarizeTemplate;
      case "draft_reply":
        return draftTemplate;
      case "extract_tasks":
        return extractTemplate;
      default:
        return "";
    }
  })();
  const segments = [
    context,
    instructions,
    hint ? `Zusatzanweisung: ${hint}` : "",
  ].filter(Boolean);
  return segments.join("\n\n").trim();
};
