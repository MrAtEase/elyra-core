/**
 * Elyra "Werkzeuge" – server-side runners for the tool apps that have no window of their own
 * (Elly, Recherche, Übersetzen, Wetter, Tagesplanung, Company Builder).
 *
 * Every action returns Markdown plus optional sources, so one window can show all of them.
 */
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";
import { listTasks } from "@/lib/tasks/taskStore";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAiSettingsCached } from "@/lib/admin/controlCenter";

export type ToolAppId = "elli" | "research" | "translate" | "weather" | "daily_planner" | "company_builder";

export type ToolRunInput = {
  workspaceId: string;
  tool: ToolAppId;
  action: string;
  fields: Record<string, string>;
};

export type ToolRunResult = {
  markdown: string;
  sources?: Array<{ title: string; uri: string }>;
  model?: string;
};

export class ToolRunError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const today = () =>
  new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date());

function field(fields: Record<string, string>, key: string, label: string, required = true): string {
  const value = (fields[key] ?? "").trim();
  if (required && !value) throw new ToolRunError(`Bitte „${label}“ ausfüllen.`);
  return value.slice(0, 12000);
}

async function workspaceContext(workspaceId: string): Promise<{ name: string; kind: string; profile: string }> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "Workspace";
    const kind = typeof row.kind === "string" ? row.kind : typeof row.type === "string" ? row.type : "workspace";
    const description = typeof row.description === "string" ? row.description : "";
    const profile = description.slice(0, 2000);
    return { name, kind, profile };
  } catch {
    return { name: "Workspace", kind: "workspace", profile: "" };
  }
}

async function openTasksText(workspaceId: string): Promise<string> {
  try {
    const tasks = (await listTasks(workspaceId)).filter((t) => t.status === "open" || t.status === "in_progress").slice(0, 30);
    if (tasks.length === 0) return "Keine offenen Aufgaben in Elyra.";
    return tasks
      .map((t) => `- ${t.title}${t.due_at ? ` (fällig ${t.due_at.slice(0, 10)})` : ""}${t.status === "in_progress" ? " [in Arbeit]" : ""}`)
      .join("\n");
  } catch {
    return "Aufgaben konnten nicht geladen werden.";
  }
}

let currentWorkspaceId = "";

async function llm(system: string, prompt: string, opts?: { search?: boolean; maxOutputTokens?: number }): Promise<ToolRunResult> {
  if (!geminiConfigured()) throw new ToolRunError("Kein KI-Modell konfiguriert (GEMINI_API_KEY fehlt in .env.local).", 503);
  const ai = currentWorkspaceId ? await getAiSettingsCached(currentWorkspaceId).catch(() => null) : null;
  if (opts?.search && ai && !ai.webResearch) opts = { ...opts, search: false };
  const call = (search: boolean) =>
    callGeminiText({
      system: `${system}\nAntworte in sauberem Markdown (Überschriften mit ##, Listen mit -, **fett** für Schlüsselbegriffe). Keine Einleitungsfloskeln. Heute ist ${today()}.`,
      prompt,
      temperature: search ? 0.2 : ai?.temperature ?? 0.5,
      preferredModel: ai?.model ?? null,
      maxOutputTokens: opts?.maxOutputTokens ?? 4096,
      timeoutMs: search ? 60_000 : 45_000,
      ...(search ? { googleSearch: true } : {}),
    });
  let note = "";
  let res: Awaited<ReturnType<typeof callGeminiText>>;
  if (opts?.search) {
    try {
      res = await call(true);
    } catch (error) {
      console.warn("[toolApps] Google-Suche fehlgeschlagen, antworte ohne Live-Recherche:", error instanceof Error ? error.message : error);
      res = await call(false);
      const msg = error instanceof Error ? error.message : "";
      note = /quota|RESOURCE_EXHAUSTED|429/i.test(msg)
        ? "\n\n> **Hinweis:** Das Kontingent für die Google-Suche im Gemini-API-Schlüssel ist aufgebraucht (in Google AI Studio die Abrechnung aktivieren). Antwort ohne Live-Recherche – Zahlen bitte prüfen."
        : "\n\n> **Hinweis:** Die Google-Suche war gerade nicht verfügbar – Antwort ohne Live-Recherche. Zahlen bitte prüfen.";
    }
  } else {
    res = await call(false);
  }
  const markdown = res.text.trim();
  if (!markdown) throw new ToolRunError("Das Modell hat keine Antwort geliefert. Bitte nochmal versuchen.", 502);
  return { markdown: markdown + note, model: res.model + (opts?.search && !note ? " + Google-Suche" : ""), ...(res.sources.length ? { sources: res.sources } : {}) };
}

// ── Weather (Open-Meteo, no API key) ────────────────────────────────────────

