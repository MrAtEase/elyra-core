"use client";

/**
 * Elyra Slides – professional slide renderer.
 *
 * Every slide is laid out on a fixed 1280×720 design canvas and scaled to fit its container,
 * so typography, spacing and layouts look identical in thumbnails, the editor, present mode and PDF export.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlideLayout =
  | "title" | "section" | "agenda" | "bullets" | "two-col" | "blank"
  | "stats" | "comparison" | "timeline" | "quote" | "team" | "closing";

export const SLIDE_LAYOUTS: SlideLayout[] = [
  "title", "section", "agenda", "bullets", "two-col", "blank", "stats", "comparison", "timeline", "quote", "team", "closing",
];

export type DeckSlide = {
  title: string;
  body: string;
  bullets?: string[];
  layout?: SlideLayout;
  /** stats: 1–4 big numbers */
  stats?: Array<{ value: string; label: string }>;
  /** comparison / two-col */
  columns?: Array<{ heading: string; points: string[] }>;
  /** timeline: ordered steps */
  steps?: Array<{ label: string; detail?: string }>;
  /** quote */
  quote?: { text: string; author?: string };
  /** team */
  people?: Array<{ name: string; role: string }>;
  /** speaker notes (not shown on the slide) */
  notes?: string;
  /** optional illustration (data URL or https) */
  imageUrl?: string;
  /** short source note shown as footnote (e.g. "Statista 2025") */
  source?: string;
};

export type SlideThemeKey =
  | "executive" | "minimal" | "editorial" | "light" | "corporate" | "cyber" | "gradient" | "ocean" | "warm";

export type SlideTheme = {
  label: string;
  /** UI-facing colours (also used by the editor chrome) */
  bg: string;
  text: string;
  accent: string;
  secondary: string;
  border: string;
  dot: string;
  /** design tokens */
  dark: boolean;
  surface: string;
  heroBg: string;
  heroText: string;
  heroMuted: string;
  onAccent: string;
  headingFont: string;
  bodyFont: string;
};

const SANS = "var(--font-inter, Inter), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

