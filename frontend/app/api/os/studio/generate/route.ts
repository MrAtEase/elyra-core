import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";
import {
  getProviderStatuses,
  resolveProvider,
  formatProviderIssues,
  type ProviderId,
} from "@/lib/orb-os/providers/providerRouter";

// ── Module registry ────────────────────────────────────────────────────────────

export type StudioModuleId =
  | "brand-guidelines"
  | "doc-coauthoring"
  | "internal-comms"
  | "mcp-builder"
  | "skill-creator"
  | "theme-factory"
  | "web-artifacts-builder"
  | "algorithmic-art"
  | "canvas-design"
  | "slack-gif-creator";

type ModuleMeta = {
  id: StudioModuleId;
  name: string;
  description: string;
  outputType: "document" | "slides" | "code" | "asset" | "config";
  /** Default provider when not specified by workspace */
  defaultProvider: ProviderId;
};

const MODULE_REGISTRY: ModuleMeta[] = [
  { id: "brand-guidelines",      name: "Brand Guidelines",       description: "Generate a brand book: logo usage, colours, typography, voice, do/don'ts.",         outputType: "document", defaultProvider: "gemini" },
  { id: "doc-coauthoring",       name: "Doc Coauthoring",        description: "Generate startup docs: one-pager, PRD, hiring scorecard, pitch deck.",               outputType: "document", defaultProvider: "claude_vertex" },
  { id: "internal-comms",        name: "Internal Comms",         description: "Create comms templates, Slack/Chat guidelines, meeting-note formats.",                outputType: "document", defaultProvider: "gemini" },
  { id: "mcp-builder",           name: "MCP Builder",            description: "Scaffold a connector/tool definition: config schema, validation, and docs.",          outputType: "config",   defaultProvider: "claude_vertex" },
  { id: "skill-creator",         name: "Skill Creator",          description: "Create a new Agent Skill with schema, UI label, and default provider mapping.",       outputType: "config",   defaultProvider: "claude_vertex" },
  { id: "theme-factory",         name: "Theme Factory",          description: "Generate design-system theme tokens: CSS custom properties and Tailwind config.",     outputType: "code",     defaultProvider: "gemini" },
  { id: "web-artifacts-builder", name: "Web Artifacts Builder",  description: "Generate a landing page artifact with HTML/CSS and layout sections.",                 outputType: "code",     defaultProvider: "claude_vertex" },
  { id: "algorithmic-art",       name: "Algorithmic Art",        description: "Generate visual/generative art concepts and SVG compositions.",                       outputType: "asset",    defaultProvider: "gemini" },
  { id: "canvas-design",         name: "Canvas Design",          description: "Create layout compositions: wireframes, social assets, infographic plans.",           outputType: "asset",    defaultProvider: "gemini" },
  { id: "slack-gif-creator",     name: "Slack GIF Creator",      description: "Build a GIF pack plan with scene descriptions and export-ready storyboard.",          outputType: "asset",    defaultProvider: "gemini" },
];

function getModuleMeta(moduleId: string): ModuleMeta | null {
  return MODULE_REGISTRY.find((m) => m.id === moduleId) ?? null;
}

// ── Local fallback generators ─────────────────────────────────────────────────