const WEATHER_CODES: Record<number, string> = {
  0: "☀️ klar", 1: "🌤️ überwiegend klar", 2: "⛅ teils bewölkt", 3: "☁️ bedeckt", 45: "🌫️ Nebel", 48: "🌫️ Reifnebel",
  51: "🌦️ leichter Niesel", 53: "🌦️ Niesel", 55: "🌧️ starker Niesel", 61: "🌧️ leichter Regen", 63: "🌧️ Regen", 65: "🌧️ starker Regen",
  71: "🌨️ leichter Schnee", 73: "🌨️ Schnee", 75: "❄️ starker Schnee", 80: "🌦️ Schauer", 81: "🌧️ kräftige Schauer", 82: "⛈️ heftige Schauer",
  95: "⛈️ Gewitter", 96: "⛈️ Gewitter mit Hagel", 99: "⛈️ schweres Gewitter",
};

async function weather(location: string): Promise<ToolRunResult> {
  const geo = (await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=de&format=json`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => r.json())) as { results?: Array<{ name: string; country?: string; admin1?: string; latitude: number; longitude: number; timezone?: string }> };
  const place = geo.results?.[0];
  if (!place) throw new ToolRunError(`Ort „${location}“ nicht gefunden.`, 404);
  const tz = place.timezone ?? "auto";
  const data = (await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max` +
      `&timezone=${encodeURIComponent(tz)}&forecast_days=7`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => r.json())) as {
    current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number };
    daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[]; uv_index_max: number[] };
  };
  if (!data.daily || !data.current) throw new ToolRunError("Wetterdienst nicht erreichbar.", 502);
  const c = data.current;
  const d = data.daily;
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  const day = (iso: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" }).format(new Date(`${iso}T12:00:00`));
  const rows = d.time.map((t, i) =>
    `| ${day(t)} | ${WEATHER_CODES[d.weather_code[i] ?? -1] ?? "–"} | ${Math.round(d.temperature_2m_min[i] ?? 0)}° / ${Math.round(d.temperature_2m_max[i] ?? 0)}° | ${d.precipitation_probability_max[i] ?? 0} % | ${Math.round(d.wind_speed_10m_max[i] ?? 0)} km/h | ${Math.round(d.uv_index_max[i] ?? 0)} |`,
  );
  return {
    markdown: [
      `## ${label}`,
      `**Jetzt:** ${WEATHER_CODES[c.weather_code] ?? ""}, **${Math.round(c.temperature_2m)} °C** (gefühlt ${Math.round(c.apparent_temperature)} °C), Wind ${Math.round(c.wind_speed_10m)} km/h, Luftfeuchte ${c.relative_humidity_2m} %`,
      "",
      "| Tag | Wetter | Min / Max | Regen | Wind | UV |",
      "|---|---|---|---|---|---|",
      ...rows,
    ].join("\n"),
    sources: [{ title: "Open-Meteo", uri: "https://open-meteo.com" }],
    model: "Open-Meteo",
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

const DOC_TYPES: Record<string, string> = {
  business_plan: "Businessplan",
  pitch_deck: "Pitch-Deck-Gliederung",
  ops_manual: "Betriebshandbuch",
  sop: "Standardarbeitsanweisung (SOP)",
  contract: "Vertragsentwurf (mit Hinweis: vor Verwendung anwaltlich prüfen lassen)",
  offer: "Angebot",
  email: "Geschäfts-E-Mail",
};

export async function runToolApp(input: ToolRunInput): Promise<ToolRunResult> {
  const { tool, action, fields, workspaceId } = input;
  currentWorkspaceId = workspaceId;

  if (tool === "weather") return weather(field(fields, "location", "Ort"));

  if (tool === "translate") {
    const text = field(fields, "text", "Text");
    const target = field(fields, "target", "Zielsprache");
    return llm(
      "Du bist professioneller Übersetzer. „Portugiesisch“ heißt europäisches Portugiesisch (Portugal), außer es steht ausdrücklich „Brasilien“ dabei. Übersetze natürlich und idiomatisch, behalte Ton, Formatierung und Fachbegriffe bei. Gib NUR die Übersetzung aus, danach optional einen Abschnitt „## Hinweise“, falls ein Begriff mehrdeutig ist.",
      `Zielsprache: ${target}\n\nText:\n${text}`,
    );
  }

  if (tool === "research") {
    const query = field(fields, "query", "Thema / Frage");
    const depth = fields.depth === "kurz" ? "kurz (max. 200 Wörter)" : "gründlich";
    return llm(
      "Du bist Research-Analyst. Recherchiere mit der Google-Suche aktuell. Gliederung: ## Kurzantwort · ## Fakten & Zahlen (mit Jahr und Herkunft) · ## Einordnung · ## Offene Punkte. Nichts erfinden; Unbelegtes als unbelegt kennzeichnen.",
      `Frage: ${query}\nUmfang: ${depth}`,
      { search: true },
    );
  }

  if (tool === "elli") {
    if (action === "summarize") {
      const text = field(fields, "text", "Text");
      return llm("Fasse den Text präzise zusammen: ## Kernaussage (1–2 Sätze) · ## Wichtigste Punkte (3–7) · ## To-dos (falls vorhanden).", text);
    }
    if (action === "outline") {
      const topic = field(fields, "topic", "Thema");
      return llm("Erstelle eine klare, logische Gliederung mit Haupt- und Unterpunkten und je einem Satz, was in den Abschnitt gehört.", topic);
    }
    const brief = field(fields, "brief", "Worum geht es?");
    const tone = fields.tone?.trim() || "freundlich-professionell";
    return llm(
      `Du schreibst Texte im Namen des Nutzers. Ton: ${tone}. Konkret, kurz, ohne Floskeln. Wenn es eine E-Mail ist: Betreff als erste Zeile „**Betreff:** …“.`,
      brief,
    );
  }

  if (tool === "daily_planner") {
    const notes = (fields.notes ?? "").trim().slice(0, 4000);
    const [tasks, ws] = await Promise.all([openTasksText(workspaceId), workspaceContext(workspaceId)]);
    const base = `Workspace: ${ws.name}\nOffene Aufgaben:\n${tasks}${notes ? `\n\nNotizen des Nutzers für heute:\n${notes}` : ""}`;
    const prompts: Record<string, string> = {
      morning_brief: "Erstelle ein kompaktes Morgen-Briefing: ## Heute wichtig (max. 3) · ## Termine/Fristen · ## Achtung (Risiken) · ## Erster Schritt.",
      plan_day: "Erstelle einen realistischen Tagesplan mit konkreten Zeitblöcken (08:00–19:00), Pausen und Puffer. Wichtigstes zuerst, Deep-Work am Vormittag. Format: Tabelle | Zeit | Block | Ziel |, danach ## Wenn nur eine Sache klappt.",
      startpunkt: "Der Nutzer weiß nicht, wo er anfangen soll. Nenne den EINEN wichtigsten nächsten Schritt (konkret, in 25 Minuten machbar), warum genau dieser, und was danach kommt.",
      next_steps: "Leite aus dem Stand die nächsten 5 konkreten Schritte ab, priorisiert, je mit geschätzter Dauer.",
    };
    return llm(
      "Du bist ein pragmatischer Planungs-Coach. Arbeite nur mit den gegebenen Aufgaben und Notizen; erfinde keine Termine.",
      `${prompts[action] ?? prompts.plan_day}\n\n${base}`,
    );
  }

  if (tool === "company_builder") {
    const ws = await workspaceContext(workspaceId);
    const company = (fields.company ?? "").trim() || ws.name;
    const ctx = `Unternehmen: ${company}${ws.profile ? `\nBeschreibung: ${ws.profile}` : ""}${fields.context?.trim() ? `\nZusätzlicher Kontext: ${fields.context.trim().slice(0, 4000)}` : ""}`;
    if (action === "create_process") {
      const name = field(fields, "name", "Prozess");
      return llm(
        "Du bist Operations-Experte. Dokumentiere den Prozess: ## Ziel · ## Auslöser · ## Rollen · ## Schritte (nummeriert, je mit Verantwortlichem und Ergebnis) · ## Checkliste · ## Kennzahlen · ## Häufige Fehler.",
        `Prozess: ${name}\n\n${ctx}`,
      );
    }
    if (action === "create_document") {
      const type = DOC_TYPES[fields.type ?? ""] ?? "Geschäftsdokument";
      const title = field(fields, "title", "Titel");
      return llm(
        `Du erstellst professionelle Geschäftsdokumente. Dokumenttyp: ${type}. Vollständig, gut gegliedert, mit Platzhaltern [so] für unbekannte Angaben. Keine Zahlen erfinden.`,
        `Titel: ${title}\n\n${ctx}`,
        { maxOutputTokens: 8000 },
      );
    }
    if (action === "weekly_review") {
      const tasks = await openTasksText(workspaceId);
      return llm(
        "Erstelle einen Wochenreview: ## Fortschritt · ## Was blockiert · ## Entscheidungen nötig · ## Fokus nächste Woche (max. 3) · ## Kennzahlen zum Beobachten.",
        `${ctx}\n\nOffene Aufgaben:\n${tasks}${fields.notes?.trim() ? `\n\nNotizen zur Woche:\n${fields.notes.trim()}` : ""}`,
      );
    }
    const focus = (fields.focus ?? "").trim();
    return llm(
      "Du bist erfahrener Gründungsberater. Erstelle einen Aufbauplan: ## Zusammenfassung · ## Phasen (je Dauer, Ziele, Aufgaben) · ## Meilensteine · ## Risiken & Gegenmaßnahmen · ## Die nächsten 3 Schritte. Konkret und umsetzbar, keine erfundenen Zahlen.",
      `${ctx}${focus ? `\nFokus: ${focus}` : ""}`,
      { maxOutputTokens: 8000 },
    );
  }

  throw new ToolRunError("Unbekanntes Werkzeug.");
}
