// ─── Inline utilities (avoids an external render dependency) ───────────────
function stripDebugMarkers(text: string): string {
  return text
    .replace(/<debug>[\s\S]*?<\/debug>/gi, "")
    .replace(/\[DEBUG:[^\]]*\]/gi, "")
    .trim();
}

function detectFallbackMode(raw: string): boolean {
  return raw.includes("[FALLBACK]") || raw.includes("<fallback>");
}

export type ComposeIntentId =
  | "compose_draft"
  | "shorten"
  | "tone_friendly"
  | "tone_professional"
  | "polish";

export type ComposeIntent = {
  id: ComposeIntentId;
  label: string;
  description: string;
  prompt: string;
};

export const COMPOSE_INTENTS: ComposeIntent[] = [
  {
    id: "compose_draft",
    label: "Entwurf schreiben",
    description: "Einen neuen Betreff+Text vorschlagen",
    prompt:
      "Schreibe eine neue E-Mail in klarem, professionellem Deutsch. Lege einen prägnanten Betreff fest und verfasse dazu 2–4 kurze Absätze. Antworte im Format:\nSubject: <Betreff>\n\nBody:\n<Nachricht>. Keine Einleitungen wie „Gerne helfe ich dir“…",
  },
  {
    id: "shorten",
    label: "Kürzer machen",
    description: "Den Text straffen, ohne Inhalte zu verlieren",
    prompt:
      "Kürze die vorhandene Nachricht (Messagetext) und behalte dabei alle wichtigen Informationen. Liefern nur den überarbeiteten Text, maximal zwei Absätze, ohne zusätzliche Erklärungen.",
  },
  {
    id: "tone_friendly",
    label: "Freundlicher Ton",
    description: "Ton wärmer, einladender gestalten",
    prompt:
      "Passe die Nachricht in einen freundlichen, zuvorkommenden Ton an, ohne die Fakten zu verändern. Gib nur den neuen Nachrichtentext zurück.",
  },
  {
    id: "tone_professional",
    label: "Professioneller Ton",
    description: "Sachlich, bestimmt und klar formulieren",
    prompt:
      "Formuliere die Nachricht sachlich-professionell, klar und auf den Punkt, ohne informelle Floskeln. Gib nur den überarbeiteten Text ohne Einleitung zurück.",
  },
  {
    id: "polish",
    label: "Grammatik verbessern",
    description: "Stil & Grammatik polieren",
    prompt:
      "Poliere Grammatik und Stil der Nachricht, ohne Inhalt oder Ton zu verändern. Antworte mit dem vollständigen, fehlerfreien Text.",
  },
];

export const COMPOSE_SYSTEM_PROMPT = `Du bist Elli, eine KI-Assistentin. Du befindest dich im Operator-Modus, um beim Verfassen einer E-Mail zu helfen.
Deine Prinzipien sind:
- Du sprichst in der ersten Person ("Ich schlage vor...").
- Dein Ton ist professionell, ruhig und präzise.
- Du gibst nur das Ergebnis zurück, ohne einleitende Füllsätze wie "Hier ist der Entwurf".
- Wenn du einen Betreff und einen Text erstellst, nutze das Format: "Subject: [Betreff]\\n\\nBody:\\n[Text]". Ansonsten gib nur den reinen Text zurück.`;

export type ComposeElliResult = {
  raw: string;
  sanitized: string;
  subject?: string;
  body: string;
  fallback: boolean;
};

const extractSubjectAndBody = (text: string) => {
  const normalized = text.trim();
  let subject: string | undefined;
  let remainder = normalized;

  const subjectMatch = normalized.match(/Subject:\s*(.*)/i);
  if (subjectMatch) {
    const parsedSubject = subjectMatch[1] ?? "";
    subject = parsedSubject.trim();
    const afterSubjectIndex = (subjectMatch.index ?? 0) + (subjectMatch[0] ?? "").length;
    remainder = normalized.slice(afterSubjectIndex).trim();
  }

  const bodyMatch = remainder.match(/(?:Body|Nachricht):\s*([\s\S]*)/i);
  if (bodyMatch) {
    const matchedBody = bodyMatch[1] ?? "";
    remainder = matchedBody.trim();
  }

  return {
    subject,
    body: remainder,
  };
};

export const parseComposeElliResult = (raw: string): ComposeElliResult => {
  const sanitized = stripDebugMarkers(raw);
  const { subject, body } = extractSubjectAndBody(sanitized);
  const result: ComposeElliResult = {
    raw,
    sanitized,
    body: body || sanitized,
    fallback: detectFallbackMode(raw),
  };
  if (subject) {
    result.subject = subject;
  }
  return result;
};

export const buildComposePrompt = (params: {
  actionId: ComposeIntentId;
  recipients: string;
  subject: string;
  body: string;
  instruction: string;
}): string => {
  const contextBlocks: string[] = [];
  if (params.recipients.trim()) {
    contextBlocks.push(`Empfänger: ${params.recipients}`);
  }
  if (params.subject.trim()) {
    contextBlocks.push(`Aktueller Betreff: ${params.subject}`);
  }
  if (params.body.trim()) {
    contextBlocks.push(`Aktuelle Nachricht:\n${params.body}`);
  }
  const intent = COMPOSE_INTENTS.find((entry) => entry.id === params.actionId) ?? COMPOSE_INTENTS[0];
  const segments = [
    ...contextBlocks,
    intent?.prompt ?? "",
    params.instruction.trim() ? `Zusatzanweisung: ${params.instruction.trim()}` : "",
  ].filter(Boolean);
  return segments.join("\n\n");
};