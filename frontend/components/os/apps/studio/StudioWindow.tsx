"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Book,
  Bot,
  CheckCircle2,
  ChevronRight,
  Code2,
  FileText,
  Image,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  Palette,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

// ── Types ─────────────────────────────────────────────────────────────────────

type StudioModuleId =
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

type ModuleTag = "brand" | "docs" | "comms" | "build" | "design" | "ai";
type OutputType = "document" | "slides" | "code" | "asset" | "config";
type ProviderId = "gemini" | "claude_vertex";

type WizardField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "color" | "select";
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

type ModuleDef = {
  id: StudioModuleId;
  name: string;
  description: string;
  tags: ModuleTag[];
  outputType: OutputType;
  defaultProvider: ProviderId;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  bg: string;
  fields: WizardField[];
};

type RunPhase = "idle" | "plan" | "execute" | "review" | "done" | "error";

type RunState = {
  phase: RunPhase;
  artifact: Record<string, unknown> | null;
  source: "ai" | "local" | null;
  warning: string | null;
  error: string | null;
  provider: ProviderId | null;
};

type ProviderStatus = {
  configured: boolean;
  label: string;
  model: string;
  issues: string[];
};

// ── Module Definitions ────────────────────────────────────────────────────────

const MODULES: ModuleDef[] = [
  {
    id: "brand-guidelines",
    name: "Brand Guidelines",
    description: "Brand book: logo usage, colours, typography, voice & do/don'ts.",
    tags: ["brand", "docs"],
    outputType: "document",
    defaultProvider: "gemini",
    icon: Book,
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.10)",
    fields: [
      { key: "name",         label: "Brand / Company name", type: "text",    placeholder: "Elyra", required: true },
      { key: "mission",      label: "Mission statement",    type: "textarea", placeholder: "We help teams work smarter with AI." },
      { key: "primaryColor", label: "Primary colour",       type: "color" },
      { key: "accentColor",  label: "Accent colour",        type: "color" },
      { key: "headingFont",  label: "Heading font",         type: "text",    placeholder: "Inter" },
      { key: "tone",         label: "Brand tone",           type: "select",  options: ["professional", "friendly", "bold", "minimal", "playful"] },
    ],
  },
  {
    id: "doc-coauthoring",
    name: "Doc Coauthoring",
    description: "Startup doc pack: one-pager, PRD, hiring scorecard, pitch summary.",
    tags: ["docs"],
    outputType: "document",
    defaultProvider: "claude_vertex",
    icon: FileText,
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.10)",
    fields: [
      { key: "name",     label: "Company / Project name", type: "text",    placeholder: "Fish-Delish",          required: true },
      { key: "problem",  label: "Problem being solved",   type: "textarea", placeholder: "Describe the problem…" },
      { key: "solution", label: "Your solution",          type: "textarea", placeholder: "How you solve it…" },
      { key: "stage",    label: "Stage",                  type: "select",   options: ["idea", "pre-seed", "seed", "series-a", "growth"] },
    ],
  },
  {
    id: "internal-comms",
    name: "Internal Comms",
    description: "Comms templates, Slack conventions, meeting-note formats & incident playbooks.",
    tags: ["comms", "docs"],
    outputType: "document",
    defaultProvider: "gemini",
    icon: MessageSquare,
    color: "#22c55e",
    bg: "rgba(34,197,94,0.10)",
    fields: [
      { key: "name",  label: "Team / Company name", type: "text",   placeholder: "Elyra Core",   required: true },
      { key: "tools", label: "Comms tools in use",  type: "text",   placeholder: "Slack, Notion, Google Meet" },
      { key: "tone",  label: "Preferred tone",      type: "select", options: ["formal", "casual", "direct", "warm"] },
    ],
  },
  {
    id: "mcp-builder",
    name: "MCP Builder",
    description: "Scaffold a connector: config schema, tool definitions, validation & docs.",
    tags: ["build", "ai"],
    outputType: "config",
    defaultProvider: "claude_vertex",
    icon: Settings2,
    color: "#f97316",
    bg: "rgba(249,115,22,0.10)",
    fields: [
      { key: "connectorName", label: "Connector name",    type: "text",   placeholder: "google-drive",    required: true },
      { key: "description",   label: "What it connects",  type: "textarea", placeholder: "Reads and writes files in Google Drive." },
      { key: "authType",      label: "Auth type",         type: "select", options: ["oauth2", "api_key", "basic", "service_account"] },
      { key: "scopes",        label: "OAuth scopes (csv)", type: "text",  placeholder: "https://www.googleapis.com/auth/drive.file" },
    ],
  },
  {
    id: "skill-creator",
    name: "Skill Creator",
    description: "Create an Agent Skill: schema, UI label, system prompt, default provider.",
    tags: ["build", "ai"],
    outputType: "config",
    defaultProvider: "claude_vertex",
    icon: Bot,
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.10)",
    fields: [
      { key: "skillName",        label: "Skill name",            type: "text",     placeholder: "Summarise Email",   required: true },
      { key: "description",      label: "What the skill does",   type: "textarea", placeholder: "Reads an email thread and returns a 3-bullet summary." },
      { key: "systemPromptHint", label: "System prompt hint",    type: "textarea", placeholder: "Always be concise. Output in bullet points." },
      { key: "provider",         label: "Default provider",      type: "select",   options: ["gemini", "claude_vertex"] },
    ],
  },
  {
    id: "theme-factory",
    name: "Theme Factory",
    description: "Design-system tokens: CSS custom properties and Tailwind config suggestions.",
    tags: ["design", "build"],
    outputType: "code",
    defaultProvider: "gemini",
    icon: Palette,
    color: "#ec4899",
    bg: "rgba(236,72,153,0.10)",
    fields: [
      { key: "name",          label: "Project / app name",  type: "text",  placeholder: "Elyra OS",      required: true },
      { key: "primaryColor",  label: "Primary colour",      type: "color" },
      { key: "accentColor",   label: "Accent colour",       type: "color" },
      { key: "bgColor",       label: "Background colour",   type: "color" },
      { key: "surfaceColor",  label: "Surface colour",      type: "color" },
    ],
  },
  {
    id: "web-artifacts-builder",
    name: "Web Artifacts Builder",
    description: "Landing page artifact with HTML/CSS sections and copy.",
    tags: ["build", "design"],
    outputType: "code",
    defaultProvider: "claude_vertex",
    icon: Code2,
    color: "#06b6d4",
    bg: "rgba(6,182,212,0.10)",
    fields: [
      { key: "name",    label: "Product / company name", type: "text",     placeholder: "Fish-Delish",  required: true },
      { key: "tagline", label: "Tagline",                type: "text",     placeholder: "The freshest AI meal planner." },
      { key: "features", label: "Key features (use ·)",  type: "textarea", placeholder: "AI meal planning · Smart shopping list · Nutrition insights" },
      { key: "ctaText", label: "CTA button text",        type: "text",     placeholder: "Start for free" },
    ],
  },
  {
    id: "algorithmic-art",
    name: "Algorithmic Art",
    description: "Generative art concept: flow fields, palettes, SVG compositions.",
    tags: ["design"],
    outputType: "asset",
    defaultProvider: "gemini",
    icon: Sparkles,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    fields: [
      { key: "name",         label: "Series / piece name", type: "text",     placeholder: "Elyra Flows",   required: true },
      { key: "concept",      label: "Generative concept",  type: "textarea", placeholder: "Perlin noise flow field with gradient cycling." },
      { key: "primaryColor", label: "Primary colour",      type: "color" },
      { key: "accentColor",  label: "Accent colour",       type: "color" },
      { key: "algorithm",    label: "Algorithm hint",       type: "select",  options: ["perlin-flow", "voronoi", "l-system", "reaction-diffusion", "cellular-automata"] },
    ],
  },
  {
    id: "canvas-design",
    name: "Canvas Design",
    description: "Layout plans: wireframes, social assets, infographic compositions.",
    tags: ["design"],
    outputType: "asset",
    defaultProvider: "gemini",
    icon: Layers,
    color: "#10b981",
    bg: "rgba(16,185,129,0.10)",
    fields: [
      { key: "name",    label: "Brand / project name", type: "text",   placeholder: "Elyra",          required: true },
      { key: "formats", label: "Output formats",       type: "select", options: ["hero-banner", "social-square", "infographic", "all"] },
    ],
  },
  {
    id: "slack-gif-creator",
    name: "Slack GIF Creator",
    description: "GIF pack plan: scene storyboard and export specs for Slack emoji packs.",
    tags: ["comms", "design"],
    outputType: "asset",
    defaultProvider: "gemini",
    icon: Image,
    color: "#ef4444",
    bg: "rgba(239,68,68,0.10)",
    fields: [
      { key: "name",         label: "Brand / pack name",   type: "text",  placeholder: "Elyra Reactions",  required: true },
      { key: "primaryColor", label: "Brand colour",        type: "color" },
    ],
  },
];

