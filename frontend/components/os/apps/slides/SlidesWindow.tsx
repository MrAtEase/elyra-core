"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Download, ChevronLeft, ChevronRight, Plus, Layout,
  X, Loader2, FileText, AlignLeft, Maximize2, PanelRight, Check,
  Palette, MoreHorizontal, GripVertical, Image, Type, Bold, Italic,
  List, Trash2, Copy, ArrowUp, ArrowDown,
} from "lucide-react";
import { fetchArtifactById } from "@/components/os/kernel/aiClient";
import { eventBus } from "@/components/os/kernel/eventBus";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import type { WorkspaceArtifact } from "@/components/os/kernel/types";

import {
  DEFAULT_SLIDE_THEME, PrintDeck, SLIDE_THEMES, SlideCanvas, SlideThumbnail, normalizeSlide, resolveSlideTheme,
  type DeckSlide, type SlideThemeKey,
} from "./slideDesign";

// ── Types ─────────────────────────────────────────────────────────────────────

type Deck = {
  id: string;
  title: string;
  slides: DeckSlide[];
  updatedAt?: string;
  source: "artifact" | "sample" | "generated";
  theme?: SlideThemeKey;
  providerLabel?: string;
};

type PublishedDeckLink = {
  presentationId: string;
  openUrl: string;
};

// ── Sample Decks ──────────────────────────────────────────────────────────────

const SAMPLE_DECKS: Deck[] = [
  {
    id: "sample-q3",
    title: "Quartalsplanung",
    source: "sample",
    theme: "executive",
    slides: [
      { title: "Quartalsplanung", body: "Wo wir stehen, wohin wir wollen – und was wir heute entscheiden.", layout: "title",
        notes: "Kurz begrüßen, Ziel des Termins nennen: drei Entscheidungen bis 11 Uhr." },
      { title: "Agenda", body: "", layout: "agenda",
        bullets: ["Ergebnisse auf einen Blick", "Marktchance", "Wo wir gewinnen", "Fahrplan", "Entscheidungen"] },
      { title: "Wachstum über Plan – die Marge ist der nächste Hebel", body: "Der Umsatz liegt über Ziel, die Akquisekosten sinken weiter.", layout: "stats",
        stats: [{ value: "+23 %", label: "Umsatz ggü. Vorjahr" }, { value: "−32 %", label: "Kosten pro Neukunde" }, { value: "58", label: "NPS (vorher 42)" }],
        source: "Beispieldaten" },
      { title: "Wir gewinnen, wo Tempo und Automatisierung zählen", body: "Am stärksten sind wir bei kleinen Teams, die Ergebnisse ohne Agentur brauchen.", layout: "comparison",
        columns: [
          { heading: "Klassische Agentur", points: ["Wochen bis zur ersten Kampagne", "Reporting per Hand", "Undurchsichtige Gebühren"] },
          { heading: "Unsere Plattform", points: ["Live in 48 Stunden", "Automatisches Echtzeit-Reporting", "Transparenter Monatspreis"] },
        ] },
      { title: "Drei Phasen bis zur Enterprise-Reife", body: "Jede Phase endet mit einem klaren Go / No-Go.", layout: "timeline",
        steps: [
          { label: "Fundament", detail: "Produkt-Parität und Onboarding in 30 Tagen" },
          { label: "Wachstum", detail: "Self-Service-Funnel und Partnerkanal in 60 Tagen" },
          { label: "Enterprise", detail: "SSO, Audit-Log und SLAs in 90 Tagen" },
        ] },
      { title: "Was wir heute entscheiden", body: "Damit startet das Quartal planmäßig.", layout: "closing",
        bullets: ["Budget freigeben", "Zwei Vertriebsstellen ausschreiben", "Kick-off bestätigen"] },
    ],
  },
  {
    id: "sample-brand",
    title: "Markenauftritt",
    source: "sample",
    theme: "editorial",
    slides: [
      { title: "Markenauftritt", body: "Haltung, Gestaltung und Einführung.", layout: "title" },
      { title: "Eine Marke ist ein Versprechen", body: "", layout: "quote",
        quote: { text: "Eine Marke ist ein Versprechen, das man immer wieder hält – an jedem Kontaktpunkt, nicht nur im Logo.", author: "Gestaltungsprinzip" } },
      { title: "Visuelle Richtung", body: "Vier Anker für jede Gestaltungsentscheidung.", layout: "bullets",
        bullets: ["Ruhige, organische Formen", "Tiefes Blau mit genau einem Akzent", "Ein variables Schriftsystem", "Bewegung mit Absicht"] },
      { title: "Einführung in drei Schritten", body: "", layout: "timeline",
        steps: [
          { label: "Intern", detail: "Team und Vorlagen umstellen" },
          { label: "Digital", detail: "Website, Social, Newsletter" },
          { label: "Überall", detail: "Print, Messe, Verpackung" },
        ] },
    ],
  },
];

// ── Helper functions ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toSlide(value: unknown): DeckSlide | null {
  return normalizeSlide(value);
}

function deckFromPayload(payload: Record<string, unknown>, fallbackTitle: string): Deck | null {
  const nestedDeck = asRecord(payload.deck);
  const source = nestedDeck ?? payload;
  const rawSlides = Array.isArray(source.slides) ? source.slides : null;
  if (!rawSlides || rawSlides.length === 0) return null;
  const slides = rawSlides.map(toSlide).filter((s): s is DeckSlide => s !== null);
  if (slides.length === 0) return null;
  const title = typeof source.title === "string" ? source.title : fallbackTitle;
  return { id: fallbackTitle, title, slides, source: "artifact" };
}

function artifactToDeck(artifact: WorkspaceArtifact): Deck | null {
  const direct = deckFromPayload(artifact.payloadJson, artifact.title);
  if (direct) return { ...direct, id: artifact.id, title: direct.title || artifact.title, updatedAt: artifact.updatedAt };
  const versionPayload = artifact.versions?.[0]?.contentJson;
  if (versionPayload) {
    const fromVersion = deckFromPayload(versionPayload, artifact.title);
    if (fromVersion) return { ...fromVersion, id: artifact.id, title: fromVersion.title || artifact.title, updatedAt: artifact.updatedAt };
  }
  return null;
}

function formatArtifactDate(value: string | undefined): string {
  if (!value) return "";
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(stamp);
}

