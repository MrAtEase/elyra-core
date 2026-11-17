import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";
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
    const dataContext = typeof body.context === "string" ? body.context.slice(0, 12000) : "";
    try {
      const { text, model } = await callGeminiText({
        system: `Du gestaltest hochwertige Präsentationen wie eine Top-Agentur. Antworte NUR mit JSON:
{"title": "...", "slides": [ SLIDE, ... ]}
Jede SLIDE hat "title", "layout", "notes" (2–4 Sätze Sprechertext) und je nach layout:
- "title": "body" (Untertitel)                        → nur für Folie 1
- "bullets": "body" (1 Satz Kernaussage), "bullets" (3–5 kurze Punkte)
- "stats": "stats": [{"value": "54.500 €", "label": "..."}] (1–3 große Kennzahlen), "body" (1 Satz Einordnung)
- "comparison": "columns": [{"heading": "Heute", "points": [...]}, {"heading": "Mit uns", "points": [...]}]
- "timeline": "steps": [{"label": "Q1", "detail": "..."}] (3–5 Schritte)
- "quote": "quote": {"text": "...", "author": "..."} → NUR für echte Aussagen von Personen/Kunden, nie für eigene Empfehlungen oder Zahlen
- "team": "people": [{"name": "...", "role": "..."}] (2–4 Personen)
Regeln: Genau ${slideCount} Folien. Wähle pro Folie das Layout, das die Botschaft am stärksten zeigt –
nicht überall "bullets"; mindestens 3 verschiedene Layouts. Eine Kernbotschaft pro Folie, kurze Sätze.
${isPitch ? "Pitchdeck-Struktur (in dieser Reihenfolge, passend gekürzt): Titel, Problem, Lösung, Markt, Geschäftsmodell, Traktion/Kennzahlen, Wettbewerb (comparison), Roadmap (timeline), Team, Ask/Finanzierungsbedarf." : "Letzte Folie = Fazit / nächste Schritte."}
${dataContext ? "Verwende für Zahlen AUSSCHLIESSLICH die Daten aus dem Kontext, erfinde keine Zahlen. Kennzeichne Umsatzschätzungen als grobe Schätzung. Keine Zitate erfinden." : "Erfinde keine konkreten Statistiken oder Marktzahlen; nutze Platzhalter wie [Zahl] wo nötig."}
Stil: ${body.style ?? "professional"}. Sprache: die Sprache der Anfrage. Team-Namen nur, wenn genannt, sonst Rollen als Platzhalter.`,
        prompt: dataContext ? `${prompt}\n\nKontext/Daten:\n${dataContext}` : prompt,
        json: true,
        maxOutputTokens: 8000,
      });
      const parsed = JSON.parse(text) as { title?: string; slides?: Array<Record<string, unknown>> };
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      const arr = <T,>(v: unknown, map: (x: Record<string, unknown>) => T | null, max: number): T[] =>
        Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null).slice(0, max) : [];
      const LAYOUTS = new Set(["title", "bullets", "two-col", "blank", "stats", "comparison", "timeline", "quote", "team"]);
      const slides = (parsed.slides ?? [])
        .filter((slide) => slide && typeof slide.title === "string")
        .map((slide, index) => {
          const layout = LAYOUTS.has(str(slide.layout)) ? str(slide.layout) : index === 0 ? "title" : "bullets";
          const quote = slide.quote && typeof slide.quote === "object" ? (slide.quote as Record<string, unknown>) : null;
          return {
            title: str(slide.title),
            body: str(slide.body),
            layout,
            bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String).slice(0, 6) : [],
            stats: arr(slide.stats, (x) => (x.value ? { value: String(x.value), label: str(x.label) } : null), 3),
            columns: arr(slide.columns, (x) => ({ heading: str(x.heading), points: Array.isArray(x.points) ? x.points.map(String).slice(0, 5) : [] }), 2),
            steps: arr(slide.steps, (x) => (x.label ? { label: String(x.label), detail: str(x.detail) } : null), 5),
            people: arr(slide.people, (x) => (x.name ? { name: String(x.name), role: str(x.role) } : null), 4),
            ...(quote && quote.text ? { quote: { text: String(quote.text), author: str(quote.author) } } : {}),
            notes: str(slide.notes),
          };
        });
      if (slides.length === 0) throw new Error("Gemini returned no slides");
      return NextResponse.json({
        ok: true,
        source: "ai",
        provider,
        providerLabel: `Gemini (${model})`,
        useReasoning: false,
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

function buildLocalSlides(prompt: string, count: number): { title: string; slides: { title: string; body: string; bullets?: string[] }[] } {
  const topic = prompt.trim();
  const titleized = topic.charAt(0).toUpperCase() + topic.slice(1);

  const templates = [
    { title: "Executive Summary", body: `Key insights and strategic direction for ${titleized}.`, bullets: ["Core value proposition", "Market opportunity", "Strategic priorities", "Expected outcomes"] },
    { title: "Context & Background", body: `Why ${titleized} matters now — the landscape and driving forces.`, bullets: ["Market trends", "Competitive dynamics", "Customer needs", "Technology enablers"] },
    { title: "Current State", body: "Analysis of where we are today and what needs to change.", bullets: ["Strengths to leverage", "Gaps to address", "Quick wins available", "Constraints to navigate"] },
    { title: "Proposed Solution", body: `A structured approach to ${titleized} that delivers measurable results.`, bullets: ["Core concept", "Key differentiators", "Implementation path", "Success criteria"] },
    { title: "Roadmap", body: "Phased execution plan with clear milestones and ownership.", bullets: ["Phase 1: Foundation (30 days)", "Phase 2: Build (60 days)", "Phase 3: Scale (90 days)", "Ongoing: Optimize"] },
    { title: "Impact & ROI", body: "Expected outcomes and return on investment.", bullets: ["Revenue impact", "Cost savings", "Efficiency gains", "Risk reduction"] },
    { title: "Team & Resources", body: "Who owns this and what's needed to succeed.", bullets: ["Executive sponsor", "Core team members", "External partners", "Budget requirements"] },
    { title: "Risks & Mitigation", body: "Key risks identified and plans to address them.", bullets: ["Technical risks", "Market risks", "Execution risks", "Dependency risks"] },
    { title: "Success Metrics", body: "How we'll measure progress and know when we've succeeded.", bullets: ["Primary KPIs", "Leading indicators", "Review cadence", "Reporting structure"] },
    { title: "Next Steps", body: "Immediate actions and decision points.", bullets: ["Decision needed by", "First milestone", "Owner assignments", "Communication plan"] },
    { title: "Appendix", body: "Supporting data, references, and additional context.", bullets: ["Research sources", "Data models", "Technical specs", "Glossary"] },
    { title: "Q&A", body: "Questions, discussion, and next steps.", bullets: ["Open discussion", "Key decisions", "Action items", "Follow-up timeline"] },
  ];

  const selected = templates.slice(0, count);

  return {
    title: titleized,
    slides: selected.map((slide) => ({
      title: slide.title,
      body: slide.body,
      bullets: slide.bullets,
    })),
  };
}
