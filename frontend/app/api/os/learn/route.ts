import { NextRequest, NextResponse } from "next/server";
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";

/**
 * POST /api/os/learn — AI helpers for the learning apps (Gitarre, Sprachen).
 *  mode "guitar_plan": weekly practice plan (markdown)
 *  mode "vocab":       vocabulary / phrases for a language, level and topic (JSON)
 *  mode "chat":        conversation practice with corrections (JSON)
 * Falls back to built-in content when Gemini is unavailable.
 */

type HistoryItem = { role: "user" | "assistant"; content: string };

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max).trim() : "");

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")) as T;
  } catch {
    return null;
  }
}

// ── Fallbacks ────────────────────────────────────────────────────────────────

function fallbackGuitarPlan(level: string, minutes: number): string {
  const beginner = !/fortgeschritten|advanced/i.test(level);
  const days = beginner
    ? [
        "Stimmen, Haltung, Em und Am greifen; je 2 Min. sauber anschlagen",
        "C und G lernen; Wechsel Em ↔ G im Metronom bei 60 BPM",
        "D und A; Wechsel Am ↔ C, Abschlag auf jedem Schlag",
        "Vier Akkorde: G – Em – C – D, 4 Schläge pro Akkord bei 60 BPM",
        "Tab üben: „Ode an die Freude“ langsam, dann mit Metronom",
        "Schlagmuster ab-ab-auf-auf-ab-auf über G – Em – C – D",
        "Wiederholung: Lieblingswechsel auf 70–80 BPM steigern",
      ]
    : [
        "Barré F und Hm: je 5 Min. sauber, dann Wechsel C ↔ F",
        "Pentatonik Am, 1. Lage, zum Metronom in Achteln",
        "Septakkorde: E7, A7, D7, G7 – Blues-Schema in A",
        "Tabs: eine eingefügte Melodie Takt für Takt, Tempo +5 BPM",
        "Fingerpicking-Muster (Daumen Bass, dann G-H-e) über Am – C – G",
        "Barré-Wechsel F – G – Am mit 80 BPM",
        "Freies Spielen: Lieblingssong mit eigenem Schlagmuster",
      ];
  return (
    `### Übungsplan (${minutes} Min. pro Tag)\n\n` +
    days.map((d, i) => `${i + 1}. **Tag ${i + 1}:** ${d}`).join("\n") +
    `\n\n*Tipp: Jeden Tag 2 Min. stimmen und 3 Min. aufwärmen. Lieber kurz und täglich als lang und selten.*`
  );
}

type VocabItem = { term: string; translation: string; example: string; exampleTranslation: string; pronunciation?: string };