// ── Generate Modal ────────────────────────────────────────────────────────────

type RemoteProviderStatus = {
  configured: boolean;
  label: string;
  reasoningSupported: boolean;
  issues: string[];
  model: string;
};

const GB_TONES = ["Inspiring", "Professional", "Conversational", "Authoritative", "Playful"];
const GB_AUDIENCES = ["Executive", "Technical", "General", "Sales", "Investors", "Team"];
const STYLES = ["pitchdeck", "professional", "creative", "minimal", "bold", "narrative"];
const STYLE_LABELS: Record<string, string> = {
  pitchdeck: "Pitch-Deck", professional: "Professionell", creative: "Kreativ", minimal: "Minimal", bold: "Plakativ", narrative: "Erzählend",
};
const GB_LABELS: Record<string, string> = {
  Inspiring: "Inspirierend", Professional: "Professionell", Conversational: "Locker", Authoritative: "Souverän", Playful: "Verspielt",
  Executive: "Geschäftsführung", Technical: "Technik", General: "Allgemein", Sales: "Vertrieb", Investors: "Investoren", Team: "Team",
};

function GenerateModal({
  onGenerate,
  onClose,
  workspaceId,
  initialPrompt,
}: {
  onGenerate: (deck: Deck) => void;
  onClose: () => void;
  workspaceId: string;
  initialPrompt?: string;
}) {
  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"quick" | "graphicsbook">("quick");
  const [gbStep, setGbStep] = useState(1); // 1 = topic, 2 = audience/objectives, 3 = visual

  // ── Quick generate fields ─────────────────────────────────────────────────
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [style, setStyle] = useState("professional");
  const [theme, setTheme] = useState<SlideThemeKey>(DEFAULT_SLIDE_THEME);
  const [provider, setProvider] = useState<"gemini" | "claude_vertex">("gemini");
  const [useReasoning, setUseReasoning] = useState(false);
  const [research, setResearch] = useState(true);

  // ── Graphicsbook fields ───────────────────────────────────────────────────
  const [gbTopic, setGbTopic] = useState("");
  const [gbContext, setGbContext] = useState("");
  const [gbAudience, setGbAudience] = useState("Executive");
  const [gbObjective, setGbObjective] = useState("");
  const [gbTone, setGbTone] = useState("Professional");
  const [gbTheme, setGbTheme] = useState<SlideThemeKey>(DEFAULT_SLIDE_THEME);
  const [gbSlideCount, setGbSlideCount] = useState(8);

  // ── Provider status ───────────────────────────────────────────────────────
  const [providerStatuses, setProviderStatuses] = useState<Record<"gemini" | "claude_vertex", RemoteProviderStatus> | null>(null);

  useEffect(() => {
    fetch("/api/os/slides/generate")
      .then((r) => r.json())
      .then((data: { ok?: boolean; providerStatus?: Record<"gemini" | "claude_vertex", RemoteProviderStatus> }) => {
        if (data.ok && data.providerStatus) setProviderStatuses(data.providerStatus);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt) return;
    setTopic(prompt);
    setGbTopic(prompt);
  }, [initialPrompt]);

  // ── Shared state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const providerOptions: { value: "gemini" | "claude_vertex"; label: string; description: string; reasoningSupported: boolean }[] = [
    { value: "gemini", label: "Gemini", description: "Standard – über den Worker", reasoningSupported: true },
    { value: "claude_vertex", label: "Claude via Vertex", description: "Benötigt Vertex-Zugangsdaten", reasoningSupported: true },
  ];
  const selectedProvider = providerOptions.find((o) => o.value === provider) ?? providerOptions[0]!;

  async function runGenerate(opts: { topic: string; slideCount: number; style: string; theme: SlideThemeKey; provider: "gemini" | "claude_vertex"; useReasoning: boolean; extra?: Record<string, string> }) {
    setLoading(true);
    setError("");
    setWarning("");
    try {
      const res = await fetch("/api/os/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: opts.extra
            ? `${opts.topic}${opts.extra.context ? ` — Context: ${opts.extra.context}` : ""}${opts.extra.audience ? `. Audience: ${opts.extra.audience}` : ""}${opts.extra.objective ? `. Objective: ${opts.extra.objective}` : ""}${opts.extra.tone ? `. Tone: ${opts.extra.tone}` : ""}`
            : opts.topic,
          slideCount: opts.slideCount,
          style: opts.style,
          workspaceId,
          provider: opts.provider,
          useReasoning: opts.useReasoning,
          research,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        deck?: { title: string; slides: DeckSlide[] };
        providerLabel?: string;
        error?: string;
        code?: string;
        details?: string[];
        warning?: string;
      };
      if (!data.ok || !data.deck) {
        const detailText = Array.isArray(data.details) && data.details.length > 0 ? ` ${data.details.join(" ")}` : "";
        throw new Error(`${data.error ?? "Erstellung fehlgeschlagen."}${detailText}`.trim());
      }
      const deck: Deck = {
        id: `gen-${Date.now()}`,
        title: data.deck.title,
        slides: data.deck.slides.map(normalizeSlide).filter((s): s is DeckSlide => s !== null),
        source: "generated",
        theme: opts.theme,
        providerLabel: data.providerLabel ?? (opts.provider === "claude_vertex" ? "Claude" : "Gemini"),
      };
      if (data.warning) setWarning(data.warning);
      onGenerate(deck);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Etwas ist schiefgelaufen.");
    } finally {
      setLoading(false);
    }
  }

  const researchToggle = (
    <button
      type="button"
      onClick={() => setResearch((c) => !c)}
      className="relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition"
      style={{ background: research ? "rgba(92,204,255,0.08)" : "rgba(255,255,255,0.04)", borderColor: research ? "rgba(92,204,255,0.35)" : "rgba(255,255,255,0.08)" }}
    >
      <span className="flex-1 pr-12">
        <span className="block text-xs font-medium text-white/85">Web-Recherche</span>
        <span className="block text-[10px] text-white/45">{research ? "Recherchiert aktuelle Zahlen & Fakten mit Google-Suche, Quellen auf jeder Folie und am Ende." : "Aus – nur allgemeines Modellwissen, keine konkreten Zahlen."}</span>
      </span>
      <span className="absolute right-3 top-1/2 h-5 w-9 -translate-y-1/2 rounded-full transition-colors" style={{ background: research ? "#5cf" : "rgba(255,255,255,0.12)" }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: research ? "translateX(18px)" : "translateX(2px)" }} />
      </span>
    </button>
  );

  function handleQuickGenerate() {
    if (!topic.trim()) { setError("Bitte gib ein Thema ein."); return; }
    void runGenerate({ topic: topic.trim(), slideCount, style, theme, provider, useReasoning });
  }

  function handleGraphicsbookGenerate() {
    if (!gbTopic.trim()) { setError("Bitte gib ein Thema ein."); return; }
    void runGenerate({
      topic: gbTopic.trim(),
      slideCount: gbSlideCount,
      style: "narrative",
      theme: gbTheme,
      provider,
      useReasoning: true,
      extra: { context: gbContext, audience: gbAudience, objective: gbObjective, tone: gbTone },
    });
  }

  // ── Provider status badge ─────────────────────────────────────────────────
  function ProviderBadge({ id }: { id: "gemini" | "claude_vertex" }) {
    if (!providerStatuses) return <span className="text-[9px] text-white/25">prüfe…</span>;
    const st = providerStatuses[id];
    return st.configured
      ? <span className="text-[9px] text-emerald-400">✓ Bereit</span>
      : <span className="text-[9px] text-red-400">✗ Nicht eingerichtet</span>;
  }

  // ── Theme grid ────────────────────────────────────────────────────────────
  function ThemeGrid({ value, onChange }: { value: SlideThemeKey; onChange: (k: SlideThemeKey) => void }) {
    return (
      <>
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(SLIDE_THEMES) as SlideThemeKey[]).map((key) => {
            const t = SLIDE_THEMES[key];
            return (
              <button key={key} type="button" onClick={() => onChange(key)} title={t.label}
                className="group relative overflow-hidden rounded-lg border transition-all"
                style={{ aspectRatio: "16/10", background: t.bg, borderColor: value === key ? t.accent : "rgba(255,255,255,0.06)", boxShadow: value === key ? `0 0 0 1px ${t.accent}55` : undefined }}
              >
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: t.accent }} />
                {value === key && <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${t.accent}22` }}><Check size={10} style={{ color: t.accent }} /></div>}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-white/35">{SLIDE_THEMES[value].label}</p>
      </>
    );
  }

  const isGraphicsbook = mode === "graphicsbook";
  const totalSteps = 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div
        className="w-full overflow-hidden rounded-2xl border"
        style={{
          maxWidth: isGraphicsbook ? 560 : 480,
          background: "rgba(10,14,26,0.97)",
          backdropFilter: "blur(40px)",
          borderColor: "rgba(92,204,255,0.15)",
          boxShadow: "0 40px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(92,204,255,0.05)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(92,204,255,0.12)" }}>
              <Sparkles size={15} style={{ color: "#5cf" }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/90">Präsentation erstellen</p>
              <p className="text-[11px] text-white/45">
                {isGraphicsbook ? `Ausführlich · Schritt ${gbStep} von ${totalSteps}` : "Schnell mit KI erstellen"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex rounded-xl border p-0.5" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              {(["quick", "graphicsbook"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setGbStep(1); setError(""); }}
                  className="rounded-lg px-2.5 py-1 text-[10px] font-medium transition"
                  style={{
                    background: mode === m ? "rgba(92,204,255,0.18)" : "transparent",
                    color: mode === m ? "#5cf" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {m === "quick" ? "Schnell" : "Ausführlich"}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/8 hover:text-white/70">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {!isGraphicsbook ? (
            /* ── Quick Mode ────────────────────────────────────────────────── */
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Thema oder Auftrag</label>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="z. B. Produktvorstellung, Quartalsplanung, Pitch für Investoren…"
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl border px-4 py-3 text-sm text-white/90 placeholder-white/25 outline-none transition focus:border-[#5cf]/50"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleQuickGenerate(); }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Folien</label>
                  <div className="flex items-center gap-2">
                    <input type="range" min={3} max={12} value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))} className="flex-1" />
                    <span className="w-6 text-center text-sm font-medium text-white/75">{slideCount}</span>
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Stil</label>
                  <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm text-white/85 outline-none" style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}>
                    {STYLES.map((s) => <option key={s} value={s} style={{ background: "#0d1117" }}>{STYLE_LABELS[s] ?? s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 flex items-center justify-between text-xs font-medium tracking-wide text-white/55">
                    <span>KI-Modell</span>
                  </label>
                  <div className="space-y-1.5">
                    {providerOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setProvider(opt.value); if (!opt.reasoningSupported) setUseReasoning(false); }}
                        className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition"
                        style={{
                          background: provider === opt.value ? "rgba(92,204,255,0.1)" : "rgba(255,255,255,0.03)",
                          borderColor: provider === opt.value ? "rgba(92,204,255,0.35)" : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <div>
                          <p className="text-xs font-medium" style={{ color: provider === opt.value ? "#5cf" : "rgba(255,255,255,0.75)" }}>{opt.label}</p>
                          <ProviderBadge id={opt.value} />
                        </div>
                        {provider === opt.value && <Check size={12} style={{ color: "#5cf" }} />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Denktiefe</label>
                  <button
                    type="button"
                    onClick={() => selectedProvider.reasoningSupported && setUseReasoning((c) => !c)}
                    disabled={!selectedProvider.reasoningSupported}
                    className="relative flex h-[42px] w-full items-center rounded-xl border px-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.85)" }}
                  >
                    <span className="pr-12 text-xs">{useReasoning ? "Gründlicher planen" : "Schnell"}</span>
                    <span className="absolute right-3 top-1/2 h-5 w-9 -translate-y-1/2 rounded-full transition-colors" style={{ background: useReasoning ? "#5cf" : "rgba(255,255,255,0.12)" }}>
                      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: useReasoning ? "translateX(18px)" : "translateX(2px)" }} />
                    </span>
                  </button>
                  <p className="mt-1.5 text-[10px] text-white/35">{selectedProvider.reasoningSupported ? "Für dieses Modell verfügbar." : "Nicht unterstützt."}</p>
                </div>
              </div>

              {researchToggle}

              <div>
                <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Design</label>
                <ThemeGrid value={theme} onChange={setTheme} />
              </div>
            </div>
          ) : (
            /* ── Graphicsbook Mode ──────────────────────────────────────────── */
            <div className="space-y-5">
              {/* Step progress */}
              <div className="flex items-center gap-2">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-all"
                      style={{
                        background: s < gbStep ? "#5cf" : s === gbStep ? "rgba(92,204,255,0.22)" : "rgba(255,255,255,0.06)",
                        color: s <= gbStep ? "#5cf" : "rgba(255,255,255,0.3)",
                        border: `1px solid ${s <= gbStep ? "#5cf44" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      {s < gbStep ? <Check size={10} /> : s}
                    </div>
                    {s < 3 && <div className="h-px flex-1" style={{ background: s < gbStep ? "rgba(92,204,255,0.4)" : "rgba(255,255,255,0.08)", width: 32 }} />}
                  </div>
                ))}
                <span className="ml-2 text-[10px] text-white/35">
                  {gbStep === 1 ? "Thema & Kontext" : gbStep === 2 ? "Publikum & Ziel" : "Design & Erstellen"}
                </span>
              </div>

              {/* Step 1: Topic + context */}
              {gbStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Worum geht es?</label>
                    <textarea
                      value={gbTopic}
                      onChange={(e) => setGbTopic(e.target.value)}
                      placeholder="z. B. Einführung unseres KI-Produkts in Portugal…"
                      rows={3}
                      autoFocus
                      className="w-full resize-none rounded-xl border px-4 py-3 text-sm text-white/90 placeholder-white/25 outline-none transition focus:border-[#5cf]/50"
                      style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Zusätzlicher Kontext <span className="text-white/25">(optional)</span></label>
                    <textarea
                      value={gbContext}
                      onChange={(e) => setGbContext(e.target.value)}
                      placeholder="Hintergrund, wichtige Zahlen, Rahmenbedingungen…"
                      rows={2}
                      className="w-full resize-none rounded-xl border px-4 py-3 text-sm text-white/90 placeholder-white/25 outline-none transition focus:border-[#5cf]/50"
                      style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Anzahl Folien</label>
                    <div className="flex items-center gap-3">
                      <input type="range" min={4} max={16} value={gbSlideCount} onChange={(e) => setGbSlideCount(Number(e.target.value))} className="flex-1" />
                      <span className="w-8 text-center text-sm font-medium text-white/75">{gbSlideCount}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Audience + objective + tone */}
              {gbStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Zielgruppe</label>
                    <div className="flex flex-wrap gap-2">
                      {GB_AUDIENCES.map((a) => (
                        <button key={a} type="button" onClick={() => setGbAudience(a)}
                          className="rounded-xl border px-3 py-1.5 text-xs font-medium transition"
                          style={{ background: gbAudience === a ? "rgba(92,204,255,0.15)" : "rgba(255,255,255,0.04)", borderColor: gbAudience === a ? "rgba(92,204,255,0.4)" : "rgba(255,255,255,0.08)", color: gbAudience === a ? "#5cf" : "rgba(255,255,255,0.65)" }}
                        >
                          {GB_LABELS[a] ?? a}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Hauptziel</label>
                    <input
                      value={gbObjective}
                      onChange={(e) => setGbObjective(e.target.value)}
                      placeholder="z. B. Budget freigeben lassen, Team informieren, Auftrag gewinnen…"
                      className="w-full rounded-xl border px-4 py-2.5 text-sm text-white/90 placeholder-white/25 outline-none transition focus:border-[#5cf]/50"
                      style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Tonfall</label>
                    <div className="flex flex-wrap gap-2">
                      {GB_TONES.map((t) => (
                        <button key={t} type="button" onClick={() => setGbTone(t)}
                          className="rounded-xl border px-3 py-1.5 text-xs font-medium transition"
                          style={{ background: gbTone === t ? "rgba(92,204,255,0.15)" : "rgba(255,255,255,0.04)", borderColor: gbTone === t ? "rgba(92,204,255,0.4)" : "rgba(255,255,255,0.08)", color: gbTone === t ? "#5cf" : "rgba(255,255,255,0.65)" }}
                        >
                          {GB_LABELS[t] ?? t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Visual + provider + generate */}
              {gbStep === 3 && (
                <div className="space-y-5">
                  {researchToggle}
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">Design</label>
                    <ThemeGrid value={gbTheme} onChange={setGbTheme} />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/55">KI-Modell</label>
                    <div className="space-y-1.5">
                      {providerOptions.map((opt) => (
                        <button key={opt.value} type="button" onClick={() => setProvider(opt.value)}
                          className="flex w-full items-center justify-between rounded-xl border px-3 py-2 transition"
                          style={{ background: provider === opt.value ? "rgba(92,204,255,0.1)" : "rgba(255,255,255,0.03)", borderColor: provider === opt.value ? "rgba(92,204,255,0.35)" : "rgba(255,255,255,0.08)" }}
                        >
                          <div>
                            <p className="text-xs font-medium" style={{ color: provider === opt.value ? "#5cf" : "rgba(255,255,255,0.75)" }}>{opt.label}</p>
                            <ProviderBadge id={opt.value} />
                          </div>
                          {provider === opt.value && <Check size={12} style={{ color: "#5cf" }} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border p-3" style={{ borderColor: "rgba(92,204,255,0.12)", background: "rgba(92,204,255,0.04)" }}>
                    <p className="mb-1 text-[11px] font-medium text-white/55">Zusammenfassung</p>
                    <p className="text-xs text-white/75">{gbTopic}</p>
                    <p className="mt-1 text-[10px] text-white/40">
                      {GB_LABELS[gbAudience] ?? gbAudience} · {GB_LABELS[gbTone] ?? gbTone} · {gbSlideCount} Folien · gründlich
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {warning && (
            <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-300">{warning}</p>
          )}
          {error && (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          {!isGraphicsbook ? (
            <>
              <p className="text-[11px] text-white/35">{selectedProvider.label}{useReasoning ? " · gründlich" : ""} · ⌘↩</p>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs text-white/55 transition hover:bg-white/8">Abbrechen</button>
                <button type="button" onClick={handleQuickGenerate} disabled={loading || !topic.trim()}
                  className="flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-medium text-black transition disabled:opacity-40"
                  style={{ background: loading ? "rgba(92,204,255,0.5)" : "#5cf" }}
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {loading ? (research ? "Recherchiere & erstelle…" : "Erstelle…") : "Erstellen"}
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={() => gbStep > 1 ? setGbStep((s) => s - 1) : onClose()} className="rounded-xl px-4 py-2 text-xs text-white/55 transition hover:bg-white/8">
                {gbStep === 1 ? "Abbrechen" : "← Zurück"}
              </button>
              {gbStep < totalSteps ? (
                <button
                  type="button"
                  onClick={() => { if (gbStep === 1 && !gbTopic.trim()) { setError("Bitte gib ein Thema ein."); return; } setError(""); setGbStep((s) => s + 1); }}
                  className="flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-medium text-black transition"
                  style={{ background: "#5cf" }}
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGraphicsbookGenerate}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-medium text-black transition disabled:opacity-40"
                  style={{ background: loading ? "rgba(92,204,255,0.5)" : "#5cf" }}
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {loading ? (research ? "Recherchiere & erstelle…" : "Erstelle…") : "Präsentation erstellen"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main SlidesWindow ─────────────────────────────────────────────────────────

export default function SlidesWindow() {
  const { activeWorkspace, activeArtifacts, logBehaviorEvent } = useKernel();
  const [artifactCache, setArtifactCache] = useState<Record<string, WorkspaceArtifact>>({});
  const [generatedDecks, setGeneratedDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  const [editedDecks, setEditedDecks] = useState<Record<string, Deck>>({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [pendingGeneratePrompt, setPendingGeneratePrompt] = useState("");
  const [publishingDeckId, setPublishingDeckId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState("");
  const [publishEnableUrl, setPublishEnableUrl] = useState("");
  const [publishedDeckLinks, setPublishedDeckLinks] = useState<Record<string, PublishedDeckLink>>({});
  const [showProperties, setShowProperties] = useState(true);
  const [presentMode, setPresentMode] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [activeTheme, setActiveTheme] = useState<SlideThemeKey>(DEFAULT_SLIDE_THEME);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("elyra_slides_quickstart");
      if (!raw) return;
      window.localStorage.removeItem("elyra_slides_quickstart");
      const payload = JSON.parse(raw) as { prompt?: string };
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      if (!prompt) return;
      setPendingGeneratePrompt(prompt);
      setShowGenerate(true);
    } catch {
      // ignore malformed quickstart payloads
    }
  }, []);

  // Build artifact decks
  const artifactDecks = useMemo(() => {
    const fromKernel = activeArtifacts
      .filter((a) => a.type === "slides")
      .map(artifactToDeck)
      .filter((d): d is Deck => d !== null);
    const fromCache = Object.values(artifactCache)
      .filter((a) => a.type === "slides")
      .map(artifactToDeck)
      .filter((d): d is Deck => d !== null)
      .filter((d) => !fromKernel.some((e) => e.id === d.id));
    return [...fromKernel, ...fromCache];
  }, [activeArtifacts, artifactCache]);

  const deckList = useMemo(() => {
    const all = [...generatedDecks, ...artifactDecks, ...SAMPLE_DECKS];
    return all;
  }, [artifactDecks, generatedDecks]);

  // Auto-select first deck (a deck handed over from another app wins)
  const pendingSelectRef = useRef<string | null>(null);
  useEffect(() => {
    const pendingId = pendingSelectRef.current;
    if (pendingId && deckList.some((d) => d.id === pendingId)) {
      pendingSelectRef.current = null;
      if (selectedDeckId !== pendingId) {
        setSelectedDeckId(pendingId);
        setSelectedSlideIndex(0);
      }
      return;
    }
    if (!selectedDeckId && deckList.length > 0) {
      setSelectedDeckId(deckList[0]!.id);
      setSelectedSlideIndex(0);
    }
    if (selectedDeckId && !deckList.some((d) => d.id === selectedDeckId)) {
      setSelectedDeckId(deckList[0]?.id ?? "");
      setSelectedSlideIndex(0);
    }
  }, [deckList, selectedDeckId]);

  // Sync active theme with deck theme
  const activeDeck = useMemo(() => {
    const base = deckList.find((d) => d.id === selectedDeckId) ?? deckList[0] ?? null;
    if (!base) return null;
    return editedDecks[base.id] ?? base;
  }, [deckList, editedDecks, selectedDeckId]);

  useEffect(() => {
    if (activeDeck?.theme) setActiveTheme(activeDeck.theme);
  }, [activeDeck?.id, activeDeck?.theme]);

  // Event bus: artifact:open
  useEffect(() => {
    const unsub = eventBus.on("artifact:open", (payload) => {
      if (payload.type !== "slides") return;
      setSelectedDeckId(payload.artifactId);
      setSelectedSlideIndex(0);
      if (artifactCache[payload.artifactId]) return;
      void fetchArtifactById(payload.artifactId, activeWorkspace.id)
        .then((a) => setArtifactCache((prev) => ({ ...prev, [a.id]: a })))
        .catch(() => {});
    });
    return unsub;
  }, [activeWorkspace.id, artifactCache]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!activeDeck) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setSelectedSlideIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setSelectedSlideIndex((i) => Math.min((activeDeck.slides.length ?? 1) - 1, i + 1));
      } else if (e.key === "Escape" && presentMode) {
        setPresentMode(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeDeck, presentMode]);

  const activeSlide = activeDeck?.slides[selectedSlideIndex] ?? null;

  function editActiveSlide(field: "title" | "body", value: string) {
    if (!activeDeck) return;
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      return {
        ...prev,
        [activeDeck.id]: {
          ...base,
          slides: base.slides.map((s, i) => i === selectedSlideIndex ? { ...s, [field]: value } : s),
        },
      };
    });
    logBehaviorEvent({ eventType: "edit_output", fieldName: `slides.${activeDeck.id}.${selectedSlideIndex}.${field}`, metadata: { length: value.length } });
  }

  function addSlide() {
    if (!activeDeck) return;
    const newSlide: DeckSlide = { title: "Neue Folie", body: "", bullets: ["Erster Punkt", "Zweiter Punkt"] };
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      const slides = [...base.slides];
      slides.splice(selectedSlideIndex + 1, 0, newSlide);
      return { ...prev, [activeDeck.id]: { ...base, slides } };
    });
    setSelectedSlideIndex(selectedSlideIndex + 1);
  }

  function deleteSlide() {
    if (!activeDeck || activeDeck.slides.length <= 1) return;
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      const slides = base.slides.filter((_, i) => i !== selectedSlideIndex);
      return { ...prev, [activeDeck.id]: { ...base, slides } };
    });
    setSelectedSlideIndex(Math.max(0, selectedSlideIndex - 1));
  }

  function duplicateSlide() {
    if (!activeDeck || !activeSlide) return;
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      const slides = [...base.slides];
      slides.splice(selectedSlideIndex + 1, 0, { ...activeSlide });
      return { ...prev, [activeDeck.id]: { ...base, slides } };
    });
    setSelectedSlideIndex(selectedSlideIndex + 1);
  }

  function moveSlide(direction: "up" | "down") {
    if (!activeDeck) return;
    const targetIndex = direction === "up" ? selectedSlideIndex - 1 : selectedSlideIndex + 1;
    if (targetIndex < 0 || targetIndex >= activeDeck.slides.length) return;
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      const slides = [...base.slides];
      const [removed] = slides.splice(selectedSlideIndex, 1);
      if (removed) slides.splice(targetIndex, 0, removed);
      return { ...prev, [activeDeck.id]: { ...base, slides } };
    });
    setSelectedSlideIndex(targetIndex);
  }

  function changeTheme(key: SlideThemeKey) {
    setActiveTheme(key);
    if (!activeDeck) return;
    setEditedDecks((prev) => {
      const base = prev[activeDeck.id] ?? activeDeck;
      return { ...prev, [activeDeck.id]: { ...base, theme: key } };
    });
  }

  function handleGenerated(deck: Deck) {
    setGeneratedDecks((prev) => [deck, ...prev]);
    setSelectedDeckId(deck.id);
    setSelectedSlideIndex(0);
    if (deck.theme) setActiveTheme(deck.theme);
  }

  // Decks handed over from other apps (Reporting → "Als Präsentation") via sessionStorage.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("elyra:pending-deck");
      if (!raw) return;
      window.sessionStorage.removeItem("elyra:pending-deck");
      const parsed = JSON.parse(raw) as Deck;
      const pending: Deck | null = parsed && Array.isArray(parsed.slides)
        ? { ...parsed, theme: resolveSlideTheme(parsed.theme), slides: parsed.slides.map(normalizeSlide).filter((x): x is DeckSlide => x !== null) }
        : null;
      if (pending && pending.slides.length > 0) {
        pendingSelectRef.current = pending.id;
        handleGenerated(pending);
      }
    } catch {
      // ignore malformed handover
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePublishToGoogleSlides() {
    if (!activeDeck) return;
    setPublishingDeckId(activeDeck.id);
    setPublishError("");
    setPublishEnableUrl("");
    try {
      const response = await fetch("/api/os/slides/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspace.id,
          title: activeDeck.title,
          theme: activeTheme,
          slides: activeDeck.slides,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        presentationId?: string;
        openUrl?: string;
        code?: string;
        enableUrl?: string;
      } | null;
      if (payload?.code === "api_disabled" && payload.enableUrl) setPublishEnableUrl(payload.enableUrl);
      if (!response.ok || !payload?.ok || !payload.presentationId || !payload.openUrl) {
        throw new Error(payload?.error ?? "Export nach Google Slides fehlgeschlagen.");
      }
      const publishedLink: PublishedDeckLink = {
        presentationId: payload.presentationId,
        openUrl: payload.openUrl,
      };
      setPublishedDeckLinks((prev) => ({
        ...prev,
        [activeDeck.id]: publishedLink,
      }));
      window.open(publishedLink.openUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Export nach Google Slides fehlgeschlagen.");
    } finally {
      setPublishingDeckId(null);
    }
  }

  const theme = SLIDE_THEMES[activeTheme];
  const slides = activeDeck?.slides ?? [];
  const publishedDeckLink = activeDeck ? publishedDeckLinks[activeDeck.id] ?? null : null;

  // Present mode overlay
  if (presentMode && activeDeck && activeSlide) {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col" style={{ background: "#000" }}>
        {/* Present toolbar */}
        <div className="flex items-center justify-between px-6 py-3" style={{ background: "rgba(0,0,0,0.8)" }}>
          <span className="text-sm font-medium text-white/70">{activeDeck.title}</span>
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/40">{selectedSlideIndex + 1} / {slides.length}</span>
            <button type="button" onClick={() => setPresentMode(false)} className="rounded-lg px-3 py-1.5 text-xs text-white/55 transition hover:bg-white/10">
              <X size={14} />
            </button>
          </div>
        </div>
        {/* Canvas */}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div style={{ width: "100%", height: "100%", maxWidth: 1600 }}>
            <SlideCanvas slide={activeSlide} themeKey={activeTheme} slideIndex={selectedSlideIndex} total={slides.length} deckTitle={activeDeck.title} presentMode />
          </div>
        </div>
        {/* Nav */}
        <div className="flex items-center justify-center gap-6 py-4">
          <button type="button" onClick={() => setSelectedSlideIndex((i) => Math.max(0, i - 1))} disabled={selectedSlideIndex === 0} className="rounded-xl border border-white/10 p-2 text-white/55 transition hover:bg-white/8 disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button key={i} type="button" onClick={() => setSelectedSlideIndex(i)} className="h-1.5 rounded-full transition-all" style={{ width: i === selectedSlideIndex ? 24 : 6, background: i === selectedSlideIndex ? theme.accent : "rgba(255,255,255,0.2)" }} />
            ))}
          </div>
          <button type="button" onClick={() => setSelectedSlideIndex((i) => Math.min(slides.length - 1, i + 1))} disabled={selectedSlideIndex === slides.length - 1} className="rounded-xl border border-white/10 p-2 text-white/55 transition hover:bg-white/8 disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--bg-canvas, #070c16)" }}>
      {/* ── Left Rail: Deck List ─────────────────────────────────────── */}
      <aside className="flex w-48 flex-shrink-0 flex-col border-r" style={{ borderColor: "var(--os-border-soft)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b" style={{ borderColor: "var(--os-border-soft)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">Präsentationen</span>
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            title="Neue Präsentation erstellen"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition hover:bg-[color:var(--bg-surface-hover)]"
            style={{ color: theme.accent }}
          >
            <Sparkles size={10} />
            Neu
          </button>
        </div>

        {/* Deck list */}
        <div className="flex-1 overflow-y-auto py-2">
          {deckList.map((deck) => (
            <button
              key={deck.id}
              type="button"
              onClick={() => { setSelectedDeckId(deck.id); setSelectedSlideIndex(0); }}
              className="group w-full rounded-lg px-3 py-2.5 text-left transition"
              style={{
                background: deck.id === activeDeck?.id ? "var(--bg-surface-hover, rgba(255,255,255,0.06))" : "transparent",
              }}
            >
              <p
                className="truncate text-xs font-medium"
                style={{ color: deck.id === activeDeck?.id ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {deck.title}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[color:var(--text-tertiary)]">
                {deck.source === "generated" ? (
                  <><Sparkles size={8} style={{ color: theme.accent }} /> AI</>
                ) : deck.source === "artifact" ? (
                  <><FileText size={8} /> Artefakt</>
                ) : (
                  <><Layout size={8} /> Beispiel</>
                )}
                {deck.updatedAt && ` · ${formatArtifactDate(deck.updatedAt)}`}
                <span className="ml-auto">{deck.slides.length}s</span>
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Center: Thumbnail rail + Canvas ─────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--os-border-soft)", minHeight: 44 }}>
          {/* Left: deck title */}
          <div className="flex items-center gap-2 truncate">
            <span className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{activeDeck?.title ?? "—"}</span>
            {activeDeck?.source === "generated" && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${theme.accent}18`, color: theme.accent }}>
                <Sparkles size={9} /> {activeDeck.providerLabel ?? "AI"}
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex flex-shrink-0 items-center gap-1">
            {/* Theme picker */}
            <div className="flex items-center gap-1 border-r pr-2 mr-1" style={{ borderColor: "var(--os-border-soft)" }}>
              {(Object.keys(SLIDE_THEMES) as SlideThemeKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeTheme(key)}
                  title={SLIDE_THEMES[key].label}
                  className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    background: SLIDE_THEMES[key].dot,
                    borderColor: activeTheme === key ? SLIDE_THEMES[key].dot : "transparent",
                    boxShadow: activeTheme === key ? `0 0 0 1px ${SLIDE_THEMES[key].dot}44` : undefined,
                    opacity: activeTheme === key ? 1 : 0.35,
                  }}
                />
              ))}
            </div>

            <button type="button" onClick={() => setShowGenerate(true)} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-black transition" style={{ background: "var(--os-accent, #5cf)" }}>
              <Sparkles size={11} /> Mit KI erstellen
            </button>
            <button
              type="button"
              onClick={() => void handlePublishToGoogleSlides()}
              disabled={!activeDeck || publishingDeckId === activeDeck?.id}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
              style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--os-border-soft)" }}
            >
              {publishingDeckId === activeDeck?.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {publishedDeckLink ? "In Google Slides öffnen" : "Nach Google Slides"}
            </button>
            <button
              type="button"
              onClick={() => setPrinting(true)}
              disabled={!activeDeck || printing}
              title="Als PDF exportieren (Drucken → Als PDF sichern)"
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
              style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--os-border-soft)" }}
            >
              {printing ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} PDF
            </button>
            {printing && activeDeck ? (
              <PrintDeck slides={activeDeck.slides} themeKey={activeTheme} deckTitle={activeDeck.title} onDone={() => setPrinting(false)} />
            ) : null}
            <button type="button" onClick={() => setPresentMode(true)} title="Präsentieren (Vollbild)" className="rounded-xl p-1.5 text-[color:var(--text-tertiary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)]">
              <Maximize2 size={14} />
            </button>
            <button type="button" onClick={() => setShowProperties(!showProperties)} title="Eigenschaften ein/aus" className="rounded-xl p-1.5 transition hover:bg-[color:var(--bg-surface-hover)]" style={{ color: showProperties ? theme.accent : "var(--text-tertiary)" }}>
              <PanelRight size={14} />
            </button>
          </div>
        </div>

        {/* Slide area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Thumbnail rail */}
          <div className="flex w-[100px] flex-shrink-0 flex-col gap-2 overflow-y-auto border-r p-2" style={{ borderColor: "var(--os-border-soft)" }}>
            {/* Add slide */}
            <button
              type="button"
              onClick={addSlide}
              className="flex items-center justify-center rounded-lg border py-2 text-[color:var(--text-tertiary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)]"
              style={{ borderColor: "var(--os-border-soft)", borderStyle: "dashed" }}
            >
              <Plus size={14} />
            </button>
            {slides.map((slide, i) => (
              <SlideThumbnail
                key={`${slide.title}-${i}`}
                slide={slide}
                themeKey={activeTheme}
                index={i}
                total={slides.length}
                deckTitle={activeDeck?.title ?? ""}
                active={i === selectedSlideIndex}
                onClick={() => setSelectedSlideIndex(i)}
              />
            ))}
          </div>

          {/* Main canvas */}
          <div className="flex flex-1 items-center justify-center p-6" style={{ background: "var(--bg-canvas, rgba(0,0,0,0.25))" }}>
            {activeDeck && activeSlide ? (
              <div style={{ width: "100%", maxWidth: 1100, aspectRatio: "16/9" }}>
                <SlideCanvas
                  slide={activeSlide}
                  themeKey={activeTheme}
                  slideIndex={selectedSlideIndex}
                  total={slides.length}
                  deckTitle={activeDeck.title}
                  onEdit={editActiveSlide}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--bg-surface)]">
                  <Layout size={24} className="text-[color:var(--text-tertiary)]" />
                </div>
                <p className="text-sm text-[color:var(--text-tertiary)]">Keine Präsentation ausgewählt</p>
                <button type="button" onClick={() => setShowGenerate(true)} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-black" style={{ background: "var(--os-accent, #5cf)" }}>
                  <Sparkles size={14} /> Präsentation erstellen
                </button>
              </div>
            )}
          </div>

          {/* Properties panel */}
          {showProperties && activeDeck && activeSlide && (
            <aside className="flex w-60 flex-shrink-0 flex-col overflow-y-auto border-l" style={{ borderColor: "var(--os-border-soft)" }}>
              {/* Header */}
              <div className="border-b px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">Folie {selectedSlideIndex + 1} von {slides.length}</p>
              </div>

              {/* Slide actions */}
              <div className="flex border-b px-2 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
                {[
                  { icon: ArrowUp, label: "Nach oben", action: () => moveSlide("up"), disabled: selectedSlideIndex === 0 },
                  { icon: ArrowDown, label: "Nach unten", action: () => moveSlide("down"), disabled: selectedSlideIndex === slides.length - 1 },
                  { icon: Copy, label: "Duplizieren", action: duplicateSlide, disabled: false },
                  { icon: Trash2, label: "Löschen", action: deleteSlide, disabled: slides.length <= 1 },
                ].map(({ icon: Icon, label, action, disabled }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={action}
                    disabled={disabled}
                    title={label}
                    className="flex flex-1 items-center justify-center rounded-lg p-2 text-[color:var(--text-tertiary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-25"
                  >
                    <Icon size={13} />
                  </button>
                ))}
              </div>

              {/* Content editor */}
              <div className="flex-1 space-y-4 px-4 py-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">Titel</label>
                  <input
                    value={activeSlide.title}
                    onChange={(e) => editActiveSlide("title", e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none transition"
                    style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)" }}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">Text</label>
                  <textarea
                    value={activeSlide.body}
                    onChange={(e) => editActiveSlide("body", e.target.value)}
                    rows={4}
                    className="w-full resize-none rounded-xl border px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none transition"
                    style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)" }}
                  />
                </div>

                {activeSlide.bullets && activeSlide.bullets.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">Stichpunkte</label>
                    <div className="space-y-1.5">
                      {activeSlide.bullets.map((bullet, bi) => (
                        <div key={bi} className="flex items-center gap-2">
                          <div className="h-1 w-1 flex-shrink-0 rounded-full" style={{ background: theme.dot }} />
                          <input
                            value={bullet}
                            onChange={(e) => {
                              const newBullets = [...(activeSlide.bullets ?? [])];
                              newBullets[bi] = e.target.value;
                              if (!activeDeck) return;
                              setEditedDecks((prev) => {
                                const base = prev[activeDeck.id] ?? activeDeck;
                                return {
                                  ...prev,
                                  [activeDeck.id]: {
                                    ...base,
                                    slides: base.slides.map((s, si) =>
                                      si === selectedSlideIndex ? { ...s, bullets: newBullets } : s
                                    ),
                                  },
                                };
                              });
                            }}
                            className="flex-1 rounded-lg border px-2 py-1.5 text-xs text-[color:var(--text-primary)] outline-none"
                            style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)" }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeSlide.notes ? (
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">Sprechernotizen</label>
                    <p className="whitespace-pre-wrap rounded-lg border px-2.5 py-2 text-xs leading-relaxed text-[color:var(--text-secondary)]" style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)" }}>
                      {activeSlide.notes}
                    </p>
                  </div>
                ) : null}

                {/* Theme in properties */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">Design</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {(Object.keys(SLIDE_THEMES) as SlideThemeKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => changeTheme(key)}
                        title={SLIDE_THEMES[key].label}
                        className="relative overflow-hidden rounded-lg border transition"
                        style={{
                          aspectRatio: "1",
                          background: SLIDE_THEMES[key].dot,
                          borderColor: activeTheme === key ? SLIDE_THEMES[key].dot : "var(--os-border-soft)",
                          opacity: activeTheme === key ? 1 : 0.4,
                        }}
                      >
                        {activeTheme === key && <Check size={9} className="absolute inset-0 m-auto text-black" />}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-[color:var(--text-tertiary)]">{SLIDE_THEMES[activeTheme].label}</p>
                </div>
              </div>

              {/* Keyboard hints */}
              <div className="border-t px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
                <div className="space-y-1 text-[10px] text-[color:var(--text-tertiary)]">
                  <div className="flex justify-between"><span>Blättern</span><span>← →</span></div>
                  <div className="flex justify-between"><span>Präsentieren</span><span className="font-mono rounded px-1 py-0.5 text-[9px] bg-[color:var(--bg-surface-hover)]">F5</span></div>
                </div>
              </div>
            </aside>
          )}
        </div>

        {/* Bottom navigation bar */}
        <div className="flex items-center justify-between border-t px-4 py-2" style={{ borderColor: "var(--os-border-soft)", minHeight: 40 }}>
          <div className="min-w-[220px] text-[10px] text-[color:var(--text-tertiary)]">
            {publishError ? (
              <span className="text-red-400">
                {publishError}
                {publishEnableUrl ? (
                  <>
                    {" "}
                    <a href={publishEnableUrl} target="_blank" rel="noreferrer" className="underline">API aktivieren</a>
                    {" "}und danach erneut exportieren.
                  </>
                ) : null}
              </span>
            ) : publishedDeckLink ? (
              <a href={publishedDeckLink.openUrl} target="_blank" rel="noreferrer" className="text-[color:var(--os-accent)] hover:underline">
                In Google Slides öffnen
              </a>
            ) : null}
          </div>
          <button type="button" onClick={() => setSelectedSlideIndex((i) => Math.max(0, i - 1))} disabled={selectedSlideIndex === 0} className="rounded-lg p-1 text-[color:var(--text-tertiary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-20">
            <ChevronLeft size={14} />
          </button>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {slides.slice(0, 12).map((_, i) => (
                <button key={i} type="button" onClick={() => setSelectedSlideIndex(i)} className="h-1 rounded-full transition-all" style={{ width: i === selectedSlideIndex ? 16 : 4, background: i === selectedSlideIndex ? theme.accent : "var(--os-border-soft)" }} />
              ))}
            </div>
            <span className="text-[10px] text-[color:var(--text-tertiary)]">{selectedSlideIndex + 1} / {slides.length}</span>
          </div>
          <button type="button" onClick={() => setSelectedSlideIndex((i) => Math.min(slides.length - 1, i + 1))} disabled={selectedSlideIndex === slides.length - 1} className="rounded-lg p-1 text-[color:var(--text-tertiary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-20">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Generate Modal */}
      {showGenerate && (
        <GenerateModal
          onGenerate={handleGenerated}
          onClose={() => {
            setShowGenerate(false);
            setPendingGeneratePrompt("");
          }}
          workspaceId={activeWorkspace.id}
          initialPrompt={pendingGeneratePrompt}
        />
      )}
    </div>
  );
}
