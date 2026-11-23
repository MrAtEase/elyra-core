import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";
import { getAiSettingsCached } from "@/lib/admin/controlCenter";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";

type SlidesProvider = "gemini" | "claude_vertex";

type ProviderStatus = {
  configured: boolean;
  label: string;
  reasoningSupported: boolean;
  issues: string[];
  model: string;
};

function trimEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function getProviderStatuses(): Record<SlidesProvider, ProviderStatus> {
  const vertexProject = trimEnv("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
  const vertexLocation = trimEnv("VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION");
  const vertexCredentials = trimEnv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "VERTEX_SERVICE_ACCOUNT_JSON",
  );
  const vertexIssues: string[] = [];

  if (!vertexProject) vertexIssues.push("Missing VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT.");
  if (!vertexLocation) vertexIssues.push("Missing VERTEX_LOCATION or GOOGLE_CLOUD_LOCATION.");
  if (!vertexCredentials) {
    vertexIssues.push(
      "Missing GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or VERTEX_SERVICE_ACCOUNT_JSON.",
    );
  }

  return {
    gemini: {
      configured: true,
      label: "Gemini via worker backbone",
      reasoningSupported: true,
      issues: [],
      model: trimEnv("SLIDES_GEMINI_MODEL") || "gemini-2.0-flash",
    },
    claude_vertex: {
      configured: vertexIssues.length === 0,
      label: "Claude via Vertex AI",
      reasoningSupported: true,
      issues: vertexIssues,
      model: trimEnv("VERTEX_CLAUDE_MODEL") || "claude-sonnet-4.5-vertex",
    },
  };
}

function resolveProvider(value: unknown): SlidesProvider {
  return value === "claude_vertex" ? "claude_vertex" : "gemini";
}

function buildErrorResponse(input: {
  status: number;
  code: string;
  error: string;
  details?: string[];
  provider: SlidesProvider;
  reasoning: boolean;
}) {
  const providerStatuses = getProviderStatuses();
  return NextResponse.json(
    {
      ok: false,
      ...input,
      providerStatus: providerStatuses,
    },
    { status: input.status },
  );
}

