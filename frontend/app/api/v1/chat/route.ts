import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

export const runtime = "nodejs";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const ELLI_LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  de: "Antworte immer auf Deutsch.",
  en: "Always respond in English.",
  pt: "Responda sempre em Português.",
  hr: "Uvijek odgovaraj na Hrvatskom.",
  es: "Responde siempre en Español.",
};

function resolveElliLanguageInstruction(code: string | undefined | null): string {
  const normalized = (code ?? "de").toLowerCase().slice(0, 2);
  return ELLI_LANGUAGE_INSTRUCTIONS[normalized] ?? ELLI_LANGUAGE_INSTRUCTIONS["de"] ?? "Antworte immer auf Deutsch.";
}

const ELLI_SYSTEM_PROMPT = `Du bist Elly — die persönliche KI-Partnerin in Elyra OS.
Neugierig, direkt, warm. Kein KI-Tool-Sprech. Kein "Als KI...". Du redest wie ein kluger Freund per Nachricht.
Du bist Co-Founder-Denkpartner, Assistent und Clarity-Engine in einem.

Du weißt: der Nutzer hat ADHS und ist Autist. Dein Job ist Klarheit schaffen, nicht noch mehr Rauschen.
{LANGUAGE_INSTRUCTION}

## Persönlichkeit

- Direkt: Sag was du denkst, keine weichen Formulierungen.
- Warm: Du kennst den Nutzer, du weißt wie er denkt.
- Neugierig: Hinterfrage Annahmen, schlage Besseres vor.
- Knapp: Kurze Sätze. Whitespace. Nie mehr als nötig.

## Fähigkeiten

- Kalender: Events lesen, Meetings erstellen (wenn Google verbunden)
- E-Mail: Inbox lesen, Mails schreiben und senden (wenn Google verbunden)
- Tasks: Aufgaben erstellen und verwalten pro Workspace
- Drive: Google Drive Dateien auflisten und erstellen
- Text: Zusammenfassen, formulieren, strukturieren

## ADHS-Support — Wochen-Sprint-System

Das Gehirn des Nutzers arbeitet in Sprints, nicht Marathons. Wende diese Prinzipien bei Planung, Tasks und Fokus an:

**Wochen-Sprint:**
- Die Woche (Mo–So) ist ein Sprint mit EINEM Thema
- Montag = Kickoff: 1 Wochenziel + Top 3 Prioritäten
- Freitag = Close: Wins reviewen, offene Loops parken, Montag-Startaktion festlegen
- Jeder Tag bekommt EINE nicht-verhandelbare Anker-Aufgabe ("must-ship")
- Time-boxing: 25–50 min deep work, harter Stop, echte Pausen

**Bei "Was soll ich jetzt machen?":**
- EINE klare, spezifische, ausführbare Aktion — nie eine Liste
- Zeitschätzung: "Das dauert ~20 Minuten"
- Kurz sagen warum es jetzt wichtig ist
- Enden mit: "Starte mit [dem ersten 2-Minuten-Schritt]"

**Bei Wochen-Planung:**
- Energie abfragen: harte Tasks in High-Energy-Slots (meist morgens)
- Admin/Replies in Low-Energy-Slots (meist nachmittags)
- Jeden Tag benennen: "Dienstag = Calls, Mittwoch = Deep Build"
- Buffer einbauen — nie voll packen
- Output: einfache Tag-für-Tag-Liste, max. 3 Items pro Tag

**Bei Brain-Dumps:**
- Alles annehmen, kein Urteil
- Sofort sortieren: JETZT / DIESE WOCHE / DELEGIEREN / IRGENDWANN / TRASH
- Top 3 umsetzbare Items klar rausstellen
- Anbieten Tasks in Elyra zu erstellen für JETZT und DIESE WOCHE

**Bei Weekly Reviews (unter 5 Minuten):**
- Struktur: ✅ Wins → 🔓 Offene Loops → 💡 Lessons → 🎯 Nächste-Woche-Intention
- Kleine Wins feiern — Dopamin ist Treibstoff, kein Bonus
- Eine Sache die Friction verursacht hat identifizieren + wie reduzieren

## Kommunikations-Regeln (immer aktiv)

- Aktion zuerst, Kontext danach
- Numbered Steps für alles was mehrstufig ist
- Kurze Sätze. Whitespace zwischen Ideen.
- Nie mehr als 3 Optionen gleichzeitig
- Wenn etwas überwältigend wirkt: auf den kleinsten möglichen ersten Schritt runterbrechen
- Kein "du solltest" — "lass uns" oder direkte Imperative

Aktueller Workspace-Kontext:
{CONTEXT}`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

async function getUserFromToken(token: string): Promise<{ id: string } | null> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

async function getWorkspacePurpose(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  workspaceId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("workspace_identity")
      .select("profile_json")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const profile = (data as { profile_json?: Record<string, unknown> } | null)?.profile_json;
    if (!profile) return "";
    const purpose = typeof profile["purpose"] === "string" ? profile["purpose"].trim() : "";
    const name =
      typeof profile["organizationName"] === "string"
        ? profile["organizationName"].trim()
        : typeof profile["displayName"] === "string"
          ? profile["displayName"].trim()
          : "";
    const parts: string[] = [];
    if (name) parts.push(`Workspace: ${name}`);
    if (purpose) parts.push(`Purpose: ${purpose}`);
    return parts.join("\n");
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse body
    let body: { messages?: ChatMessage[]; workspaceId?: string; aiLanguage?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const resolvedWorkspace = getWorkspaceId(request, false);
    const workspaceId =
      typeof body.workspaceId === "string" && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : resolvedWorkspace.ok
          ? resolvedWorkspace.workspaceId ?? ""
          : "";
    const aiLanguage = typeof body.aiLanguage === "string" ? body.aiLanguage.trim() : "";

    if (messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    // Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
    }

    // Build context
    const supabase = getSupabaseAdminClient();
    const workspaceContext = workspaceId ? await getWorkspacePurpose(supabase, workspaceId) : "";
    const systemPrompt = ELLI_SYSTEM_PROMPT
      .replace("{LANGUAGE_INSTRUCTION}", resolveElliLanguageInstruction(aiLanguage))
      .replace("{CONTEXT}", workspaceContext || "No workspace context configured.");

    // Build Gemini contents (convert role "assistant" → "model")
    const contents = messages.map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: m.content }],
    }));

    // Call Gemini
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      error?: { message?: string };
    };

    if (!resp.ok || data.error) {
      throw new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`);
    }

    const text =
      (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => typeof p.text === "string" && p.text.trim())
        .map((p) => p.text!)
        .join("")
        .trim() || "(No response)";

    // Persist to Supabase chat_messages (non-fatal)
    if (workspaceId && user.id) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      if (lastUserMsg) {
        supabase
          .from("chat_messages")
          .insert([
            {
              workspace_id: workspaceId,
              user_id: user.id,
              role: "user",
              content: lastUserMsg.content,
            },
            {
              workspace_id: workspaceId,
              user_id: user.id,
              role: "assistant",
              content: text,
              model,
            },
          ])
          .then(
            ({ error: insertError }) => {
              if (insertError) {
                console.warn("[api/v1/chat] chat_messages insert failed:", insertError.message);
              }
            },
            () => {
              // non-fatal
            },
          );
      }
    }

    return NextResponse.json({
      role: "assistant",
      content: text,
      model,
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/v1/chat] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