const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<StudioModuleId, ModuleDef>;

const TAG_LABELS: Record<ModuleTag, string> = {
  brand: "Brand", docs: "Docs", comms: "Comms", build: "Build", design: "Design", ai: "AI",
};

const OUTPUT_ICONS: Record<OutputType, React.ComponentType<{ size?: number; className?: string }>> = {
  document: FileText, slides: Package, code: Code2, asset: Image, config: Settings2,
};

const STUDIO_LANES: Array<{
  id: "design" | "growth" | "presentations" | "automation";
  label: string;
  description: string;
  modules: StudioModuleId[];
}> = [
  {
    id: "design",
    label: "Design Agent",
    description: "UI systems, themes, layout artifacts and visual direction.",
    modules: ["theme-factory", "canvas-design", "algorithmic-art"],
  },
  {
    id: "growth",
    label: "Sales & Marketing Agent",
    description: "Brand, messaging, internal comms and growth-ready content.",
    modules: ["brand-guidelines", "internal-comms", "doc-coauthoring"],
  },
  {
    id: "presentations",
    label: "Presentation Agent",
    description: "Slides, storylines and visual asset planning.",
    modules: ["doc-coauthoring", "canvas-design", "slack-gif-creator"],
  },
  {
    id: "automation",
    label: "Automation Agent",
    description: "Connectors, skills and repeatable AI workflows.",
    modules: ["mcp-builder", "skill-creator", "web-artifacts-builder"],
  },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

function outputLabel(t: OutputType) {
  return { document: "Document", slides: "Slides", code: "Code", asset: "Asset", config: "Config" }[t];
}

function providerLabel(id: ProviderId) {
  return id === "claude_vertex" ? "Claude via Vertex" : "Gemini";
}

function phaseLabel(p: RunPhase) {
  return { idle: "Ready", plan: "Planning…", execute: "Generating…", review: "Reviewing…", done: "Complete", error: "Failed" }[p];
}

// ── ArtifactViewer ────────────────────────────────────────────────────────────

function ArtifactViewer({ artifact, outputType }: { artifact: Record<string, unknown>; outputType: OutputType }) {
  const borderCls = "rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-3";

  if (outputType === "code") {
    const cssVars = artifact.cssVars as string[] | undefined;
    const tailwindExtend = artifact.tailwindExtend as Record<string, unknown> | undefined;
    return (
      <div className="space-y-3">
        {cssVars && (
          <div className={borderCls}>
            <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">CSS Variables</p>
            <pre className="overflow-x-auto text-[11px] text-[color:var(--text-secondary)]">:root {"{\n  "}{cssVars.join("\n  ")}{"\n}"}</pre>
          </div>
        )}
        {tailwindExtend && (
          <div className={borderCls}>
            <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Tailwind extend</p>
            <pre className="overflow-x-auto text-[11px] text-[color:var(--text-secondary)]">{JSON.stringify(tailwindExtend, null, 2)}</pre>
          </div>
        )}
        {!cssVars && !tailwindExtend && (
          <pre className={`${borderCls} overflow-x-auto text-[11px] text-[color:var(--text-secondary)]`}>{JSON.stringify(artifact, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (outputType === "config") {
    return (
      <div className={borderCls}>
        <pre className="overflow-x-auto text-[11px] text-[color:var(--text-secondary)]">{JSON.stringify(artifact, null, 2)}</pre>
      </div>
    );
  }

  // document / asset / slides — render structured sections / scenes
  const str = (v: unknown): string => (v != null ? String(v) : "");
  const has = (v: unknown): boolean => v != null && v !== "";
  const sections = (artifact.sections ?? artifact.templates ?? artifact.documents ?? artifact.scenes ?? artifact.layouts) as Array<Record<string, unknown>> | undefined;
  return (
    <div className="space-y-3">
      {has(artifact.title) && (
        <h3 className="text-[16px] font-semibold text-[color:var(--text-primary)]">{str(artifact.title)}</h3>
      )}
      {sections?.map((section, idx) => {
        const heading = section.heading ?? section.name ?? section.section;
        return (
          <div key={idx} className={borderCls}>
            {has(heading) && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                {str(heading)}
              </p>
            )}
            {has(section.body) && <p className="text-[12px] text-[color:var(--text-secondary)]">{str(section.body)}</p>}
            {has(section.summary) && <p className="text-[12px] text-[color:var(--text-secondary)]">{str(section.summary)}</p>}
            {has(section.content) && (
              Array.isArray(section.content)
                ? <ul className="mt-1 list-inside list-disc space-y-0.5 text-[12px] text-[color:var(--text-secondary)]">{(section.content as string[]).map((item, i) => <li key={i}>{item}</li>)}</ul>
                : <p className="text-[12px] text-[color:var(--text-secondary)]">{str(section.content)}</p>
            )}
            {has(section.format) && <code className="mt-1 block text-[11px] text-[color:var(--text-muted)]">{str(section.format)}</code>}
            {has(section.description) && <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{str(section.description)}</p>}
            {has(section.duration) && <p className="mt-0.5 text-[10px] text-[color:var(--text-muted)]">Duration: {str(section.duration)}</p>}
            {has(section.dimensions) && <p className="mt-0.5 text-[10px] text-[color:var(--text-muted)]">Dimensions: {str(section.dimensions)}</p>}
          </div>
        );
      })}
      {!sections && <pre className={`${borderCls} overflow-x-auto text-[11px] text-[color:var(--text-secondary)]`}>{JSON.stringify(artifact, null, 2)}</pre>}
      {has(artifact.exportNote) && <p className="text-[11px] text-[color:var(--text-muted)]">{str(artifact.exportNote)}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function StudioWindow() {
  const [activeModule, setActiveModule] = useState<StudioModuleId | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<ModuleTag | "all">("all");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [useReasoning, setUseReasoning] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: "idle", artifact: null, source: null, warning: null, error: null, provider: null });
  const [providerStatuses, setProviderStatuses] = useState<Record<ProviderId, ProviderStatus> | null>(null);

  // Load provider statuses on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/os/studio/generate", { cache: "no-store" });
        const payload = (await res.json()) as { ok: boolean; providerStatus?: Record<ProviderId, ProviderStatus> };
        if (payload.ok && payload.providerStatus) {
          setProviderStatuses(payload.providerStatus);
        }
      } catch {
        // non-critical — statuses shown as unknown
      }
    })();
  }, []);

  const filteredModules = useMemo(() => {
    let list = MODULES;
    if (tagFilter !== "all") list = list.filter((m) => m.tags.includes(tagFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
    }
    return list;
  }, [search, tagFilter]);

  const openModule = useCallback((id: StudioModuleId) => {
    setActiveModule(id);
    setInputs({});
    setProvider(MODULE_MAP[id].defaultProvider);
    setUseReasoning(false);
    setRun({ phase: "idle", artifact: null, source: null, warning: null, error: null, provider: null });
  }, []);

  const closeModule = useCallback(() => {
    setActiveModule(null);
    setRun({ phase: "idle", artifact: null, source: null, warning: null, error: null, provider: null });
  }, []);

  const runModule = useCallback(async () => {
    if (!activeModule) return;
    setRun({ phase: "plan", artifact: null, source: null, warning: null, error: null, provider });

    // Simulate Plan phase briefly then move to execute
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRun((prev) => ({ ...prev, phase: "execute" }));

    try {
      const headers = await withSupabaseAuthorization({ "content-type": "application/json" });
      const response = await fetch("/api/os/studio/generate", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ moduleId: activeModule, inputs, provider, useReasoning }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        artifact?: Record<string, unknown>;
        source?: "ai" | "local";
        warning?: string;
        error?: string;
        provider?: ProviderId;
      };

      if (!response.ok || !payload.ok) {
        setRun({ phase: "error", artifact: null, source: null, warning: null, error: payload.error ?? "Generation failed.", provider });
        return;
      }

      setRun((prev) => ({ ...prev, phase: "review" }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      setRun({
        phase: "done",
        artifact: payload.artifact ?? null,
        source: payload.source ?? null,
        warning: payload.warning ?? null,
        error: null,
        provider: payload.provider ?? provider,
      });
    } catch (err) {
      setRun({ phase: "error", artifact: null, source: null, warning: null, error: err instanceof Error ? err.message : "Request failed.", provider });
    }
  }, [activeModule, inputs, provider, useReasoning]);

  // ── Catalog view ────────────────────────────────────────────────────────────
  if (!activeModule) {
    const allTags = Array.from(new Set(MODULES.flatMap((m) => m.tags)));

    return (
      <div className="flex h-full flex-col overflow-hidden bg-[color:var(--bg-canvas)] text-[color:var(--text-primary)]">
        {/* Header */}
        <header className="border-b border-[color:var(--os-border-soft)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]">
              <Wand2 size={16} className="text-[color:var(--text-muted)]" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Studio</h2>
              <p className="text-[11px] text-[color:var(--text-muted)]">AI-powered content & artifact modules</p>
            </div>
            {providerStatuses && (
              <div className="ml-auto flex items-center gap-2">
                {(Object.entries(providerStatuses) as Array<[ProviderId, ProviderStatus]>).map(([id, status]) => (
                  <span
                    key={id}
                    title={status.issues.length > 0 ? status.issues.join(" ") : `${status.label} · ${status.model}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                      status.configured
                        ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-700"
                        : "border-amber-300/40 bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${status.configured ? "bg-emerald-500" : "bg-amber-400"}`} />
                    {id === "claude_vertex" ? "Claude" : "Gemini"}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Search + tag filter */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search modules…"
                className="w-full rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] py-1.5 pl-7 pr-3 text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)] focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setTagFilter("all")}
                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] transition ${tagFilter === "all" ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]" : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"}`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag as ModuleTag)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] transition ${tagFilter === tag ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]" : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"}`}
                >
                  {TAG_LABELS[tag as ModuleTag]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {STUDIO_LANES.map((lane) => {
              const firstModule = lane.modules[0];
              if (!firstModule) return null;
              return (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => openModule(firstModule)}
                  className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-3 text-left transition hover:border-[color:var(--os-border-strong)]"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                    {lane.label}
                  </p>
                  <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{lane.description}</p>
                  <p className="mt-2 text-[10px] text-[color:var(--text-muted)]">
                    Starts with {MODULE_MAP[firstModule].name}
                  </p>
                </button>
              );
            })}
          </div>
        </header>

        {/* Module grid */}
        <div className="flex-1 overflow-auto p-4">
          {filteredModules.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-[color:var(--text-muted)]">No modules match your search.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredModules.map((mod) => {
                const Icon = mod.icon;
                const OutputIcon = OUTPUT_ICONS[mod.outputType];
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => openModule(mod.id)}
                    className="group flex flex-col rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4 text-left transition hover:border-[color:var(--os-border-strong)] hover:bg-[color:var(--bg-surface-soft)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--os-border-soft)]" style={{ background: mod.bg }}>
                        <Icon size={18} style={{ color: mod.color }} />
                      </div>
                      <ChevronRight size={14} className="mt-1 text-[color:var(--text-muted)] opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <h3 className="mt-3 text-[13px] font-semibold text-[color:var(--text-primary)]">{mod.name}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--text-muted)]">{mod.description}</p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <OutputIcon size={10} className="text-[color:var(--text-muted)]" />
                      <span className="text-[10px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">{outputLabel(mod.outputType)}</span>
                      <span className="text-[color:var(--text-muted)] opacity-40">·</span>
                      <Zap size={10} className="text-[color:var(--text-muted)]" />
                      <span className="text-[10px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">{providerLabel(mod.defaultProvider)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {mod.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-[color:var(--os-border-soft)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                          {TAG_LABELS[tag]}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Module wizard + run view ─────────────────────────────────────────────────
  const mod = MODULE_MAP[activeModule];
  const Icon = mod.icon;
  const isRunning = run.phase === "plan" || run.phase === "execute" || run.phase === "review";
  const canRun = !isRunning && mod.fields.filter((f) => f.required).every((f) => (inputs[f.key] ?? "").trim().length > 0);

  const phaseSteps: RunPhase[] = ["plan", "execute", "review", "done"];
  const currentPhaseIdx = phaseSteps.indexOf(run.phase);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[color:var(--bg-canvas)] text-[color:var(--text-primary)]">
      {/* Header */}
      <header className="border-b border-[color:var(--os-border-soft)] px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={closeModule}
            className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[11px] text-[color:var(--text-muted)] transition hover:text-[color:var(--text-primary)]"
          >
            <ArrowLeft size={11} /> Modules
          </button>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg border border-[color:var(--os-border-soft)]" style={{ background: mod.bg }}>
              <Icon size={13} style={{ color: mod.color }} />
            </div>
            <span className="text-[14px] font-semibold text-[color:var(--text-primary)]">{mod.name}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Wizard */}
        <aside className="flex w-[260px] flex-shrink-0 flex-col border-r border-[color:var(--os-border-soft)]">
          <div className="flex-1 overflow-auto p-4">
            <p className="mb-3 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Inputs</p>
            <div className="space-y-3">
              {mod.fields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-[11px] font-medium text-[color:var(--text-secondary)]">
                    {field.label}{field.required && <span className="ml-0.5 text-rose-400">*</span>}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      rows={3}
                      value={inputs[field.key] ?? ""}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full resize-none rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-2 text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)] focus:outline-none"
                    />
                  ) : field.type === "color" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={inputs[field.key] ?? "#6C9CFC"}
                        onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="h-8 w-12 cursor-pointer rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]"
                      />
                      <span className="text-[11px] text-[color:var(--text-muted)]">{inputs[field.key] ?? "#6C9CFC"}</span>
                    </div>
                  ) : field.type === "select" ? (
                    <select
                      value={inputs[field.key] ?? field.options?.[0] ?? ""}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-2 text-[12px] text-[color:var(--text-primary)] focus:border-[color:var(--os-border-strong)] focus:outline-none"
                    >
                      {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={inputs[field.key] ?? ""}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-2 text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)] focus:outline-none"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Provider + Reasoning */}
            <div className="mt-5 space-y-3 border-t border-[color:var(--os-border-soft)] pt-4">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Provider</p>
              <div className="flex gap-1.5">
                {(["gemini", "claude_vertex"] as ProviderId[]).map((pid) => {
                  const status = providerStatuses?.[pid];
                  const ok = status?.configured ?? (pid === "gemini");
                  return (
                    <button
                      key={pid}
                      type="button"
                      disabled={!ok}
                      onClick={() => setProvider(pid)}
                      title={!ok && status ? status.issues.join(" ") : undefined}
                      className={`flex-1 rounded-xl border px-2 py-1.5 text-[10px] transition ${
                        provider === pid
                          ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                          : ok
                            ? "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
                            : "cursor-not-allowed border-[color:var(--os-border-soft)] opacity-40"
                      }`}
                    >
                      {pid === "claude_vertex" ? "Claude" : "Gemini"}
                      {!ok && <AlertCircle size={10} className="ml-1 inline" />}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[color:var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={useReasoning}
                  onChange={(e) => setUseReasoning(e.target.checked)}
                  className="rounded"
                />
                Use reasoning
              </label>
            </div>
          </div>

          {/* Run button */}
          <div className="border-t border-[color:var(--os-border-soft)] p-4">
            <button
              type="button"
              disabled={!canRun}
              onClick={() => void runModule()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-4 py-2.5 text-[12px] font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {isRunning ? phaseLabel(run.phase) : "Generate"}
            </button>
          </div>
        </aside>

        {/* Right: Run timeline + artifact output */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Run phase indicator */}
          {run.phase !== "idle" && (
            <div className="flex items-center gap-3 border-b border-[color:var(--os-border-soft)] px-5 py-2.5">
              {phaseSteps.map((step, idx) => {
                const isActive = step === run.phase;
                const isDone   = currentPhaseIdx > idx || run.phase === "done";
                return (
                  <div key={step} className="flex items-center gap-1.5">
                    {idx > 0 && <span className="text-[color:var(--text-muted)] opacity-30">›</span>}
                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.06em] ${
                      isDone ? "text-emerald-600" : isActive ? "text-[color:var(--text-primary)]" : "text-[color:var(--text-muted)]"
                    }`}>
                      {isDone && <CheckCircle2 size={10} />}
                      {isActive && <Loader2 size={10} className="animate-spin" />}
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-auto p-5">
            {/* Idle state */}
            {run.phase === "idle" && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--os-border-soft)]" style={{ background: mod.bg }}>
                  <Icon size={24} style={{ color: mod.color }} />
                </div>
                <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{mod.name}</p>
                <p className="max-w-xs text-[12px] text-[color:var(--text-muted)]">{mod.description}</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">Fill in the inputs on the left, then click <strong>Generate</strong>.</p>
              </div>
            )}

            {/* Running state */}
            {(run.phase === "plan" || run.phase === "execute" || run.phase === "review") && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Sparkles size={32} className="animate-pulse text-[color:var(--text-muted)]" />
                <p className="text-[14px] font-medium text-[color:var(--text-primary)]">{phaseLabel(run.phase)}</p>
                <p className="text-[12px] text-[color:var(--text-muted)]">
                  {run.phase === "plan" ? "Building a generation plan…" : run.phase === "execute" ? "Generating your artifact…" : "Reviewing and finalising…"}
                </p>
              </div>
            )}

            {/* Error state */}
            {run.phase === "error" && (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-500/8 p-5">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertCircle size={16} />
                  <p className="font-medium">Generation failed</p>
                </div>
                <p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">{run.error}</p>
                {providerStatuses && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Provider Status</p>
                    {(Object.entries(providerStatuses) as Array<[ProviderId, ProviderStatus]>).map(([pid, status]) => (
                      <div key={pid} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-[color:var(--text-primary)]">{status.label}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${status.configured ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-700" : "border-amber-300/40 bg-amber-500/10 text-amber-700"}`}>
                            {status.configured ? "ready" : "not configured"}
                          </span>
                        </div>
                        {status.issues.map((issue) => (
                          <p key={issue} className="mt-1 text-[11px] text-amber-700">{issue}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void runModule()}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            )}

            {/* Done — artifact output */}
            {run.phase === "done" && run.artifact && (
              <div className="space-y-4">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Artifact ready</p>
                  {run.source && (
                    <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] ${
                      run.source === "ai"
                        ? "border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)]"
                        : "border-amber-300/40 bg-amber-500/10 text-amber-700"
                    }`}>
                      {run.source === "ai" ? `${providerLabel(run.provider ?? provider)} · AI` : "Local template"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void runModule()}
                    className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>

                {/* Warning */}
                {run.warning && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-500/8 px-3 py-2">
                    <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <p className="text-[11px] text-amber-700">{run.warning}</p>
                  </div>
                )}

                {/* Artifact content */}
                <ArtifactViewer artifact={run.artifact} outputType={mod.outputType} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