/**
 * GET /api/os/slides/generate
 *
 * Returns the current provider statuses without generating anything.
 * Used by the SlidesWindow to pre-check which providers are configured.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    providerStatus: getProviderStatuses(),
  });
}

/**
 * POST /api/os/slides/generate
 *
 * Generates slide content using the AI backbone.
 * Falls back to a structured local generation if backbone is unavailable.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    topic?: string;
    slideCount?: number;
    style?: string;
    workspaceId?: string;
    provider?: SlidesProvider;
    useReasoning?: boolean;
    /** optional data context (e.g. reporting KPIs) the deck must be based on */
    context?: string;
    /** research the topic on the web (Gemini + Google Search) before writing the deck */
    research?: boolean;
  } | null;

  if (!body?.prompt && !body?.topic) {
    return buildErrorResponse({
      status: 400,
      code: "PROMPT_REQUIRED",
      error: "A topic or prompt is required to generate slides.",
      provider: "gemini",
      reasoning: false,
    });
  }

  const prompt = body.prompt ?? body.topic ?? "";
  const slideCount = Math.max(3, Math.min(body.slideCount ?? 6, 14));
  const provider = resolveProvider(body.provider);
  const useReasoning = body.useReasoning === true;
  const providerStatus = getProviderStatuses()[provider];

  if (!providerStatus.configured) {
    console.warn("[api/os/slides/generate] provider not configured", {
      provider,
      issues: providerStatus.issues,
      workspaceId: body.workspaceId ?? null,
    });
    return buildErrorResponse({
      status: 503,
      code: "PROVIDER_NOT_CONFIGURED",
      error: `${providerStatus.label} is not configured in this environment.`,
      details: providerStatus.issues,
      provider,
      reasoning: useReasoning,
    });
  }

  if (useReasoning && !providerStatus.reasoningSupported) {
    return buildErrorResponse({
      status: 400,
      code: "REASONING_UNSUPPORTED",
      error: `Reasoning mode is not available for ${providerStatus.label}.`,
      provider,
      reasoning: useReasoning,
    });
  }

  // Direct Gemini path (GEMINI_API_KEY): the worker has no /v1/os/generate/slides route locally.
  if (provider === "gemini" && geminiConfigured()) {
    const isPitch = (body.style ?? "").toLowerCase() === "pitchdeck" || /pitch/i.test(prompt);
    const userContext = typeof body.context === "string" ? body.context.slice(0, 12000) : "";
    let researchSources: Array<{ title: string; uri: string }> = [];
    let researchNote = "";
    let researchText = "";
    const aiSettings = body.workspaceId ? await getAiSettingsCached(body.workspaceId).catch(() => null) : null;
    if (body.research === true && aiSettings?.webResearch === false) researchNote = "Web-Recherche ist unter Workspace Admin › AI ausgeschaltet.";
    if (body.research === true && aiSettings?.webResearch !== false) {
      try {
        const research = await callGeminiText({
          system: `Du bist Research-Analyst und bereitest Material für eine Präsentation vor. Recherchiere mit der Google-Suche aktuell und gründlich.
Liefere kompakte Fakten-Notizen (kein Fließtext), gegliedert in: Kernaussagen · Aktuelle Zahlen & Fakten · Trends · Beispiele/Fallstudien · Risiken/Gegenargumente.
Jede Zahl mit Jahr und Herkunft (z. B. „Statista 2025", „Eurostat 2024"). Wörtliche Zitate nur, wenn sie so in einer Quelle stehen, mit Person.
Nichts erfinden; wenn etwas nicht belegt ist, schreibe „nicht belegt". Heutiges Datum: ${new Date().toISOString().slice(0, 10)}. Sprache: die Sprache der Anfrage.`,
          prompt: `Thema der Präsentation: ${prompt}${userContext ? `\n\nZusätzlicher Kontext des Nutzers:\n${userContext.slice(0, 4000)}` : ""}`,
          googleSearch: true,
          temperature: 0.2,
          maxOutputTokens: 4096,
          timeoutMs: 60_000,
        });
        researchText = research.text.trim().slice(0, 12000);
        researchSources = research.sources;
        if (!researchText) researchNote = "Die Recherche hat nichts geliefert – das Deck basiert nur auf allgemeinem Wissen.";
      } catch (error) {
        console.warn("[api/os/slides/generate] research failed", { reason: error instanceof Error ? error.message : String(error) });
        const msg = error instanceof Error ? error.message : "";
        researchNote = /quota|RESOURCE_EXHAUSTED|429/i.test(msg)
          ? "Web-Recherche nicht möglich: Das Kontingent für die Google-Suche im Gemini-API-Schlüssel ist aufgebraucht (Abrechnung in Google AI Studio aktivieren). Das Deck basiert auf allgemeinem Wissen."
          : "Die Web-Recherche war nicht möglich – das Deck basiert nur auf allgemeinem Wissen.";
      }
    }
    const sourceList = researchSources.map((src, i) => `[${i + 1}] ${src.title}`).join("\n");
    const dataContext = [
      userContext ? `Daten/Kontext des Nutzers:\n${userContext}` : "",
      researchText ? `Recherche-Ergebnisse (Web, ${new Date().toISOString().slice(0, 10)}):\n${researchText}${sourceList ? `\n\nQuellenliste:\n${sourceList}` : ""}` : "",
    ].filter(Boolean).join("\n\n");
    try {
      const { text, model } = await callGeminiText({
        system: `Du bist Senior-Präsentationsdesigner und Storyteller (Niveau McKinsey / Top-Agentur).
Erstelle eine überzeugende, professionelle Präsentation. Antworte NUR mit JSON:
{"title": "...", "slides": [ SLIDE, ... ]}

Jede SLIDE hat "title", "layout", "notes" (2–4 Sätze Sprechertext), optional "source" (kurze Quellenangabe wie „Statista 2025", Pflicht bei Folien mit Zahlen aus der Recherche) und je nach layout:
- "title"      → NUR Folie 1. "body": Untertitel (max. 14 Wörter). Optional "bullets": 1–3 kurze Meta-Angaben (z. B. Anlass, Datum).
- "agenda"     → "bullets": 3–6 Kapitelnamen (je 1–4 Wörter). Nur bei ≥ 7 Folien, direkt nach dem Titel.
- "section"    → Kapiteltrenner. "body": 1 kurzer Satz. Sparsam, nur bei ≥ 10 Folien.
- "bullets"    → "body": 1 Satz Einordnung; "bullets": 3–5 Punkte, je max. 12 Wörter, parallel formuliert.
- "stats"      → "stats": 2–4 Kennzahlen [{"value": "54.500 €", "label": "max. 6 Wörter"}]; "body": 1 Satz Einordnung. value maximal 8 Zeichen.
- "comparison" → "columns": genau 2 [{"heading": "Heute", "points": [3–4 Punkte]}, {"heading": "Mit uns", "points": [...]}]. Die zweite Spalte ist die empfohlene / bessere Option.
- "timeline"   → "steps": 3–5 [{"label": "1–3 Wörter", "detail": "max. 10 Wörter"}]; "body": 1 Satz.
- "quote"      → "quote": {"text": "...", "author": "..."} NUR für echte, belegbare Aussagen von Personen/Kunden – nie erfinden.
- "team"       → "people": 2–4 [{"name": "...", "role": "..."}]
- "blank"      → nur "title" + "body" (1–2 starke Sätze) für eine zentrale Botschaft.
- "closing"    → letzte Folie: Fazit / Call-to-Action. "body": 1 Satz; "bullets": 2–4 konkrete nächste Schritte.

Regeln:
- Genau ${slideCount} Folien. Erste Folie "title", letzte Folie "closing".
- Titel sind Aussagen, keine Etiketten („Der Markt wächst jährlich zweistellig" statt „Markt"), max. 10 Wörter.
- Eine Kernbotschaft pro Folie. Kurz, konkret, keine Füllwörter, keine Emojis, kein Markdown.
- Abwechslung: mindestens 4 verschiedene Layouts, nie zweimal "bullets" direkt hintereinander.
- Erzählbogen: Ausgangslage → Problem/Chance → Lösung → Beleg/Kennzahlen → Plan → Entscheidung.
${isPitch ? "Pitchdeck-Struktur (in dieser Reihenfolge, passend gekürzt): Titel, Problem, Lösung, Markt (stats), Geschäftsmodell, Traktion/Kennzahlen (stats), Wettbewerb (comparison), Roadmap (timeline), Team (team), Ask/Finanzierungsbedarf (closing)." : ""}
${researchText ? "Nutze die Recherche-Ergebnisse aktiv: konkrete aktuelle Zahlen, Trends und Beispiele daraus machen das Deck stark. Setze bei jeder Folie mit Zahlen/Fakten \"source\" und nenne in \"notes\" die Quelle." : ""}
${dataContext ? "Verwende für Zahlen AUSSCHLIESSLICH die Daten aus Kontext/Recherche, erfinde keine Zahlen. Kennzeichne Schätzungen als Schätzung. Zitate nur, wenn sie wörtlich in der Recherche stehen." : "Erfinde keine konkreten Statistiken, Marktzahlen oder Zitate. Wo eine Zahl nötig ist, nutze einen Platzhalter wie [Zahl] oder nutze statt stats ein anderes Layout."}
Stil: ${body.style ?? "professional"}. Sprache: die Sprache der Anfrage. Team-Namen nur, wenn genannt, sonst Rollen als Platzhalter.`,
        prompt: dataContext ? `${prompt}\n\nKontext/Daten:\n${dataContext}` : prompt,
        json: true,
        preferredModel: aiSettings?.model ?? null,
        ...(aiSettings ? { temperature: aiSettings.temperature } : {}),
        maxOutputTokens: 8000,
      });
      const parsed = JSON.parse(text) as { title?: string; slides?: Array<Record<string, unknown>> };
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      const arr = <T,>(v: unknown, map: (x: Record<string, unknown>) => T | null, max: number): T[] =>
        Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null).slice(0, max) : [];
      const LAYOUTS = new Set(["title", "section", "agenda", "bullets", "two-col", "blank", "stats", "comparison", "timeline", "quote", "team", "closing"]);
      const slides = (parsed.slides ?? [])
        .filter((slide) => slide && typeof slide.title === "string")
        .map((slide, index) => {
          const layout = index === 0 ? "title" : LAYOUTS.has(str(slide.layout)) ? str(slide.layout) : "bullets";
          const quote = slide.quote && typeof slide.quote === "object" ? (slide.quote as Record<string, unknown>) : null;
          return {
            title: str(slide.title),
            body: str(slide.body),
            layout,
            bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String).slice(0, 6) : [],
            stats: arr(slide.stats, (x) => (x.value ? { value: String(x.value), label: str(x.label) } : null), 4),
            columns: arr(slide.columns, (x) => ({ heading: str(x.heading), points: Array.isArray(x.points) ? x.points.map(String).slice(0, 5) : [] }), 2),
            steps: arr(slide.steps, (x) => (x.label ? { label: String(x.label), detail: str(x.detail) } : null), 5),
            people: arr(slide.people, (x) => (x.name ? { name: String(x.name), role: str(x.role) } : null), 4),
            ...(quote && quote.text ? { quote: { text: String(quote.text), author: str(quote.author) } } : {}),
            notes: str(slide.notes),
            ...(str(slide.source) ? { source: str(slide.source).slice(0, 140) } : {}),
          };
        });
      if (slides.length === 0) throw new Error("Gemini returned no slides");
      if (researchSources.length > 0) {
        slides.push({
          title: "Quellen",
          body: `Web-Recherche vom ${new Date().toLocaleDateString("de-DE")}`,
          layout: "bullets",
          bullets: researchSources.slice(0, 6).map((src) => src.title),
          stats: [], columns: [], steps: [], people: [],
          notes: researchSources.map((src, i) => `[${i + 1}] ${src.title} – ${src.uri}`).join("\n"),
        });
      }
      return NextResponse.json({
        ok: true,
        source: "ai",
        provider,
        providerLabel: researchText ? `Gemini (${model}) + Google-Suche` : `Gemini (${model})`,
        useReasoning: false,
        ...(researchSources.length ? { research: { sources: researchSources } } : {}),
        ...(researchNote ? { warning: researchNote } : {}),
        deck: { title: parsed.title ?? prompt, slides },
      });
    } catch (error) {
      console.warn("[api/os/slides/generate] direct Gemini failed, using local fallback", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({
        ok: true,
        source: "local",
        provider,
        providerLabel: "Local fallback",
        useReasoning: false,
        warning: "Gemini war nicht erreichbar. Es wurde eine Folienvorlage erstellt.",
        ...(process.env.NODE_ENV !== "production"
          ? { debugReason: error instanceof Error ? error.message : String(error) }
          : {}),
        deck: buildLocalSlides(prompt, slideCount),
      });
    }
  }

  // Try to route through the AI backbone
  try {
    const backboneBody = {
      intent: `Create a professional presentation: ${prompt}`,
      context: {
        app: "slides",
        slideCount,
        style: body.style ?? "professional",
        outputFormat: "slides_json",
        provider,
        providerLabel: providerStatus.label,
        model: providerStatus.model,
        reasoning: useReasoning,
      },
      workspaceId: body.workspaceId,
    };

    const payload = await forwardToWorkerOs({
      path: "/v1/os/generate/slides",
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
      body: backboneBody,
    });

    return NextResponse.json({
      ok: true,
      source: "ai",
      provider,
      providerLabel: providerStatus.label,
      useReasoning,
      ...payload,
    });
  } catch (error) {
    // Backbone unavailable — generate locally with a structured template
    if (provider === "gemini" && (!(error instanceof WorkerProxyError) || error.status === 503)) {
      console.warn("[api/os/slides/generate] backbone unavailable, using local fallback", {
        provider,
        reasoning: useReasoning,
        reason: error instanceof Error ? error.message : String(error),
      });
      const slides = buildLocalSlides(prompt, slideCount);
      return NextResponse.json({
        ok: true,
        source: "local",
        provider,
        providerLabel: "Local fallback",
        useReasoning: false,
        warning: "AI backbone unavailable. A local slide template was generated instead.",
        deck: slides,
      });
    }

    if (error instanceof WorkerProxyError) {
      const payload =
        error.payload && typeof error.payload === "object"
          ? (error.payload as Record<string, unknown>)
          : null;
      const upstreamCode =
        typeof payload?.error_code === "string"
          ? payload.error_code
          : "UPSTREAM_ERROR";
      const upstreamMessage =
        typeof payload?.message === "string"
          ? payload.message
          : error.message;

      console.error("[api/os/slides/generate] worker request failed", {
        provider,
        reasoning: useReasoning,
        status: error.status,
        code: upstreamCode,
        message: upstreamMessage,
      });

      return buildErrorResponse({
        status: error.status >= 400 ? error.status : 503,
        code: upstreamCode,
        error: upstreamMessage,
        provider,
        reasoning: useReasoning,
      });
    }

    const message = error instanceof Error ? error.message : "Slides generation failed.";
    console.error("[api/os/slides/generate] unexpected failure", {
      provider,
      reasoning: useReasoning,
      message,
    });

    return buildErrorResponse({
      status: 500,
      code: "UNEXPECTED_FAILURE",
      error: message,
      provider,
      reasoning: useReasoning,
    });
  }
}