function buildLocalArtifact(
  moduleId: StudioModuleId,
  inputs: Record<string, string>,
  meta: ModuleMeta,
): Record<string, unknown> {
  const name = inputs.name ?? inputs.brand ?? inputs.topic ?? "Your Project";
  const tone = inputs.tone ?? "professional";

  switch (moduleId) {
    case "brand-guidelines":
      return {
        title: `${name} — Brand Guidelines`,
        sections: [
          { heading: "Brand Identity", body: `${name} represents ${inputs.mission ?? "innovation and quality"}.` },
          { heading: "Logo Usage", body: "Maintain clear space equal to the x-height of the wordmark on all sides. Never distort, recolour, or crop the logo." },
          { heading: "Primary Palette", body: `Primary: ${inputs.primaryColor ?? "#6C9CFC"} · Accent: ${inputs.accentColor ?? "#a78bfa"} · Background: #0a0e14` },
          { heading: "Typography", body: `Headings: ${inputs.headingFont ?? "Inter"} Bold · Body: ${inputs.bodyFont ?? "Inter"} Regular · Mono: JetBrains Mono` },
          { heading: "Brand Voice", body: `Tone: ${tone} · Principles: clarity, confidence, empathy. Avoid jargon, passive voice, and filler words.` },
          { heading: "Do / Don't", body: "Do: use brand colours consistently, write in active voice, show real outcomes. Don't: stretch the logo, use off-palette colours, over-promise." },
        ],
      };

    case "doc-coauthoring":
      return {
        title: `${name} — Startup Document Pack`,
        documents: [
          { name: "One-pager", summary: `${name} solves ${inputs.problem ?? "a key market problem"} with ${inputs.solution ?? "a novel approach"}.` },
          { name: "PRD — v0.1", summary: "Problem statement, user stories, success metrics, non-goals, and open questions." },
          { name: "Hiring Scorecard", summary: "Role definition, must-have competencies, interview rubric (1–5), and red flags." },
        ],
      };

    case "internal-comms":
      return {
        title: `${name} — Internal Comms Kit`,
        templates: [
          { name: "Weekly Status Update", format: "**This week:** [bullets] | **Next week:** [bullets] | **Blockers:** [bullets]" },
          { name: "Meeting Notes", format: "**Date / Attendees / Decisions / Action items (owner + due date)**" },
          { name: "Slack Status Convention", format: "`🟢 Focus` · `🟡 Available` · `🔴 DND` · `✈️ OOO (return date)`" },
          { name: "Incident Comms", format: "**Impact / Timeline / Root cause / Fix / Prevention**" },
        ],
      };

    case "theme-factory":
      return {
        title: `${name} — Theme Tokens`,
        cssVars: [
          "--color-primary: " + (inputs.primaryColor ?? "#6C9CFC") + ";",
          "--color-accent: "  + (inputs.accentColor  ?? "#a78bfa") + ";",
          "--color-bg: "      + (inputs.bgColor       ?? "#0a0e14") + ";",
          "--color-surface: " + (inputs.surfaceColor  ?? "#111827") + ";",
          "--color-text: "    + (inputs.textColor     ?? "#f1f5f9") + ";",
          "--radius-sm: 6px;",
          "--radius-md: 12px;",
          "--radius-lg: 20px;",
        ],
        tailwindExtend: {
          colors: {
            primary: inputs.primaryColor ?? "#6C9CFC",
            accent:  inputs.accentColor  ?? "#a78bfa",
          },
          borderRadius: { sm: "6px", md: "12px", lg: "20px" },
        },
      };

    case "mcp-builder":
      return {
        title: `${inputs.connectorName ?? "My Connector"} — MCP Definition`,
        schema: {
          name: inputs.connectorName ?? "my-connector",
          version: "0.1.0",
          description: inputs.description ?? "A connector definition generated by Elyra Studio.",
          tools: [
            { name: "list", description: "List resources", parameters: { limit: "number", cursor: "string?" } },
            { name: "get",  description: "Get a resource by ID", parameters: { id: "string" } },
            { name: "create", description: "Create a resource", parameters: { data: "object" } },
          ],
          auth: { type: inputs.authType ?? "oauth2", scopes: (inputs.scopes ?? "").split(",").map((s: string) => s.trim()).filter(Boolean) },
        },
      };

    case "skill-creator":
      return {
        title: `${inputs.skillName ?? "New Skill"} — Skill Definition`,
        skill: {
          id:   (inputs.skillName ?? "new-skill").toLowerCase().replace(/\s+/g, "-"),
          name: inputs.skillName ?? "New Skill",
          description: inputs.description ?? "A skill generated by Elyra Studio.",
          defaultProvider: inputs.provider ?? "gemini",
          inputs: [{ name: "query", type: "string", required: true }],
          outputs: [{ name: "result", type: "string" }],
          systemPrompt: `You are a helpful assistant for ${inputs.skillName ?? "this task"}. ${inputs.systemPromptHint ?? ""}`,
        },
      };

    case "web-artifacts-builder":
      return {
        title: `${name} — Landing Page`,
        sections: [
          { section: "hero",     content: `**${name}** — ${inputs.tagline ?? "The smarter way to get things done."}` },
          { section: "features", content: (inputs.features ?? "Fast · Reliable · Intelligent").split("·").map((f: string) => f.trim()) },
          { section: "cta",      content: inputs.ctaText ?? "Get started free" },
          { section: "footer",   content: `© ${new Date().getFullYear()} ${name}` },
        ],
      };

    case "algorithmic-art":
      return {
        title: `${name} — Generative Art Concept`,
        concept: inputs.concept ?? "Geometric flow fields with gradient colour cycling",
        palette: [inputs.primaryColor ?? "#6C9CFC", inputs.accentColor ?? "#a78bfa", "#ec4899", "#f59e0b"],
        algorithm: inputs.algorithm ?? "Perlin noise flow field",
        exportFormats: ["SVG", "PNG 2x", "WebP"],
      };

    case "canvas-design":
      return {
        title: `${name} — Canvas Layout Plan`,
        layouts: [
          { name: "Hero Banner", dimensions: "1200×628", elements: ["Logo", "Headline", "Subheading", "CTA button"] },
          { name: "Social Square", dimensions: "1080×1080", elements: ["Brand mark", "Key stat", "Background pattern"] },
          { name: "Infographic", dimensions: "800×2000", elements: ["Title", "5-step flow", "Data callouts", "Footer"] },
        ],
      };

    case "slack-gif-creator":
      return {
        title: `${name} — GIF Pack Plan`,
        scenes: [
          { name: "Celebration", duration: "2s", description: "Confetti burst with brand colours and a checkmark" },
          { name: "Loading",     duration: "1.5s", description: "Animated spinner with logo mark" },
          { name: "Error",       duration: "1s",   description: "Gentle shake + red flash" },
          { name: "Thinking",    duration: "2s",   description: "Three dots animation in brand accent colour" },
        ],
        exportNote: "Export each scene as 128×128 GIF, max 256KB for Slack emoji upload.",
      };

    default:
      return { title: `${name} — ${meta.name} Artifact`, note: "Generated by Elyra Studio." };
  }
}

