/**
 * Builds Google Slides batchUpdate requests that mirror Elyra's in-app slide design:
 * theme colours, hero/section backgrounds, and layout-specific placement
 * (stats cards, comparison columns, timeline, quote, team, agenda) plus speaker notes.
 *
 * Kept free of React so it can run in route handlers. The palette mirrors
 * SLIDE_THEMES in components/os/apps/slides/slideDesign.tsx (solid approximations of gradients).
 */

type Rgb = { red: number; green: number; blue: number };

export type ExportSlide = {
  title: string;
  body?: string;
  bullets?: string[];
  layout?: string;
  stats?: Array<{ value: string; label?: string }>;
  columns?: Array<{ heading?: string; points?: string[] }>;
  steps?: Array<{ label: string; detail?: string }>;
  quote?: { text: string; author?: string };
  people?: Array<{ name: string; role?: string }>;
  notes?: string;
  source?: string;
};

type Palette = {
  bg: string; text: string; muted: string; accent: string; surface: string; border: string;
  heroBg: string; heroText: string; heroMuted: string; onAccent: string; serif: boolean;
};

export const EXPORT_PALETTES: Record<string, Palette> = {
  executive: { bg: "#ffffff", text: "#0b1b33", muted: "#5b6b82", accent: "#1f4fd8", surface: "#f3f6fb", border: "#e3e8f0", heroBg: "#0f2342", heroText: "#ffffff", heroMuted: "#b9c3d3", onAccent: "#ffffff", serif: false },
  minimal: { bg: "#fafaf9", text: "#18181b", muted: "#71717a", accent: "#e8552a", surface: "#f1efec", border: "#e7e5e4", heroBg: "#18181b", heroText: "#fafaf9", heroMuted: "#a8a8a6", onAccent: "#ffffff", serif: false },
  editorial: { bg: "#f7f3ec", text: "#231d18", muted: "#6f655c", accent: "#a4471f", surface: "#efe7da", border: "#e4dacb", heroBg: "#efe6d8", heroText: "#231d18", heroMuted: "#6f655c", onAccent: "#ffffff", serif: true },
  light: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", accent: "#5b5bd6", surface: "#f5f6fb", border: "#e2e8f0", heroBg: "#eceefe", heroText: "#0f172a", heroMuted: "#475569", onAccent: "#ffffff", serif: false },
  corporate: { bg: "#0f172a", text: "#f1f5f9", muted: "#94a3b8", accent: "#60a5fa", surface: "#1a2336", border: "#2a3446", heroBg: "#0b1222", heroText: "#ffffff", heroMuted: "#94a3b8", onAccent: "#0b1222", serif: false },
  cyber: { bg: "#0a1222", text: "#e2f0ff", muted: "#93a5bb", accent: "#55ccff", surface: "#0f1d31", border: "#1b3047", heroBg: "#070d18", heroText: "#e2f0ff", heroMuted: "#93a5bb", onAccent: "#04121d", serif: false },
  gradient: { bg: "#221048", text: "#ede9fe", muted: "#b6addb", accent: "#a78bfa", surface: "#2d1a5a", border: "#3d2a6e", heroBg: "#1a0533", heroText: "#ffffff", heroMuted: "#c7bfe6", onAccent: "#1a0533", serif: false },
  ocean: { bg: "#08293f", text: "#e0f2fe", muted: "#9fbbcd", accent: "#38bdf8", surface: "#0c3550", border: "#164562", heroBg: "#041a28", heroText: "#ffffff", heroMuted: "#a9c6d8", onAccent: "#041a28", serif: false },
  warm: { bg: "#241000", text: "#fef3c7", muted: "#c9b88f", accent: "#f59e0b", surface: "#33190a", border: "#4a2a10", heroBg: "#1c0a00", heroText: "#fff7e0", heroMuted: "#d2c39c", onAccent: "#1c0a00", serif: true },
};

const W = 720;
const H = 405;
const M = 40;

function rgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

function color(hex: string) {
  return { opaqueColor: { rgbColor: rgb(hex) } };
}

type TextOpts = {
  size: number; color: string; bold?: boolean; italic?: boolean; serif?: boolean;
  align?: "START" | "CENTER" | "END"; valign?: "TOP" | "MIDDLE" | "BOTTOM"; lineSpacing?: number; spaceBelow?: number;
  bullets?: boolean;
};

class Builder {
  requests: Array<Record<string, unknown>> = [];
  notes: Array<{ slideId: string; text: string }> = [];
  private n = 0;
  constructor(private p: Palette) {}

  id(prefix: string) { this.n += 1; return `elyra_${prefix}_${String(this.n).padStart(4, "0")}`; }

  slide(index: number, bg: string) {
    const slideId = this.id("s");
    this.requests.push({ createSlide: { objectId: slideId, insertionIndex: index, slideLayoutReference: { predefinedLayout: "BLANK" } } });
    this.requests.push({
      updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb(bg) } } } },
        fields: "pageBackgroundFill.solidFill.color",
      },
    });
    return slideId;
  }

  shape(page: string, type: string, x: number, y: number, w: number, h: number, fill: string, outline?: string) {
    const id = this.id("sh");
    this.requests.push({
      createShape: {
        objectId: id, shapeType: type,
        elementProperties: { pageObjectId: page, size: { width: { magnitude: w, unit: "PT" }, height: { magnitude: h, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" } },
      },
    });
    this.requests.push({
      updateShapeProperties: {
        objectId: id,
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(fill) } } },
          outline: outline
            ? { outlineFill: { solidFill: { color: { rgbColor: rgb(outline) } } }, weight: { magnitude: 0.75, unit: "PT" } }
            : { propertyState: "NOT_RENDERED" },
        },
        fields: outline ? "shapeBackgroundFill.solidFill.color,outline" : "shapeBackgroundFill.solidFill.color,outline.propertyState",
      },
    });
    return id;
  }

  text(page: string, x: number, y: number, w: number, h: number, value: string, o: TextOpts) {
    const text = value.trim();
    if (!text) return null;
    const id = this.id("t");
    this.requests.push({
      createShape: {
        objectId: id, shapeType: "TEXT_BOX",
        elementProperties: { pageObjectId: page, size: { width: { magnitude: w, unit: "PT" }, height: { magnitude: h, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" } },
      },
    });
    this.requests.push({ insertText: { objectId: id, insertionIndex: 0, text } });
    this.requests.push({
      updateTextStyle: {
        objectId: id, textRange: { type: "ALL" },
        style: {
          fontSize: { magnitude: o.size, unit: "PT" }, bold: !!o.bold, italic: !!o.italic,
          foregroundColor: color(o.color),
          weightedFontFamily: { fontFamily: o.serif ? "Lora" : "Inter", weight: o.bold ? 700 : 400 },
        },
        fields: "fontSize,bold,italic,foregroundColor,weightedFontFamily",
      },
    });
    this.requests.push({
      updateParagraphStyle: {
        objectId: id, textRange: { type: "ALL" },
        style: { alignment: o.align ?? "START", lineSpacing: o.lineSpacing ?? 115, spaceBelow: { magnitude: o.spaceBelow ?? 0, unit: "PT" } },
        fields: "alignment,lineSpacing,spaceBelow",
      },
    });
    this.requests.push({
      updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: o.valign ?? "TOP" }, fields: "contentAlignment" },
    });
    if (o.bullets) {
      this.requests.push({ createParagraphBullets: { objectId: id, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
      this.requests.push({
        updateParagraphStyle: {
          objectId: id, textRange: { type: "ALL" },
          style: { indentStart: { magnitude: 16, unit: "PT" }, indentFirstLine: { magnitude: 0, unit: "PT" } },
          fields: "indentStart,indentFirstLine",
        },
      });
    }
    return id;
  }

  /** Header used on every content slide: accent bar, title, footer with deck title and page number. */
  frame(page: string, title: string, deckTitle: string, index: number, total: number, source?: string) {
    const p = this.p;
    this.shape(page, "RECTANGLE", M, 34, 28, 3, p.accent);
    this.text(page, M, 44, W - 2 * M, 56, title, { size: fit(title, [[40, 26], [70, 22]], 18), color: p.text, bold: true, serif: p.serif, valign: "TOP" });
    this.shape(page, "RECTANGLE", M, H - 34, W - 2 * M, 0.75, p.border);
    this.text(page, M, H - 30, 420, 18, source ? `${deckTitle} · Quelle: ${source}` : deckTitle, { size: 8, color: p.muted });
    this.text(page, W - M - 80, H - 30, 80, 18, `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, { size: 8, color: p.muted, align: "END" });
  }
}

function fit(text: string, steps: Array<[number, number]>, min: number) {
  for (const [max, size] of steps) if (text.length <= max) return size;
  return min;
}

function effectiveLayout(s: ExportSlide, index: number, total: number): string {
  if (index === 0) return "title";
  const l = s.layout ?? "bullets";
  if (l === "stats") return s.stats?.length ? l : "bullets";
  if (l === "comparison" || l === "two-col") return (s.columns?.length ?? 0) >= 2 ? "comparison" : "bullets";
  if (l === "timeline") return s.steps?.length ? l : "bullets";
  if (l === "quote") return s.quote?.text ? l : "bullets";
  if (l === "team") return s.people?.length ? l : "bullets";
  if (l === "agenda") return s.bullets?.length || s.steps?.length ? l : "bullets";
  if (l === "closing" || (index === total - 1 && l === "blank")) return "closing";
  return l;
}

export function buildThemedDeckRequests(input: {
  slides: ExportSlide[]; deckTitle: string; theme?: string; firstSlideId?: string;
}): { requests: Array<Record<string, unknown>>; notes: Array<{ slideId: string; text: string }> } {
  const p = EXPORT_PALETTES[input.theme ?? ""] ?? EXPORT_PALETTES.executive!;
  const b = new Builder(p);
  if (input.firstSlideId) b.requests.push({ deleteObject: { objectId: input.firstSlideId } });
  const total = input.slides.length;
  const deckTitle = input.deckTitle.trim();
  const innerW = W - 2 * M;
  const top = 112;

  input.slides.forEach((s, i) => {
    const layout = effectiveLayout(s, i, total);
    const body = (s.body ?? "").trim();
    let page: string;

    switch (layout) {
      case "title":
      case "closing": {
        page = b.slide(i, p.heroBg);
        b.shape(page, "RECTANGLE", 0, 0, 8, H, p.accent);
        if (layout === "title" && deckTitle && deckTitle !== s.title.trim()) {
          b.text(page, 64, 92, 560, 20, deckTitle.toUpperCase(), { size: 10, color: p.accent, bold: true });
        }
        const lift = layout === "closing" && s.bullets?.length ? 40 : 0;
        b.text(page, 64, 118 - lift, 590, 130, s.title, { size: fit(s.title, [[30, 44], [60, 36], [90, 30]], 26), color: p.heroText, bold: true, serif: p.serif, valign: "BOTTOM", lineSpacing: 100 });
        b.shape(page, "RECTANGLE", 64, 262 - lift, 56, 4, p.accent);
        if (layout === "closing" && s.bullets?.length) {
          b.text(page, 64, 278 - lift, 560, 26, body, { size: 15, color: p.heroMuted, lineSpacing: 130 });
          b.text(page, 64, body ? 308 - lift : 280 - lift, 560, 110, s.bullets.slice(0, 4).join("\n"), { size: 13, color: p.heroText, bullets: true, lineSpacing: 120, spaceBelow: 4 });
        } else {
          b.text(page, 64, 278, 560, 70, body || (s.bullets ?? []).slice(0, 2).join(" · "), { size: 15, color: p.heroMuted, lineSpacing: 130 });
        }
        break;
      }
      case "section": {
        page = b.slide(i, p.heroBg);
        b.text(page, 64, 96, 300, 90, String(i).padStart(2, "0"), { size: 72, color: p.accent, bold: true, serif: p.serif });
        b.text(page, 64, 196, 590, 80, s.title, { size: fit(s.title, [[40, 34], [80, 28]], 24), color: p.heroText, bold: true, serif: p.serif });
        b.text(page, 64, 282, 560, 60, body, { size: 14, color: p.heroMuted, lineSpacing: 130 });
        break;
      }
      case "stats": {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const stats = (s.stats ?? []).slice(0, 4);
        const gap = 14;
        const cw = (innerW - gap * (stats.length - 1)) / stats.length;
        const cy = body ? 150 : 130;
        b.text(page, M, top - 4, innerW, 34, body, { size: 13, color: p.muted, lineSpacing: 125 });
        stats.forEach((st, k) => {
          const x = M + k * (cw + gap);
          b.shape(page, "ROUND_RECTANGLE", x, cy, cw, 170, p.surface, p.border);
          b.shape(page, "RECTANGLE", x + 18, cy + 22, 22, 3, p.accent);
          b.text(page, x + 16, cy + 34, cw - 32, 70, st.value, { size: fit(st.value, [[5, 40], [9, 30], [14, 24]], 20), color: p.accent, bold: true, valign: "MIDDLE" });
          b.text(page, x + 16, cy + 108, cw - 32, 52, st.label ?? "", { size: 11.5, color: p.text, lineSpacing: 120 });
        });
        break;
      }
      case "comparison": {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const cols = (s.columns ?? []).slice(0, 2);
        const cw = (innerW - 16) / 2;
        const maxPoints = Math.max(...cols.map((c) => Math.min(6, c.points?.length ?? 0)), 1);
        const chh = Math.min(240, 74 + maxPoints * 26);
        b.text(page, M, top - 4, innerW, 30, body, { size: 13, color: p.muted });
        const ctop = body ? top + 34 : top;
        cols.forEach((c, k) => {
          const x = M + k * (cw + 16);
          // Like the in-app design: left card in the surface colour, right card filled with the accent colour.
          const featured = k === 1;
          const ink = featured ? p.onAccent : p.text;
          b.shape(page, "ROUND_RECTANGLE", x, ctop, cw, chh, featured ? p.accent : p.surface);
          b.text(page, x + 18, ctop + 18, cw - 36, 18, (c.heading ?? "").toUpperCase(), { size: 9.5, color: featured ? p.onAccent : p.muted, bold: true });
          b.text(page, x + 18, ctop + 44, cw - 36, chh - 52, (c.points ?? []).slice(0, 6).join("\n"), { size: 12.5, color: ink, bullets: true, lineSpacing: 120, spaceBelow: 6 });
        });
        break;
      }
      case "timeline": {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const steps = (s.steps ?? []).slice(0, 6);
        const sw = innerW / steps.length;
        const ly = 176;
        b.text(page, M, top - 4, innerW, 34, body, { size: 13, color: p.muted });
        b.shape(page, "RECTANGLE", M + sw / 2, ly + 7, innerW - sw, 2, p.border);
        steps.forEach((st, k) => {
          const cx = M + k * sw + sw / 2;
          b.shape(page, "ELLIPSE", cx - 9, ly - 1, 18, 18, p.accent);
          b.text(page, cx - sw / 2 + 6, ly + 26, sw - 12, 18, String(k + 1).padStart(2, "0"), { size: 9, color: p.accent, bold: true, align: "CENTER" });
          b.text(page, cx - sw / 2 + 6, ly + 44, sw - 12, 40, st.label, { size: 12.5, color: p.text, bold: true, align: "CENTER", lineSpacing: 105 });
          b.text(page, cx - sw / 2 + 6, ly + 86, sw - 12, 90, st.detail ?? "", { size: 10, color: p.muted, align: "CENTER", lineSpacing: 120 });
        });
        break;
      }
      case "quote": {
        page = b.slide(i, p.heroBg);
        b.text(page, 64, 44, 120, 90, "“", { size: 96, color: p.accent, bold: true, serif: true });
        const q = s.quote?.text ?? "";
        b.text(page, 64, 120, 592, 170, q, { size: fit(q, [[90, 30], [160, 24], [260, 20]], 17), color: p.heroText, italic: true, serif: true, lineSpacing: 125, valign: "MIDDLE" });
        if (s.quote?.author) {
          b.shape(page, "RECTANGLE", 64, 306, 32, 3, p.accent);
          b.text(page, 104, 296, 520, 24, s.quote.author, { size: 12, color: p.heroMuted, bold: true, valign: "MIDDLE" });
        }
        break;
      }
      case "team": {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const people = (s.people ?? []).slice(0, 6);
        const perRow = people.length > 3 ? 3 : people.length;
        const cw = (innerW - 14 * (perRow - 1)) / perRow;
        const ch = people.length > 3 ? 108 : 160;
        people.forEach((person, k) => {
          const x = M + (k % perRow) * (cw + 14);
          const y = top + Math.floor(k / perRow) * (ch + 12);
          b.shape(page, "ROUND_RECTANGLE", x, y, cw, ch, p.surface, p.border);
          b.shape(page, "ELLIPSE", x + 16, y + 16, 38, 38, p.accent);
          const ini = person.name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
          b.text(page, x + 16, y + 16, 38, 38, ini, { size: 12, color: p.onAccent, bold: true, align: "CENTER", valign: "MIDDLE" });
          b.text(page, x + 16, y + 60, cw - 32, 20, person.name, { size: 13, color: p.text, bold: true });
          b.text(page, x + 16, y + 80, cw - 32, ch - 88, person.role ?? "", { size: 10.5, color: p.muted, lineSpacing: 115 });
        });
        break;
      }
      case "agenda": {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const items = (s.bullets?.length ? s.bullets : (s.steps ?? []).map((x) => x.label)).slice(0, 6);
        const rh = Math.min(40, 236 / items.length);
        items.forEach((item, k) => {
          const y = top + k * rh;
          b.text(page, M, y, 44, rh, String(k + 1).padStart(2, "0"), { size: 16, color: p.accent, bold: true, valign: "MIDDLE" });
          b.text(page, M + 52, y, innerW - 52, rh, item, { size: 15, color: p.text, valign: "MIDDLE" });
          b.shape(page, "RECTANGLE", M + 52, y + rh - 1, innerW - 52, 0.75, p.border);
        });
        break;
      }
      default: {
        page = b.slide(i, p.bg);
        b.frame(page, s.title, deckTitle, i, total, s.source);
        const bullets = (s.bullets ?? []).slice(0, 7);
        if (bullets.length) {
          const hasBody = !!body;
          if (hasBody) b.text(page, M, top - 4, innerW, 40, body, { size: 13, color: p.muted, lineSpacing: 125 });
          b.text(page, M, hasBody ? top + 42 : top + 4, bullets.length > 4 ? innerW : innerW * 0.78, 220, bullets.join("\n"), {
            size: bullets.length > 5 ? 14 : 16, color: p.text, bullets: true, lineSpacing: 120, spaceBelow: 9,
          });
        } else {
          b.shape(page, "RECTANGLE", M, top + 2, 3, 120, p.accent);
          b.text(page, M + 18, top, innerW * 0.8, 230, body, { size: fit(body, [[120, 22], [260, 18], [420, 15]], 13), color: p.text, lineSpacing: 135 });
        }
      }
    }
    if (s.notes?.trim()) b.notes.push({ slideId: page, text: s.notes.trim() });
  });

  return { requests: b.requests, notes: b.notes };
}