const FALLBACK_VOCAB: Record<string, VocabItem[]> = {
  Portugiesisch: [
    { term: "Olá", translation: "Hallo", example: "Olá, tudo bem?", exampleTranslation: "Hallo, alles gut?" },
    { term: "Obrigado / Obrigada", translation: "Danke", example: "Muito obrigado pela ajuda.", exampleTranslation: "Vielen Dank für die Hilfe." },
    { term: "Por favor", translation: "Bitte", example: "Um café, por favor.", exampleTranslation: "Einen Kaffee, bitte." },
    { term: "Desculpe", translation: "Entschuldigung", example: "Desculpe, onde fica a estação?", exampleTranslation: "Entschuldigung, wo ist der Bahnhof?" },
    { term: "Quanto custa?", translation: "Wie viel kostet das?", example: "Quanto custa este bilhete?", exampleTranslation: "Wie viel kostet dieses Ticket?" },
    { term: "Não percebo", translation: "Ich verstehe nicht", example: "Desculpe, não percebo.", exampleTranslation: "Entschuldigung, ich verstehe nicht." },
  ],
  Englisch: [
    { term: "Nice to meet you", translation: "Freut mich", example: "Hi, I'm Paul – nice to meet you.", exampleTranslation: "Hi, ich bin Paul – freut mich." },
    { term: "Could you repeat that?", translation: "Könnten Sie das wiederholen?", example: "Sorry, could you repeat that?", exampleTranslation: "Entschuldigung, könnten Sie das wiederholen?" },
    { term: "deadline", translation: "Frist", example: "The deadline is on Friday.", exampleTranslation: "Die Frist ist am Freitag." },
    { term: "to follow up", translation: "nachfassen", example: "I'll follow up by email.", exampleTranslation: "Ich melde mich per E-Mail nochmal." },
  ],
  Kroatisch: [
    { term: "Bok", translation: "Hallo / Tschüss", example: "Bok, kako si?", exampleTranslation: "Hallo, wie geht's dir?" },
    { term: "Hvala", translation: "Danke", example: "Hvala lijepa!", exampleTranslation: "Vielen Dank!" },
    { term: "Molim", translation: "Bitte", example: "Kavu, molim.", exampleTranslation: "Einen Kaffee, bitte." },
    { term: "Koliko košta?", translation: "Wie viel kostet das?", example: "Koliko košta karta?", exampleTranslation: "Wie viel kostet die Karte?" },
  ],
  Spanisch: [
    { term: "Hola", translation: "Hallo", example: "Hola, ¿qué tal?", exampleTranslation: "Hallo, wie geht's?" },
    { term: "Gracias", translation: "Danke", example: "Muchas gracias.", exampleTranslation: "Vielen Dank." },
    { term: "¿Dónde está…?", translation: "Wo ist …?", example: "¿Dónde está el baño?", exampleTranslation: "Wo ist die Toilette?" },
    { term: "La cuenta, por favor", translation: "Die Rechnung, bitte", example: "Perdone, la cuenta, por favor.", exampleTranslation: "Entschuldigung, die Rechnung bitte." },
  ],
};

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = clean(body?.mode, 20);

  if (mode === "guitar_plan") {
    const level = clean(body?.level, 40) || "Anfänger";
    const goal = clean(body?.goal, 300);
    const minutes = Math.max(5, Math.min(120, Number(body?.minutes) || 20));
    if (geminiConfigured()) {
      try {
        const { text, model } = await callGeminiText({
          system: `Du bist Elly, eine geduldige Gitarrenlehrerin. Erstelle auf Deutsch in Markdown einen 7-Tage-Übungsplan.
Format: "### Übungsplan" + nummerierte Liste "**Tag N:** …" + "### Tipps" (2–3 Punkte).
Nutze Akkorde, Metronom-Tempi (BPM) und Schlagmuster. Song-Vorschläge nur mit Titel nennen.
WICHTIG: Schreibe KEINE Liedtexte und KEINE Tabs/Noten urheberrechtlich geschützter Songs. Nur Volkslieder/Klassik (gemeinfrei) dürfen als Beispiel ausgeschrieben werden.`,
          prompt: `Niveau: ${level}\nZiel: ${goal || "Lieder begleiten können"}\nZeit pro Tag: ${minutes} Minuten`,
          temperature: 0.5,
          timeoutMs: 25_000,
        });
        if (text.trim()) return NextResponse.json({ markdown: text.trim(), source: "model", model });
      } catch {
        /* fall through */
      }
    }
    return NextResponse.json({ markdown: fallbackGuitarPlan(level, minutes), source: "rules" });
  }

  if (mode === "vocab") {
    const language = clean(body?.language, 40) || "Portugiesisch";
    const level = clean(body?.level, 10) || "A1";
    const topic = clean(body?.topic, 80) || "Alltag";
    const count = Math.max(5, Math.min(20, Number(body?.count) || 12));
    if (geminiConfigured()) {
      try {
        const { text, model } = await callGeminiText({
          system: `Du bist eine Sprachlehrerin. Erzeuge Lernwortschatz für deutschsprachige Lernende.
Antworte NUR als JSON: {"items":[{"term":string,"translation":string,"example":string,"exampleTranslation":string,"pronunciation":string}]}
- "term" und "example" in der Zielsprache (in ihrer üblichen Schrift), "translation" und "exampleTranslation" auf Deutsch.
- "pronunciation": einfache Lautschrift für Deutschsprachige (bei nicht-lateinischer Schrift zusätzlich Umschrift).
- Passend zum Niveau (GER) und Thema, alltagstauglich, keine Wiederholungen.`,
          prompt: `Zielsprache: ${language}\nNiveau: ${level}\nThema: ${topic}\nAnzahl: ${count}`,
          json: true,
          temperature: 0.6,
          timeoutMs: 30_000,
        });
        const parsed = parseJson<{ items?: VocabItem[] }>(text);
        const items = (parsed?.items ?? []).filter((i) => i && i.term && i.translation).slice(0, count);
        if (items.length) return NextResponse.json({ items, source: "model", model });
      } catch {
        /* fall through */
      }
    }
    const fbKey = Object.keys(FALLBACK_VOCAB).find((k) => language.startsWith(k));
    const items = fbKey ? FALLBACK_VOCAB[fbKey]! : FALLBACK_VOCAB.Englisch!;
    return NextResponse.json({
      items,
      source: "rules",
      note: fbKey ? "Offline-Grundwortschatz – Elly ist gerade nicht erreichbar." : "Offline-Beispiel (Englisch) – Elly ist gerade nicht erreichbar.",
    });
  }

  if (mode === "chat") {
    const language = clean(body?.language, 40) || "Portugiesisch";
    const level = clean(body?.level, 10) || "A1";
    const start = body?.start === true;
    const topic = clean(body?.topic, 80) || "Alltag";
    const message = start
      ? `[Start] Beginne das Gespräch zum Thema "${topic}" mit einer kurzen Begrüßung und einer einfachen Frage. Keine Korrektur.`
      : clean(body?.message, 1000);
    const history = (Array.isArray(body?.history) ? (body!.history as HistoryItem[]) : [])
      .slice(-10)
      .map((h) => `${h.role === "user" ? "Lernender" : "Elly"}: ${clean(h.content, 600)}`)
      .join("\n");
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
    if (!geminiConfigured()) {
      return NextResponse.json({ reply: "Die KI ist gerade nicht verbunden – Gesprächsübung braucht Gemini.", correction: "", translation: "", source: "rules" });
    }
    try {
      const { text, model } = await callGeminiText({
        system: `Du bist Elly, eine freundliche Gesprächspartnerin zum Sprachenlernen. Zielsprache: ${language}, Niveau ${level} (GER).
Führe ein natürliches Gespräch in der Zielsprache, passend zum Niveau (kurze Sätze bei A1/A2), und stelle am Ende eine Rückfrage.
Antworte NUR als JSON: {"reply": string (Zielsprache), "translation": string (Deutsch, Übersetzung deiner Antwort), "correction": string (Deutsch: kurze, freundliche Korrektur der letzten Nachricht des Lernenden mit korrekter Version – leer, wenn alles richtig war)}`,
        prompt: `${history ? `Bisheriges Gespräch:\n${history}\n\n` : ""}Neue Nachricht des Lernenden: ${message}`,
        json: true,
        temperature: 0.7,
        timeoutMs: 25_000,
      });
      const parsed = parseJson<{ reply?: string; translation?: string; correction?: string }>(text);
      if (parsed?.reply) return NextResponse.json({ reply: parsed.reply, translation: parsed.translation ?? "", correction: start ? "" : parsed.correction ?? "", source: "model", model });
    } catch {
      /* fall through */
    }
    return NextResponse.json({ reply: "", translation: "", correction: "", error: "Elly ist gerade überlastet – versuch es gleich nochmal." }, { status: 503 });
  }

  return NextResponse.json({ error: "unknown mode" }, { status: 400 });
}