// ── GET — provider status ──────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    ok: true,
    modules: MODULE_REGISTRY,
    providerStatus: getProviderStatuses(),
  });
}

// ── POST — generate ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    moduleId?: string;
    inputs?: Record<string, string>;
    provider?: string;
    useReasoning?: boolean;
    workspaceId?: string;
  } | null;

  if (!body?.moduleId) {
    return NextResponse.json({ ok: false, code: "MODULE_REQUIRED", error: "moduleId is required." }, { status: 400 });
  }

  const meta = getModuleMeta(body.moduleId);
  if (!meta) {
    return NextResponse.json(
      { ok: false, code: "UNKNOWN_MODULE", error: `Unknown module: ${body.moduleId}. Available: ${MODULE_REGISTRY.map((m) => m.id).join(", ")}` },
      { status: 400 },
    );
  }

  const inputs: Record<string, string> = body.inputs ?? {};
  const provider = resolveProvider(body.provider ?? meta.defaultProvider);
  const useReasoning = body.useReasoning === true;
  const providerStatuses = getProviderStatuses();
  const providerStatus = providerStatuses[provider];

  if (!providerStatus.configured) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        error: formatProviderIssues(providerStatus),
        details: providerStatus.issues,
        providerStatus: providerStatuses,
      },
      { status: 503 },
    );
  }

  // ── Try backbone ───────────────────────────────────────────────────────────
  try {
    const backboneBody = {
      intent: `Generate ${meta.name} artifact for: ${inputs.name ?? inputs.brand ?? inputs.topic ?? "this project"}`,
      context: {
        app: "studio",
        moduleId: meta.id,
        moduleName: meta.name,
        outputType: meta.outputType,
        inputs,
        provider,
        providerLabel: providerStatus.label,
        model: providerStatus.model,
        reasoning: useReasoning,
      },
      workspaceId: body.workspaceId,
    };

    const payload = await forwardToWorkerOs({
      path: "/v1/os/generate/studio",
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
      body: backboneBody,
    });

    return NextResponse.json({
      ok: true,
      source: "ai",
      moduleId: meta.id,
      moduleName: meta.name,
      outputType: meta.outputType,
      provider,
      providerLabel: providerStatus.label,
      useReasoning,
      ...payload,
    });
  } catch (error) {
    // Backbone unavailable or endpoint not found → local fallback (always safe)
    if (!(error instanceof WorkerProxyError) || error.status === 503 || error.status === 502 || error.status === 404 || error.status === 405) {
      const artifact = buildLocalArtifact(meta.id as StudioModuleId, inputs, meta);
      return NextResponse.json({
        ok: true,
        source: "local",
        moduleId: meta.id,
        moduleName: meta.name,
        outputType: meta.outputType,
        provider,
        providerLabel: "Local template",
        useReasoning: false,
        warning: "AI backbone unavailable — a template artifact was generated instead.",
        artifact,
      });
    }

    if (error instanceof WorkerProxyError) {
      const payload = error.payload && typeof error.payload === "object" ? (error.payload as Record<string, unknown>) : null;
      return NextResponse.json(
        {
          ok: false,
          code: typeof payload?.error_code === "string" ? payload.error_code : "UPSTREAM_ERROR",
          error: typeof payload?.message === "string" ? payload.message : error.message,
          providerStatus: providerStatuses,
        },
        { status: error.status >= 400 ? error.status : 503 },
      );
    }

    return NextResponse.json({ ok: false, code: "UNEXPECTED_FAILURE", error: "Studio generation failed." }, { status: 500 });
  }
}