export const SLIDE_THEMES: Record<SlideThemeKey, SlideTheme> = {
  executive: {
    label: "Executive",
    bg: "#ffffff", text: "#0b1b33", accent: "#1f4fd8", secondary: "#5b6b82", border: "#e3e8f0", dot: "#1f4fd8",
    dark: false, surface: "#f3f6fb",
    heroBg: "linear-gradient(135deg, #0b1b33 0%, #142b52 100%)", heroText: "#ffffff", heroMuted: "rgba(255,255,255,0.72)",
    onAccent: "#ffffff", headingFont: SANS, bodyFont: SANS,
  },
  minimal: {
    label: "Minimal",
    bg: "#fafaf9", text: "#18181b", accent: "#e8552a", secondary: "#71717a", border: "#e7e5e4", dot: "#e8552a",
    dark: false, surface: "#f1efec",
    heroBg: "#18181b", heroText: "#fafaf9", heroMuted: "rgba(250,250,249,0.66)",
    onAccent: "#ffffff", headingFont: SANS, bodyFont: SANS,
  },
  editorial: {
    label: "Editorial",
    bg: "#f7f3ec", text: "#231d18", accent: "#a4471f", secondary: "#6f655c", border: "#e4dacb", dot: "#a4471f",
    dark: false, surface: "#efe7da",
    heroBg: "#efe6d8", heroText: "#231d18", heroMuted: "#6f655c",
    onAccent: "#ffffff", headingFont: SERIF, bodyFont: SANS,
  },
  light: {
    label: "Clean Light",
    bg: "#ffffff", text: "#0f172a", accent: "#5b5bd6", secondary: "#64748b", border: "#e2e8f0", dot: "#5b5bd6",
    dark: false, surface: "#f5f6fb",
    heroBg: "linear-gradient(135deg, #eceefe 0%, #ffffff 70%)", heroText: "#0f172a", heroMuted: "#475569",
    onAccent: "#ffffff", headingFont: SANS, bodyFont: SANS,
  },
  corporate: {
    label: "Navy",
    bg: "#0f172a", text: "#f1f5f9", accent: "#60a5fa", secondary: "#94a3b8", border: "rgba(148,163,184,0.2)", dot: "#60a5fa",
    dark: true, surface: "rgba(148,163,184,0.08)",
    heroBg: "linear-gradient(135deg, #0b1222 0%, #1e293b 100%)", heroText: "#ffffff", heroMuted: "#94a3b8",
    onAccent: "#0b1222", headingFont: SANS, bodyFont: SANS,
  },
  cyber: {
    label: "Cyber",
    bg: "linear-gradient(135deg, #080e1a 0%, #0d1528 60%, #091220 100%)", text: "#e2f0ff", accent: "#55ccff",
    secondary: "rgba(226,240,255,0.62)", border: "rgba(85,204,255,0.18)", dot: "#55ccff",
    dark: true, surface: "rgba(85,204,255,0.06)",
    heroBg: "linear-gradient(135deg, #060b15 0%, #0d1830 100%)", heroText: "#e2f0ff", heroMuted: "rgba(226,240,255,0.62)",
    onAccent: "#04121d", headingFont: SANS, bodyFont: SANS,
  },
  gradient: {
    label: "Violet",
    bg: "linear-gradient(135deg, #1a0533 0%, #2d1b69 55%, #0f3460 100%)", text: "#ede9fe", accent: "#a78bfa",
    secondary: "rgba(237,233,254,0.66)", border: "rgba(167,139,250,0.22)", dot: "#a78bfa",
    dark: true, surface: "rgba(167,139,250,0.08)",
    heroBg: "linear-gradient(135deg, #1a0533 0%, #2d1b69 55%, #0f3460 100%)", heroText: "#ffffff", heroMuted: "rgba(237,233,254,0.7)",
    onAccent: "#1a0533", headingFont: SANS, bodyFont: SANS,
  },
  ocean: {
    label: "Ocean",
    bg: "linear-gradient(160deg, #062233 0%, #0c3a5a 100%)", text: "#e0f2fe", accent: "#38bdf8",
    secondary: "rgba(224,242,254,0.66)", border: "rgba(56,189,248,0.2)", dot: "#38bdf8",
    dark: true, surface: "rgba(56,189,248,0.07)",
    heroBg: "linear-gradient(160deg, #041a28 0%, #0c3a5a 100%)", heroText: "#ffffff", heroMuted: "rgba(224,242,254,0.7)",
    onAccent: "#041a28", headingFont: SANS, bodyFont: SANS,
  },
  warm: {
    label: "Warm",
    bg: "linear-gradient(160deg, #1c0a00 0%, #2d1200 100%)", text: "#fef3c7", accent: "#f59e0b",
    secondary: "rgba(254,243,199,0.66)", border: "rgba(245,158,11,0.2)", dot: "#f59e0b",
    dark: true, surface: "rgba(245,158,11,0.07)",
    heroBg: "linear-gradient(160deg, #1c0a00 0%, #3a1700 100%)", heroText: "#fff7e0", heroMuted: "rgba(254,243,199,0.7)",
    onAccent: "#1c0a00", headingFont: SERIF, bodyFont: SANS,
  },
};

export const DEFAULT_SLIDE_THEME: SlideThemeKey = "executive";

export function resolveSlideTheme(key: string | undefined | null): SlideThemeKey {
  return key && key in SLIDE_THEMES ? (key as SlideThemeKey) : DEFAULT_SLIDE_THEME;
}

// ── Normalisation (artifacts, generator, hand-overs) ─────────────────────────

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list<T>(value: unknown, map: (x: Record<string, unknown>) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => { const r = rec(x); return r ? map(r) : null; }).filter((x): x is T => x !== null).slice(0, max);
}