// ── Local fallback generator ─────────────────────────────────────────────────

type LocalSlide = {
  title: string;
  body: string;
  layout: string;
  bullets?: string[];
  steps?: Array<{ label: string; detail?: string }>;
  columns?: Array<{ heading: string; points: string[] }>;
  stats?: Array<{ value: string; label: string }>;
  notes?: string;
};

/** Structured template deck (used when no model is reachable) – varied layouts, placeholders instead of invented numbers. */
function buildLocalSlides(prompt: string, count: number): { title: string; slides: LocalSlide[] } {
  const topic = prompt.split(/\s+[—–-]\s+Context:/)[0]?.trim() || prompt.trim();
  const titleized = topic.charAt(0).toUpperCase() + topic.slice(1);
  const german = /[äöüß]|\b(und|der|die|das|für|mit|wir|unsere?)\b/i.test(prompt);
  const t = (de: string, en: string) => (german ? de : en);

  const first: LocalSlide = { title: titleized, body: t("Ausgangslage, Lösungsansatz und nächste Schritte", "Context, approach and next steps"), layout: "title" };
  const last: LocalSlide = {
    title: t("Was wir heute entscheiden sollten", "What we should decide today"), body: t("Mit diesen Schritten starten wir sofort.", "These steps get us started right away."), layout: "closing",
    bullets: [t("Ziel und Budget freigeben", "Approve goal and budget"), t("Verantwortliche benennen", "Name the owners"), t("Kickoff-Termin festlegen", "Set the kickoff date")],
  };
  const middle: LocalSlide[] = [
    { title: t("Agenda", "Agenda"), body: "", layout: "agenda", bullets: [t("Ausgangslage", "Context"), t("Herausforderung", "Challenge"), t("Lösung", "Solution"), t("Fahrplan", "Roadmap"), t("Entscheidung", "Decision")] },
    { title: t(`Warum ${titleized} jetzt wichtig ist`, `Why ${titleized} matters now`), body: t("Drei Entwicklungen machen das Thema dringend.", "Three shifts make this urgent."), layout: "bullets",
      bullets: [t("Kundenerwartungen steigen schneller als Prozesse", "Customer expectations outpace processes"), t("Wettbewerber automatisieren bereits", "Competitors are already automating"), t("Neue Technologie senkt die Einstiegshürde", "New technology lowers the barrier to entry")] },
    { title: t("Heute vs. morgen", "Today vs. tomorrow"), body: t("Was sich konkret verändert.", "What concretely changes."), layout: "comparison",
      columns: [
        { heading: t("Heute", "Today"), points: [t("Manuelle Abläufe", "Manual workflows"), t("Verstreute Daten", "Scattered data"), t("Langsame Entscheidungen", "Slow decisions")] },
        { heading: t("Zielbild", "Target state"), points: [t("Automatisierte Abläufe", "Automated workflows"), t("Eine Datenquelle", "Single source of truth"), t("Entscheidungen in Echtzeit", "Real-time decisions")] },
      ] },
    { title: t("Unsere Lösung in drei Bausteinen", "Our solution in three building blocks"), body: t("Jeder Baustein liefert für sich messbaren Nutzen.", "Each block delivers measurable value on its own."), layout: "bullets",
      bullets: [t("Analyse: Daten bündeln und Potenziale finden", "Analyse: unify data and find potential"), t("Umsetzung: Prozesse automatisieren", "Execute: automate the processes"), t("Steuerung: Ergebnisse laufend messen", "Steer: measure results continuously")] },
    { title: t("Erwartete Wirkung", "Expected impact"), body: t("Zielwerte werden in der Analysephase validiert.", "Targets are validated during the analysis phase."), layout: "stats",
      stats: [{ value: "[x] %", label: t("weniger manueller Aufwand", "less manual effort") }, { value: "[x] Wo.", label: t("bis zum ersten Ergebnis", "to first results") }, { value: "[x] €", label: t("Einsparung pro Jahr", "annual savings") }] },
    { title: t("Fahrplan in drei Phasen", "Roadmap in three phases"), body: t("Jede Phase endet mit einem klaren Go / No-Go.", "Each phase ends with a clear go / no-go."), layout: "timeline",
      steps: [{ label: t("Analyse", "Analyse"), detail: t("Ist-Stand und Ziele, 2 Wochen", "Baseline and goals, 2 weeks") }, { label: t("Pilot", "Pilot"), detail: t("Erster Prozess live, 4 Wochen", "First process live, 4 weeks") }, { label: t("Rollout", "Rollout"), detail: t("Skalierung auf alle Teams", "Scale to all teams") }] },
    { title: t("Risiken sind beherrschbar", "Risks are manageable"), body: t("Für jedes Risiko gibt es eine klare Gegenmaßnahme.", "Every risk has a clear mitigation."), layout: "bullets",
      bullets: [t("Datenqualität → frühe Bereinigung", "Data quality → early clean-up"), t("Akzeptanz → Team früh einbinden", "Adoption → involve the team early"), t("Aufwand → klein starten, schnell lernen", "Effort → start small, learn fast")] },
    { title: t("Die Kernbotschaft", "The key message"), body: t(`${titleized} ist kein Großprojekt, sondern eine Folge kleiner, messbarer Schritte.`, `${titleized} is not a big-bang project but a series of small, measurable steps.`), layout: "blank" },
  ];
  const middleCount = Math.max(0, count - 2);
  const picked = (count >= 7 ? middle : middle.slice(1)).slice(0, middleCount);
  return { title: titleized, slides: [first, ...picked, last].slice(0, Math.max(count, 2)) };
}
