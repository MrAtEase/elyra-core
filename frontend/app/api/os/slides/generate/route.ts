import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
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
  const slideCount = Math.max(3, Math.min(body.slideCount ?? 6, 12));
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