/** Turns any slide-like JSON into a DeckSlide, keeping all rich layout data. */
export function normalizeSlide(value: unknown): DeckSlide | null {
  const row = rec(value);
  if (!row) return null;
  const bullets = Array.isArray(row.bullets) ? row.bullets.map(str).filter(Boolean).slice(0, 8) : [];
  const body = str(row.body) || str(row.subtitle) || (bullets.length === 0 ? str(row.content) : "");
  const layoutRaw = str(row.layout);
  const layout = (SLIDE_LAYOUTS as string[]).includes(layoutRaw) ? (layoutRaw as SlideLayout) : undefined;
  const stats = list(row.stats, (x) => (str(x.value) ? { value: str(x.value), label: str(x.label) } : null), 4);
  const columns = list(row.columns, (x) => ({ heading: str(x.heading), points: Array.isArray(x.points) ? x.points.map(str).filter(Boolean).slice(0, 6) : [] }), 2);
  const steps = list(row.steps, (x) => (str(x.label) ? { label: str(x.label), detail: str(x.detail) } : null), 6);
  const people = list(row.people, (x) => (str(x.name) ? { name: str(x.name), role: str(x.role) } : null), 6);
  const quoteRow = rec(row.quote);
  const quote = quoteRow && str(quoteRow.text) ? { text: str(quoteRow.text), author: str(quoteRow.author) } : undefined;
  const notes = str(row.notes);
  const imageUrl = str(row.imageUrl);
  const source = str(row.source);
  return {
    title: str(row.title) || "Untitled",
    body,
    ...(bullets.length ? { bullets } : {}),
    ...(layout ? { layout } : {}),
    ...(stats.length ? { stats } : {}),
    ...(columns.length ? { columns } : {}),
    ...(steps.length ? { steps } : {}),
    ...(people.length ? { people } : {}),
    ...(quote ? { quote } : {}),
    ...(notes ? { notes } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(source ? { source } : {}),
  };
}

/** The layout that will actually be drawn (falls back when a layout's data is missing). */
export function effectiveLayout(slide: DeckSlide, index: number): SlideLayout {
  if (index === 0) return "title";
  const layout = slide.layout ?? "bullets";
  switch (layout) {
    case "stats": return slide.stats?.length ? "stats" : "bullets";
    case "comparison":
    case "two-col": return slide.columns && slide.columns.length >= 2 ? "comparison" : "bullets";
    case "timeline": return slide.steps?.length ? "timeline" : "bullets";
    case "quote": return slide.quote?.text ? "quote" : "bullets";
    case "team": return slide.people?.length ? "team" : "bullets";
    case "agenda": return slide.bullets?.length || slide.steps?.length ? "agenda" : "bullets";
    default: return layout;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Picks a font size from [maxLength, size] steps. */
function fit(text: string, steps: Array<[number, number]>, min: number): number {
  for (const [max, size] of steps) if (text.length <= max) return size;
  return min;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

type EditProps = { editable: boolean; onEdit?: (field: "title" | "body", value: string) => void };

function Editable({ as = "div", field, text, style, editable, onEdit }: EditProps & {
  as?: "h1" | "h2" | "p" | "div";
  field: "title" | "body";
  text: string;
  style: CSSProperties;
}) {
  const Tag = as;
  return (
    <Tag
      style={{ margin: 0, outline: "none", ...style }}
      suppressContentEditableWarning
      contentEditable={editable}
      onBlur={(e) => onEdit?.(field, e.currentTarget.textContent ?? "")}
    >
      {text}
    </Tag>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function ContentFrame({ theme, deckTitle, slideIndex, total, children, rightInset = 0, source }: {
  theme: SlideTheme; deckTitle: string; slideIndex: number; total: number; children: ReactNode; rightInset?: number; source?: string | undefined;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, background: theme.bg, color: theme.text, fontFamily: theme.bodyFont }}>
      <div style={{
        position: "absolute", left: 88, right: 88 + rightInset, top: 40, display: "flex", alignItems: "center",
        justifyContent: "space-between", fontSize: 13, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.secondary,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 860, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          <span style={{ width: 22, height: 3, borderRadius: 2, background: theme.accent, flexShrink: 0 }} />
          {deckTitle}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{pad2(slideIndex + 1)} / {pad2(total)}</span>
      </div>
      <div style={{ position: "absolute", left: 88, right: 88 + rightInset, top: 100, bottom: 64, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
      {source ? (
        <div style={{ position: "absolute", left: 88, right: 88 + rightInset, bottom: 26, fontSize: 12, color: theme.secondary, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Quelle: {source}
        </div>
      ) : null}
    </div>
  );
}

function Headline({ slide, theme, edit, maxWidth = 1040, sizes }: {
  slide: DeckSlide; theme: SlideTheme; edit: EditProps; maxWidth?: number; sizes?: Array<[number, number]>;
}) {
  const size = fit(slide.title, sizes ?? [[34, 52], [60, 44], [90, 38]], 34);
  return (
    <>
      <Editable as="h2" field="title" text={slide.title} {...edit} style={{
        fontFamily: theme.headingFont, fontSize: size, fontWeight: 680, lineHeight: 1.1, letterSpacing: "-0.022em", maxWidth, color: theme.text,
      }} />
      {slide.body ? (
        <Editable as="p" field="body" text={slide.body} {...edit} style={{
          marginTop: 18, fontSize: fit(slide.body, [[110, 23], [200, 20]], 18), lineHeight: 1.45, color: theme.secondary, maxWidth: Math.min(maxWidth, 980),
        }} />
      ) : null}
    </>
  );
}

// ── Layouts ──────────────────────────────────────────────────────────────────

function HeroSlide({ slide, theme, deckTitle, slideIndex, total, variant, edit }: {
  slide: DeckSlide; theme: SlideTheme; deckTitle: string; slideIndex: number; total: number;
  variant: "title" | "section" | "closing"; edit: EditProps;
}) {
  const titleSize = variant === "title"
    ? fit(slide.title, [[26, 84], [48, 70], [80, 58]], 48)
    : fit(slide.title, [[30, 66], [60, 56]], 46);
  const kicker = variant === "title" && deckTitle.trim() && deckTitle.trim() !== slide.title.trim() ? deckTitle : "";
  const bullets = slide.bullets ?? [];
  const heroAccent = `color-mix(in srgb, ${theme.accent} 62%, ${theme.heroText})`;
  return (
    <div style={{ position: "absolute", inset: 0, background: theme.heroBg, color: theme.heroText, fontFamily: theme.bodyFont, overflow: "hidden" }}>
      {/* geometric décor, kept top-right so it never collides with the text block */}
      <div style={{ position: "absolute", right: -260, top: -260, width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(circle, ${tint(theme.accent, 42)} 0%, transparent 66%)` }} />
      <div style={{ position: "absolute", right: 96, top: 72, width: 240, height: 240, borderRadius: "50%", border: `2px solid ${tint(theme.accent, 60)}` }} />
      <div style={{ position: "absolute", right: 72, top: 276, width: 56, height: 56, borderRadius: "50%", background: theme.accent }} />
      <div style={{ position: "absolute", left: 0, bottom: 0, width: 12, height: "38%", background: theme.accent }} />

      {variant !== "title" ? (
        <div style={{ position: "absolute", left: 88, top: 44, fontSize: 13, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.heroMuted, fontVariantNumeric: "tabular-nums" }}>
          {pad2(slideIndex + 1)} / {pad2(total)}
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 88, right: 340, bottom: 84, display: "flex", flexDirection: "column" }}>
        {variant === "section" ? (
          <div style={{ fontFamily: theme.headingFont, fontSize: 120, fontWeight: 750, lineHeight: 1, letterSpacing: "-0.04em", color: heroAccent, marginBottom: 20 }}>
            {pad2(slideIndex)}
          </div>
        ) : null}
        {kicker ? (
          <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "0.18em", textTransform: "uppercase", color: heroAccent, marginBottom: 24 }}>{kicker}</div>
        ) : null}
        {variant !== "section" ? <div style={{ width: 88, height: 6, borderRadius: 3, background: theme.accent, marginBottom: 32 }} /> : null}
        <Editable as="h1" field="title" text={slide.title} {...edit} style={{
          fontFamily: theme.headingFont, fontSize: titleSize, fontWeight: 720, lineHeight: 1.04, letterSpacing: "-0.03em", color: theme.heroText, maxWidth: 900,
        }} />
        {slide.body ? (
          <Editable as="p" field="body" text={slide.body} {...edit} style={{
            marginTop: 26, fontSize: fit(slide.body, [[90, 27], [160, 23]], 20), lineHeight: 1.4, color: theme.heroMuted, maxWidth: 820,
          }} />
        ) : null}
        {bullets.length > 0 ? (
          variant === "closing" ? (
            <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: bullets.length > 3 ? "1fr 1fr" : "1fr", columnGap: 48, rowGap: 14, maxWidth: 860 }}>
              {bullets.slice(0, 6).map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", fontSize: 21, lineHeight: 1.35 }}>
                  <span style={{ color: heroAccent, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pad2(i + 1)}</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 40, display: "flex", flexWrap: "wrap", gap: 12 }}>
              {bullets.slice(0, 4).map((b, i) => (
                <span key={i} style={{ padding: "10px 18px", borderRadius: 999, border: `1px solid ${tint(theme.heroText, 26)}`, fontSize: 16, color: theme.heroMuted }}>{b}</span>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function BulletsBody({ bullets, theme }: { bullets: string[]; theme: SlideTheme }) {
  const items = bullets.slice(0, 6);
  const longest = items.reduce((m, b) => Math.max(m, b.length), 0);
  if (items.length <= 3) {
    const size = longest <= 50 ? 25 : longest <= 95 ? 22 : 19;
    return (
      <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 24 }}>
        {items.map((b, i) => (
          <div key={i} style={{ background: theme.surface, borderRadius: 18, padding: "30px 30px 34px", minHeight: 230, display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: theme.headingFont, fontSize: 18, fontWeight: 750, color: theme.accent, fontVariantNumeric: "tabular-nums" }}>{pad2(i + 1)}</div>
            <div style={{ width: 32, height: 3, borderRadius: 2, background: theme.accent, margin: "16px 0 22px" }} />
            <div style={{ fontSize: size, fontWeight: 520, lineHeight: 1.36, color: theme.text }}>{b}</div>
          </div>
        ))}
      </div>
    );
  }
  const size = longest <= 60 ? 23 : longest <= 100 ? 20 : 18;
  return (
    <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 56 }}>
      {items.map((b, i) => (
        <div key={i} style={{ display: "flex", gap: 20, alignItems: "baseline", borderTop: `1px solid ${theme.border}`, padding: "20px 0 22px" }}>
          <span style={{ fontFamily: theme.headingFont, fontSize: 19, fontWeight: 750, color: theme.accent, width: 30, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{pad2(i + 1)}</span>
          <span style={{ fontSize: size, lineHeight: 1.4, color: theme.text }}>{b}</span>
        </div>
      ))}
    </div>
  );
}

function SlideFrame({ slide, theme, slideIndex, total, deckTitle, edit }: {
  slide: DeckSlide; theme: SlideTheme; slideIndex: number; total: number; deckTitle: string; edit: EditProps;
}) {
  const layout = effectiveLayout(slide, slideIndex);
  const frame = { theme, deckTitle, slideIndex, total };

  if (layout === "title" || layout === "section" || layout === "closing") {
    return <HeroSlide slide={slide} variant={layout} edit={edit} {...frame} />;
  }
  const content = { ...frame, source: slide.source };

  if (layout === "stats" && slide.stats) {
    const stats = slide.stats.slice(0, 4);
    const steps: Array<[number, number]> = stats.length === 1 ? [[6, 160], [10, 120]] : stats.length === 2 ? [[6, 112], [10, 88]] : [[5, 92], [8, 74], [12, 60]];
    return (
      <ContentFrame {...content}>
        <Headline slide={slide} theme={theme} edit={edit} />
        <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: 24 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ background: theme.surface, borderRadius: 18, padding: "34px 34px 32px" }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: theme.accent, marginBottom: 26 }} />
              <div style={{ fontFamily: theme.headingFont, fontSize: fit(s.value, steps, 48), fontWeight: 750, lineHeight: 1, letterSpacing: "-0.035em", color: theme.accent, whiteSpace: "nowrap" }}>{s.value}</div>
              <div style={{ marginTop: 18, fontSize: 20, lineHeight: 1.38, color: theme.secondary }}>{s.label}</div>
            </div>
          ))}
        </div>
      </ContentFrame>
    );
  }

  if (layout === "comparison" && slide.columns) {
    return (
      <ContentFrame {...content}>
        <Headline slide={slide} theme={theme} edit={edit} />
        <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          {slide.columns.slice(0, 2).map((col, i) => {
            const highlight = i === 1;
            const fg = highlight ? theme.onAccent : theme.text;
            return (
              <div key={i} style={{ background: highlight ? theme.accent : theme.surface, color: fg, borderRadius: 20, padding: "34px 36px 36px", minHeight: 300 }}>
                <div style={{ fontSize: 15, fontWeight: 750, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.85, marginBottom: 24 }}>{col.heading}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {col.points.slice(0, 5).map((p, j) => (
                    <div key={j} style={{ display: "flex", gap: 14, alignItems: "baseline", fontSize: col.points.some((x) => x.length > 70) ? 19 : 22, lineHeight: 1.38 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: highlight ? theme.onAccent : theme.accent, flexShrink: 0, transform: "translateY(-3px)" }} />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ContentFrame>
    );
  }

  if (layout === "timeline" && slide.steps) {
    const steps = slide.steps.slice(0, 5);
    return (
      <ContentFrame {...content}>
        <Headline slide={slide} theme={theme} edit={edit} />
        <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, position: "relative", paddingBottom: 8 }}>
          <div style={{ position: "absolute", left: 22, right: 22, top: 61, height: 2, background: tint(theme.text, 16) }} />
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 28 }}>
            {steps.map((s, i) => (
              <div key={i}>
                <div style={{
                  width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 750,
                  background: i === 0 ? theme.accent : theme.dark ? "#0b1222" : "#ffffff", color: i === 0 ? theme.onAccent : theme.accent,
                  border: `2px solid ${theme.accent}`, fontVariantNumeric: "tabular-nums",
                }}>{i + 1}</div>
                <div style={{ marginTop: 24, fontFamily: theme.headingFont, fontSize: steps.length > 4 ? 21 : 24, fontWeight: 680, lineHeight: 1.2, color: theme.text }}>{s.label}</div>
                {s.detail ? <div style={{ marginTop: 10, fontSize: steps.length > 4 ? 16 : 18, lineHeight: 1.45, color: theme.secondary }}>{s.detail}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </ContentFrame>
    );
  }

  if (layout === "quote" && slide.quote) {
    const q = slide.quote;
    return (
      <ContentFrame {...content}>
        <div style={{ fontSize: 16, fontWeight: 650, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.accent }}>{slide.title}</div>
        <div style={{ position: "relative", marginTop: "auto", marginBottom: "auto" }}>
          <div style={{ position: "absolute", left: -18, top: -120, fontFamily: SERIF, fontSize: 280, lineHeight: 1, color: theme.accent, opacity: 0.18 }}>“</div>
          <blockquote style={{
            position: "relative", margin: 0, fontFamily: theme.headingFont, fontSize: fit(q.text, [[110, 48], [200, 40], [300, 33]], 28),
            fontWeight: 520, lineHeight: 1.28, letterSpacing: "-0.012em", maxWidth: 1040, color: theme.text,
          }}>{q.text}</blockquote>
          {q.author ? (
            <div style={{ marginTop: 36, display: "flex", alignItems: "center", gap: 16, fontSize: 20, fontWeight: 600, color: theme.secondary }}>
              <span style={{ width: 40, height: 3, borderRadius: 2, background: theme.accent }} />{q.author}
            </div>
          ) : null}
        </div>
      </ContentFrame>
    );
  }

  if (layout === "team" && slide.people) {
    const people = slide.people.slice(0, 4);
    return (
      <ContentFrame {...content}>
        <Headline slide={slide} theme={theme} edit={edit} />
        <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: `repeat(${people.length}, minmax(0, 1fr))`, gap: 24 }}>
          {people.map((p, i) => (
            <div key={i} style={{ background: theme.surface, borderRadius: 18, padding: "34px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 104, height: 104, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 34, fontWeight: 750, background: tint(theme.accent, 16), color: theme.accent }}>{initials(p.name)}</div>
              <div style={{ marginTop: 22, fontSize: 23, fontWeight: 680, color: theme.text }}>{p.name}</div>
              <div style={{ marginTop: 6, fontSize: 17, lineHeight: 1.4, color: theme.secondary }}>{p.role}</div>
            </div>
          ))}
        </div>
      </ContentFrame>
    );
  }

  if (layout === "agenda") {
    const items = (slide.bullets?.length ? slide.bullets : (slide.steps ?? []).map((s) => s.label)).slice(0, 8);
    return (
      <ContentFrame {...content}>
        <Headline slide={{ ...slide, body: "" }} theme={theme} edit={edit} />
        <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 40, display: "grid", gridTemplateColumns: items.length > 4 ? "1fr 1fr" : "1fr", columnGap: 64 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 26, alignItems: "baseline", borderTop: `1px solid ${theme.border}`, padding: items.length > 4 ? "18px 0" : "20px 0" }}>
              <span style={{ fontFamily: theme.headingFont, fontSize: 30, fontWeight: 750, color: theme.accent, width: 46, fontVariantNumeric: "tabular-nums" }}>{pad2(i + 1)}</span>
              <span style={{ fontSize: 25, fontWeight: 520, color: theme.text }}>{item}</span>
            </div>
          ))}
        </div>
      </ContentFrame>
    );
  }

  // bullets / blank (+ optional image)
  const bullets = slide.bullets ?? [];
  if (slide.imageUrl) {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <ContentFrame {...content} rightInset={560}>
          <Headline slide={slide} theme={theme} edit={edit} maxWidth={560} sizes={[[30, 46], [60, 38]]} />
          {bullets.length > 0 ? (
            <div style={{ marginTop: "auto", marginBottom: "auto", paddingTop: 32, display: "flex", flexDirection: "column" }}>
              {bullets.slice(0, 5).map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", borderTop: `1px solid ${theme.border}`, padding: "14px 0", fontSize: 19, lineHeight: 1.4 }}>
                  <span style={{ color: theme.accent, fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{pad2(i + 1)}</span><span>{b}</span>
                </div>
              ))}
            </div>
          ) : null}
        </ContentFrame>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slide.imageUrl} alt="" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  if (bullets.length === 0) {
    return (
      <ContentFrame {...content}>
        <Editable as="h2" field="title" text={slide.title} {...edit} style={{
          fontFamily: theme.headingFont, fontSize: fit(slide.title, [[34, 56], [70, 46]], 38), fontWeight: 680, lineHeight: 1.1, letterSpacing: "-0.022em", maxWidth: 1040,
        }} />
        {slide.body ? (
          <Editable as="p" field="body" text={slide.body} {...edit} style={{
            marginTop: "auto", marginBottom: 12, fontSize: fit(slide.body, [[140, 34], [260, 28], [420, 23]], 20), lineHeight: 1.45, color: theme.secondary, maxWidth: 1000,
          }} />
        ) : null}
      </ContentFrame>
    );
  }

  return (
    <ContentFrame {...content}>
      <Headline slide={slide} theme={theme} edit={edit} />
      <BulletsBody bullets={bullets} theme={theme} />
    </ContentFrame>
  );
}

// ── Public components ────────────────────────────────────────────────────────

export function SlideCanvas({
  slide, themeKey, slideIndex, total, deckTitle, presentMode = false, onEdit, rounded = true, shadow = true, fixedScale,
}: {
  slide: DeckSlide;
  themeKey: SlideThemeKey;
  slideIndex: number;
  total: number;
  deckTitle: string;
  presentMode?: boolean;
  onEdit?: (field: "title" | "body", value: string) => void;
  rounded?: boolean;
  shadow?: boolean;
  /** render at a fixed scale (e.g. 1 for PDF export) instead of fitting the container */
  fixedScale?: number;
}) {
  const theme = SLIDE_THEMES[themeKey] ?? SLIDE_THEMES[DEFAULT_SLIDE_THEME];
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    if (fixedScale) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w) return;
      setMeasured(h ? Math.min(w / SLIDE_W, h / SLIDE_H) : w / SLIDE_W);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixedScale]);

  const scale = fixedScale ?? measured;
  const edit: EditProps = { editable: !!onEdit && !presentMode, ...(onEdit ? { onEdit } : {}) };
  const slideBox = (
    <div style={{
      position: "relative", width: SLIDE_W * scale, height: SLIDE_H * scale, overflow: "hidden", flexShrink: 0,
      borderRadius: rounded ? Math.max(4, 14 * scale) : 0,
      boxShadow: shadow ? "0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06)" : undefined,
      visibility: scale ? "visible" : "hidden",
    }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <SlideFrame slide={slide} theme={theme} slideIndex={slideIndex} total={total} deckTitle={deckTitle} edit={edit} />
      </div>
    </div>
  );

  if (fixedScale) return slideBox;
  return (
    <div ref={wrapRef} style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
      {slideBox}
    </div>
  );
}

export function SlideThumbnail({ slide, themeKey, index, total = 1, deckTitle = "", active, onClick }: {
  slide: DeckSlide;
  themeKey: SlideThemeKey;
  index: number;
  total?: number;
  deckTitle?: string;
  active: boolean;
  onClick: () => void;
}) {
  const theme = SLIDE_THEMES[themeKey] ?? SLIDE_THEMES[DEFAULT_SLIDE_THEME];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-lg border transition-all duration-150"
      style={{ borderColor: active ? theme.accent : "var(--os-border-soft)", boxShadow: active ? `0 0 0 2px ${theme.accent}55` : undefined }}
    >
      <div className="pointer-events-none" style={{ aspectRatio: "16/9", width: "100%" }}>
        <SlideCanvas slide={slide} themeKey={themeKey} slideIndex={index} total={total} deckTitle={deckTitle} presentMode rounded={false} shadow={false} />
      </div>
      <div
        className="absolute left-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-semibold"
        style={{ background: active ? theme.accent : "rgba(0,0,0,0.45)", color: active ? theme.onAccent : "#fff" }}
      >
        {index + 1}
      </div>
    </button>
  );
}

/** Renders the whole deck off-screen at full size and opens the browser print dialog (→ "Als PDF speichern"). */
export function PrintDeck({ slides, themeKey, deckTitle, onDone }: {
  slides: DeckSlide[];
  themeKey: SlideThemeKey;
  deckTitle: string;
  onDone: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previousTitle = document.title;
    document.title = deckTitle || previousTitle;
    const finish = () => { document.title = previousTitle; onDoneRef.current(); };
    window.addEventListener("afterprint", finish, { once: true });
    const timer = window.setTimeout(() => window.print(), 350);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", finish); document.title = previousTitle; };
  }, [mounted, deckTitle]);

  if (!mounted) return null;
  return createPortal(
    <div id="elyra-print-deck">
      <style>{`
        @media screen { #elyra-print-deck { position: fixed; left: -100000px; top: 0; } }
        @media print {
          @page { size: ${SLIDE_W}px ${SLIDE_H}px; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > *:not(#elyra-print-deck) { display: none !important; }
          #elyra-print-deck { position: static !important; }
          .elyra-print-slide { width: ${SLIDE_W}px; height: ${SLIDE_H}px; overflow: hidden; break-after: page; page-break-after: always;
            -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .elyra-print-slide:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      {slides.map((slide, i) => (
        <div key={i} className="elyra-print-slide">
          <SlideCanvas slide={slide} themeKey={themeKey} slideIndex={i} total={slides.length} deckTitle={deckTitle} presentMode rounded={false} shadow={false} fixedScale={1} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
