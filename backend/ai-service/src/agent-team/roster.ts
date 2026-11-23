import type { AgentCategory, AgentId, AgentOutput, CodeFile, DeckSlide, DesignSpec, LogoVariant } from "./types.js";
import { callGeminiWithSearch, leadFacts, mailCalendarFacts, reportingFacts, type ToolContext } from "./tools.js";

type Provider = "gemini" | "vertex" | "anthropic" | "openai";

export type AgentDefinition = {
  id: AgentId;
  name: string;
  category: AgentCategory;
  /** Lesendes Werkzeug: liefert Fakten, bevor das Modell arbeitet */
  gather?: (ctx: ToolContext) => Promise<string>;
  /** Eigener Modellaufruf (z. B. mit Websuche) statt des normalen Routers */
  call?: (system: string, user: string) => Promise<{ text: string; model: string }>;
  /** Kurzbeschreibung für Planer und Oberfläche */
  role: string;
  /** Bevorzugtes Modell – der Router fällt automatisch auf andere Anbieter zurück */
  preferredProvider: Provider;
  json: boolean;
  phase: 1 | 2;
  system: string;
  /** Rohtext des Modells in ein geprüftes Ergebnis umwandeln (wirft bei ungültiger Antwort) */
  parse: (raw: string) => AgentOutput;
  /** Vorlage, wenn kein Modell erreichbar ist – klar als Vorlage gekennzeichnet */
  template: (task: string, brief: string) => AgentOutput;
};

const COMMON_RULES = `Allgemeine Regeln:
- Antworte auf Deutsch (außer Code).
- Erfinde keine Fakten, Kundendaten, Zahlen, Studien oder Zitate. Wenn dir Daten fehlen, sag das und arbeite mit klar markierten Annahmen.
- Keine Versprechen über Ergebnisse ("garantiert", "verdoppelt").
- Du lieferst Entwürfe. Ein Mensch prüft und gibt frei, bevor etwas umgesetzt wird.`;

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json|html|[a-z]+)?\s*/i, "").replace(/```\s*$/, "").trim();
}

function parseJson(raw: string): Record<string, unknown> {
  const text = stripFences(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Antwort enthielt kein JSON");
  const value = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON ist kein Objekt");
  return value as Record<string, unknown>;
}

const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, maxItems = 12, maxLen = 300): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];

/** Entfernt Skripte, Event-Handler und externe Ressourcen aus dem Design-HTML. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(iframe|object|embed|link|meta|base|form)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/url\(\s*['"]?https?:[^)]*\)/gi, "none")
    .slice(0, 30_000);
}

/** Bereinigt SVG: keine Skripte, Event-Handler, externen Verweise oder eingebettetes HTML. */
export function sanitizeSvg(svg: string): string {
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start === -1 || end === -1) return "";
  return svg
    .slice(start, end + 6)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(image|use|a|iframe|object|embed)\b[^>]*>(?:[\s\S]*?<\/\1>)?/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/url\(\s*['"]?(https?:|data:)[^)]*\)/gi, "none")
    .replace(/^<svg(?![^>]*\bxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    .slice(0, 40_000);
}

const LOGO_WORDS = /\b(logo|logos|signet|wortmarke|wort-bild-marke|bildmarke|icon|favicon|emblem)\b/i;
export const isLogoTask = (text: string) => LOGO_WORDS.test(text);

const LAYOUTS = new Set(["title", "bullets", "two-col", "stats", "comparison", "timeline", "quote"]);

function parseSlides(value: unknown): DeckSlide[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 14).flatMap((raw): DeckSlide[] => {
    if (!raw || typeof raw !== "object") return [];
    const s = raw as Record<string, unknown>;
    const title = str(s["title"], 120);
    if (!title) return [];
    const layout = typeof s["layout"] === "string" && LAYOUTS.has(s["layout"]) ? (s["layout"] as DeckSlide["layout"]) : "bullets";
    const slide: DeckSlide = { title, body: str(s["body"], 600), layout };
    const bullets = strArr(s["bullets"], 7, 160);
    if (bullets.length) slide.bullets = bullets;
    if (Array.isArray(s["stats"])) {
      const stats = (s["stats"] as unknown[]).flatMap((x) => {
        const o = x as Record<string, unknown>;
        return o && str(o["value"]) ? [{ value: str(o["value"], 24), label: str(o["label"], 60) }] : [];
      }).slice(0, 3);
      if (stats.length) slide.stats = stats;
    }
    if (Array.isArray(s["columns"])) {
      const columns = (s["columns"] as unknown[]).flatMap((x) => {
        const o = x as Record<string, unknown>;
        return o && str(o["heading"]) ? [{ heading: str(o["heading"], 60), points: strArr(o["points"], 5, 140) }] : [];
      }).slice(0, 3);
      if (columns.length) slide.columns = columns;
    }
    if (Array.isArray(s["steps"])) {
      const steps = (s["steps"] as unknown[]).flatMap((x) => {
        const o = x as Record<string, unknown>;
        if (!o || !str(o["label"])) return [];
        const detail = str(o["detail"], 140);
        return [detail ? { label: str(o["label"], 60), detail } : { label: str(o["label"], 60) }];
      }).slice(0, 6);
      if (steps.length) slide.steps = steps;
    }
    const notes = str(s["notes"], 800);
    if (notes) slide.notes = notes;
    return [slide];
  });
}

/** Hilfsfunktion für Agenten, die Markdown liefern. */
function mdAgent(def: {
  id: AgentId; name: string; category: AgentCategory; role: string; preferredProvider: Provider; system: string; template: string;
  gather?: AgentDefinition["gather"]; call?: AgentDefinition["call"];
}): AgentDefinition {
  return {
    id: def.id, name: def.name, category: def.category, role: def.role, preferredProvider: def.preferredProvider,
    json: false, phase: 1,
    system: `${def.system}\n${COMMON_RULES}`,
    ...(def.gather ? { gather: def.gather } : {}),
    ...(def.call ? { call: def.call } : {}),
    parse: (raw) => {
      const markdown = stripFences(raw);
      if (markdown.length < 40) throw new Error("Antwort zu kurz");
      return { kind: "markdown", markdown };
    },
    template: () => ({ kind: "markdown", markdown: def.template }),
  };
}

export const AGENTS: Record<AgentId, AgentDefinition> = {
  marketing: {
    id: "marketing",
    category: "marketing",
    name: "Online-Marketing",
    role: "Strategie, Zielgruppen, Kanäle (Search, Social, Display), Keywords, Budget-Logik, KPIs und Messung",
    preferredProvider: "gemini",
    json: false,
    phase: 1,
    system: `Du bist der Online-Marketing-Agent im Elyra-Agenten-Team einer Performance-Agentur.
Liefere eine umsetzbare Marketing-Strategie in Markdown mit diesen Abschnitten:
### Ziel & Zielgruppe, ### Kanäle & Maßnahmen (mit Begründung), ### Keywords / Targeting (Beispiele),
### KPIs & Messung (welche Kennzahlen, wie tracken), ### Risiken & Annahmen.
Wenn im Kontext berechnete Zahlen (z. B. aus einem Ads-Audit) stehen, nutze genau diese Zahlen und nenne die Quelle.
${COMMON_RULES}`,
    parse: (raw) => {
      const markdown = stripFences(raw);
      if (markdown.length < 40) throw new Error("Antwort zu kurz");
      return { kind: "markdown", markdown };
    },
    template: (task) => ({
      kind: "markdown",
      markdown: `### Ziel & Zielgruppe\n_Vorlage ohne KI – bitte ergänzen._ Auftrag: ${task}\n\n### Kanäle & Maßnahmen\n- Google Search: Nachfrage abholen (Marken- und generische Keywords)\n- Performance Max / Shopping: Produkte sichtbar machen (falls Shop)\n- Meta: Zielgruppen aufbauen, Remarketing\n\n### KPIs & Messung\n- Conversions, CPA, ROAS, Conversion-Rate\n- Tracking: GA4-Schlüsselereignisse + Google-Ads-Conversion-Tag prüfen\n\n### Risiken & Annahmen\n- Budget, Marge und Zielwerte sind noch unbekannt.`,
    }),
  },

  copy: {
    id: "copy",
    category: "marketing",
    name: "Texter",
    role: "Anzeigentexte (RSA-Titel ≤ 30 Zeichen, Beschreibungen ≤ 90 Zeichen), Social-Posts, Landingpage-Texte, Betreffzeilen",
    preferredProvider: "anthropic",
    json: false,
    phase: 1,
    system: `Du bist der Texter-Agent im Elyra-Agenten-Team.
Liefere Markdown mit: ### Anzeigentitel (8–10 Stück, je höchstens 30 Zeichen, Zeichenzahl in Klammern dahinter),
### Beschreibungen (4 Stück, je höchstens 90 Zeichen, Zeichenzahl in Klammern), ### Landingpage (Headline, Subline, 3 Nutzenpunkte, Call-to-Action),
### Social-Post (1 Beispiel). Halte die Zeichenlimits strikt ein. Klar, konkret, ohne Superlative, die man nicht belegen kann.
${COMMON_RULES}`,
    parse: (raw) => {
      const markdown = stripFences(raw);
      if (markdown.length < 40) throw new Error("Antwort zu kurz");
      return { kind: "markdown", markdown };
    },
    template: () => ({
      kind: "markdown",
      markdown: "### Anzeigentitel\n_Vorlage ohne KI – kein Modell erreichbar._\n- [Produkt] online kaufen\n- Kostenloser Versand ab [Betrag]\n- [Marke] – direkt vom Hersteller\n\n### Beschreibungen\n- [Nutzen 1]. [Nutzen 2]. Jetzt entdecken.\n\n### Landingpage\n**Headline:** [Kernversprechen]\n**CTA:** Jetzt ansehen",
    }),
  },

  design: {
    id: "design",
    category: "creative",
    name: "Design",
    role: "Logos (Vektor-Entwürfe + Bildvorlagen), Farbpalette, Schriften, Gestaltungsprinzipien, HTML-Entwürfe für Landingpages/Anzeigen",
    preferredProvider: "gemini",
    json: true,
    phase: 1,
    system: `Du bist der Design-Agent im Elyra-Agenten-Team – ein erfahrener Brand- und UI-Designer.
Entscheide zuerst, was verlangt ist: "logo" (Logo, Signet, Wortmarke, Icon) oder "hero" (Landingpage, Banner, Anzeige, Look).
Liefere GENAU das Verlangte – bei einem Logo KEINE Landingpage.
Antworte NUR mit JSON:
{"deliverable": "logo" | "hero",
 "markdown": string (Konzept in 3–5 Sätzen: Idee, Symbolik, Einsatz),
 "palette": [{"name": string, "hex": "#RRGGBB"}] (3–5 Farben),
 "fonts": {"heading": string, "body": string},
 "principles": string[] (3–5 Regeln),
 "logos": [ NUR bei "logo": GENAU 3 unterschiedliche Richtungen, je {"name": string, "idea": string (1 Satz),
   "svg": string (vollständiges <svg> mit viewBox="0 0 640 320", Hintergrund transparent oder eine Fläche,
   Bildmarke links + Wortmarke rechts ODER zentriert; nur einfache geometrische Formen (path, circle, rect, polygon, line, text),
   maximal 12 Elemente, saubere Abstände, Schrift über font-family z. B. "Inter, Helvetica, Arial, sans-serif",
   Markenname exakt wie im Auftrag geschrieben, KEIN Skript, KEINE Bilder, KEINE externen Links)} ],
 "imagePrompts": [ NUR bei "logo": 3 englische Prompts für ein Bildmodell, je eine Richtung: "minimal flat vector logo for '<Name>', <Symbol-Idee>,
   <Farben>, clean geometric shapes, centered on plain white background, no mockup, no 3D, no extra text" ],
 "html": string (NUR bei "hero": eigenständiger HTML-Entwurf, max. 480px hoch, Inline-CSS oder <style>, KEIN JavaScript,
   KEINE externen Ressourcen; bei "logo" leerer String)}
Qualität vor Menge: lieber reduziert und präzise als verspielt. Keine Klischees wie Glühbirnen oder Zahnräder, außer sie sind begründet.
${COMMON_RULES}`,
    parse: (raw) => {
      const o = parseJson(raw);
      const palette = Array.isArray(o["palette"])
        ? (o["palette"] as unknown[]).flatMap((x) => {
            const p = x as Record<string, unknown>;
            const hex = str(p?.["hex"], 9);
            return /^#[0-9a-f]{6}$/i.test(hex) ? [{ name: str(p["name"], 40) || hex, hex }] : [];
          }).slice(0, 8)
        : [];
      const fontsRaw = (o["fonts"] ?? {}) as Record<string, unknown>;
      const logos: LogoVariant[] = Array.isArray(o["logos"])
        ? (o["logos"] as unknown[]).flatMap((x) => {
            const l = x as Record<string, unknown>;
            const svg = sanitizeSvg(str(l?.["svg"], 60_000));
            return svg ? [{ name: str(l["name"], 60) || "Entwurf", idea: str(l["idea"], 300), svg }] : [];
          }).slice(0, 4)
        : [];
      const deliverable = o["deliverable"] === "logo" || (logos.length > 0 && o["deliverable"] !== "hero") ? "logo" : "hero";
      const html = deliverable === "hero" ? sanitizeHtml(str(o["html"], 40_000)) : "";
      if (palette.length < 2) throw new Error("Farbpalette fehlt");
      if (deliverable === "logo" && logos.length < 2) throw new Error("Zu wenige gültige Logo-Entwürfe");
      if (deliverable === "hero" && !html) throw new Error("HTML-Entwurf fehlt");
      const design: DesignSpec = {
        deliverable,
        palette,
        fonts: { heading: str(fontsRaw["heading"], 60) || "system-ui", body: str(fontsRaw["body"], 60) || "system-ui" },
        principles: strArr(o["principles"], 6, 200),
        html,
        logos,
        imagePrompts: deliverable === "logo" ? strArr(o["imagePrompts"], 4, 600) : [],
      };
      return { kind: "design", markdown: str(o["markdown"], 2000), design };
    },
    template: (task) => {
      const name = (task.match(/f(?:ü|ue)r\s+(.+)$/i)?.[1] ?? task).replace(/[<>&"]/g, "").trim().slice(0, 40);
      const base = {
        palette: [
          { name: "Tinte", hex: "#1F2430" },
          { name: "Akzent", hex: "#7B61FF" },
          { name: "Signal", hex: "#16A34A" },
          { name: "Fläche", hex: "#F6F5FB" },
        ],
        fonts: { heading: "system-ui", body: "system-ui" },
        principles: ["Eine Kernbotschaft pro Fläche", "Viel Weißraum", "Akzentfarbe nur für Handlungsaufforderungen"],
      };
      if (isLogoTask(task)) {
        return {
          kind: "design",
          markdown: "_Vorlage ohne KI – kein Modell erreichbar._ Schlichte Wortmarke als Platzhalter.",
          design: {
            ...base,
            deliverable: "logo",
            html: "",
            logos: [{
              name: "Platzhalter",
              idea: "Kreis als Bildmarke, Name als Wortmarke",
              svg: sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><circle cx="150" cy="160" r="70" fill="#7B61FF"/><text x="250" y="180" font-family="Inter, Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#1F2430">${name}</text></svg>`),
            }],
            imagePrompts: [],
          },
        };
      }
      return {
        kind: "design",
        markdown: "_Vorlage ohne KI – kein Modell erreichbar._ Neutrales, gut lesbares Grundkonzept als Startpunkt.",
        design: {
          ...base,
          deliverable: "hero",
          logos: [],
          imagePrompts: [],
          html: sanitizeHtml(`<div style="font-family:system-ui;background:#F6F5FB;padding:48px;border-radius:16px">
<p style="color:#7B61FF;font-weight:600;margin:0 0 8px">Entwurf</p>
<h1 style="color:#1F2430;font-size:34px;margin:0 0 12px">${task.replace(/[<>&"]/g, "").slice(0, 80)}</h1>
<p style="color:#1F2430;opacity:.7;margin:0 0 24px">Kernnutzen in einem Satz.</p>
<span style="background:#7B61FF;color:#fff;padding:12px 20px;border-radius:10px">Jetzt ansehen</span></div>`),
        },
      };
    },
  },

  coding: {
    id: "coding",
    category: "dev",
    name: "Coding",
    role: "Scripts, Automatisierungen und kleine Tools (z. B. Google-Ads-Scripts, Tracking-Snippets, API-Anbindungen)",
    preferredProvider: "openai",
    json: true,
    phase: 1,
    system: `Du bist der Coding-Agent im Elyra-Agenten-Team einer Marketing-Agentur.
Antworte NUR mit JSON:
{"markdown": string (Was der Code macht, wie man ihn einrichtet, Grenzen – kurz),
 "files": [{"path": string, "language": string, "content": string}] (1–3 Dateien)}
Regeln: Lauffähiger, kommentierter Code. Keine Geheimnisse oder API-Schlüssel im Code (Platzhalter verwenden).
Änderungen an Werbekonten standardmäßig im Prüfmodus (DRY_RUN = true). Keine Netzwerkzugriffe auf unbekannte Hosts.
${COMMON_RULES}`,
    parse: (raw) => {
      const o = parseJson(raw);
      const files: CodeFile[] = Array.isArray(o["files"])
        ? (o["files"] as unknown[]).flatMap((x) => {
            const f = x as Record<string, unknown>;
            const content = str(f?.["content"], 60_000);
            const path = str(f?.["path"], 120).split(/[\\/]+/).filter((seg) => seg && seg !== "." && seg !== "..").join("/");
            return content && path ? [{ path, language: str(f["language"], 30) || "text", content }] : [];
          }).slice(0, 3)
        : [];
      if (!files.length) throw new Error("Keine Dateien geliefert");
      return { kind: "code", markdown: str(o["markdown"], 3000), files };
    },
    template: () => ({
      kind: "code",
      markdown: "_Vorlage ohne KI – kein Modell erreichbar._ Gerüst für ein Google-Ads-Script im Prüfmodus.",
      files: [{
        path: "google-ads-script.js",
        language: "javascript",
        content: "// Gerüst – Logik ergänzen\nconst CONFIG = { DRY_RUN: true, EMAIL: 'name@example.com' };\n\nfunction main() {\n  // 1. Daten per AdsApp.search(GAQL) lesen\n  // 2. Auffälligkeiten berechnen\n  // 3. Im DRY_RUN nur melden, sonst ändern\n  Logger.log('Prüfmodus: ' + CONFIG.DRY_RUN);\n}\n",
      }],
    }),
  },

  presentation: {
    id: "presentation",
    category: "creative",
    name: "Präsentation",
    role: "Baut aus den Ergebnissen der anderen Agenten eine Präsentation für Kunde oder Team",
    preferredProvider: "gemini",
    json: true,
    phase: 2,
    system: `Du bist der Präsentations-Agent im Elyra-Agenten-Team. Du bekommst den Auftrag und die Ergebnisse der anderen Agenten.
Antworte NUR mit JSON:
{"markdown": string (2 Sätze: Aufbau der Präsentation),
 "title": string,
 "slides": [ 6–10 Folien, jede: {"title": string, "body": string, "layout": "title"|"bullets"|"stats"|"comparison"|"timeline"|"quote",
   "bullets"?: string[] (max. 5), "stats"?: [{"value": string, "label": string}] (max. 3),
   "columns"?: [{"heading": string, "points": string[]}] (für comparison, 2 Spalten),
   "steps"?: [{"label": string, "detail": string}] (für timeline), "notes": string (Sprechernotizen)} ]}
Erste Folie layout "title", letzte Folie "Nächste Schritte" als timeline. Nur Zahlen verwenden, die in den Ergebnissen stehen.
${COMMON_RULES}`,
    parse: (raw) => {
      const o = parseJson(raw);
      const slides = parseSlides(o["slides"]);
      if (slides.length < 3) throw new Error("Zu wenige gültige Folien");
      return { kind: "deck", markdown: str(o["markdown"], 1000), deck: { title: str(o["title"], 120) || slides[0]!.title, slides } };
    },
    template: (task) => ({
      kind: "deck",
      markdown: "_Vorlage ohne KI – kein Modell erreichbar._ Grundgerüst zum Ausfüllen.",
      deck: {
        title: task.slice(0, 100),
        slides: [
          { title: task.slice(0, 100), body: "Entwurf", layout: "title" },
          { title: "Ausgangslage", body: "", layout: "bullets", bullets: ["Ziel", "Zielgruppe", "Rahmen"] },
          { title: "Strategie", body: "", layout: "bullets", bullets: ["Kanäle", "Botschaften", "Messung"] },
          { title: "Nächste Schritte", body: "", layout: "timeline", steps: [{ label: "Freigabe" }, { label: "Umsetzung" }, { label: "Review" }] },
        ],
      },
    }),
  },
  sea: mdAgent({
    id: "sea", name: "SEA-Analyst", category: "marketing", preferredProvider: "gemini",
    role: "Google-Ads-Analyse: Verschwendung, Ausschlüsse, Gebote, Kampagnenstruktur",
    system: `Du bist der SEA-Analyst im Elyra-Agenten-Team (Google Ads, Microsoft Ads).
Wenn im Kontext "Ads-Audit-Fakten" stehen, arbeite NUR mit diesen berechneten Zahlen und nenne sie.
Ohne Daten: erkläre, welche Berichte du brauchst, und gib eine Prüfliste.
Markdown: ### Befund, ### Sofortmaßnahmen (nummeriert, mit Begründung), ### Struktur & Gebote, ### Was ich noch brauche.`,
    template: "### Befund\n_Vorlage ohne KI._ Lade einen Suchbegriff-Bericht hoch, dann rechnet das Ads Audit die Zahlen.\n\n### Prüfliste\n- Suchbegriffe ohne Conversion\n- Teure Keywords (CPA)\n- Klickzeiten\n- Conversion-Tracking",
  }),
  reporting: {
    id: "reporting", name: "Reporting", category: "marketing", preferredProvider: "gemini", json: true, phase: 1,
    role: "Kundenreport aus Kampagnendaten – Text und fertiges Deck",
    system: `Du bist der Reporting-Agent im Elyra-Agenten-Team. Du bekommst unter "werkzeugDaten" berechnete Kampagnen-Kennzahlen.
Antworte NUR mit JSON: {"markdown": string (Kundenbericht: ### Überblick, ### Highlights, ### Probleme, ### Empfehlungen – nur Zahlen aus den Daten),
 "title": string, "slides": [6–8 Folien im Format {"title","body","layout":"title"|"bullets"|"stats"|"comparison"|"timeline","bullets"?,"stats"?,"columns"?,"steps"?,"notes"}]}
Erste Folie "title", eine "stats"-Folie mit den Gesamtzahlen, letzte Folie "Nächste Schritte" als timeline.
Weise darauf hin, wenn es Beispieldaten sind.
${COMMON_RULES}`,
    gather: () => reportingFacts(),
    parse: (raw) => {
      const o = parseJson(raw);
      const slides = parseSlides(o["slides"]);
      if (slides.length < 3) throw new Error("Zu wenige gültige Folien");
      return { kind: "deck", markdown: str(o["markdown"], 6000), deck: { title: str(o["title"], 120) || slides[0]!.title, slides } };
    },
    template: (task) => AGENTS.presentation.template(task, task),
  },
  seo: mdAgent({
    id: "seo", name: "SEO", category: "marketing", preferredProvider: "gemini",
    role: "Keywords, Seitenstruktur, Meta-Texte, Content-Briefings",
    system: `Du bist der SEO-Agent im Elyra-Agenten-Team. Du hast KEINE Suchvolumen-Daten – nenne keine Volumina, sondern ordne Keywords nach Suchabsicht.
Markdown: ### Keyword-Cluster (Tabelle: Cluster | Beispiel-Keywords | Suchabsicht | Zielseite), ### Seitenstruktur,
### Meta-Titel & Beschreibungen (Titel ≤ 60 Zeichen, Beschreibung ≤ 155 Zeichen, Zeichenzahl in Klammern),
### Content-Briefing (für die wichtigste Seite), ### Technische Prüfpunkte.`,
    template: "### Keyword-Cluster\n_Vorlage ohne KI._\n| Cluster | Keywords | Absicht | Seite |\n|---|---|---|---|\n| Produkt | … | transaktional | Kategorie |\n\n### Technische Prüfpunkte\n- Ladezeit, Indexierung, interne Verlinkung",
  }),
  social: mdAgent({
    id: "social", name: "Social Media", category: "marketing", preferredProvider: "anthropic",
    role: "Redaktionsplan, Posts je Kanal, Bildideen",
    system: `Du bist der Social-Media-Agent im Elyra-Agenten-Team.
Markdown: ### Redaktionsplan (Tabelle: Tag | Kanal | Format | Thema), ### Posts (3–5 fertige Posts mit Kanal, Text, Hashtags, Bildidee),
### Tonalität. Passe Länge und Stil an den Kanal an (LinkedIn sachlich, Instagram visuell, TikTok kurz).`,
    template: "### Redaktionsplan\n_Vorlage ohne KI._\n| Tag | Kanal | Format | Thema |\n|---|---|---|---|\n| Mo | LinkedIn | Text | … |",
  }),
  leads: mdAgent({
    id: "leads", name: "Lead-Recherche", category: "marketing", preferredProvider: "anthropic",
    role: "Passende Firmen finden, bewerten, Erstansprache entwerfen",
    system: `Du bist der Lead-Agent im Elyra-Agenten-Team. Unter "werkzeugDaten" stehen bewertete Leads aus der Leads-App (fiktive Beispieldaten).
Markdown: ### Top-Leads (Tabelle: Firma | Stadt | Score | Warum), ### Ansprache (2 kurze, persönliche E-Mail-Entwürfe für die besten Leads, je ≤ 120 Wörter),
### Nächste Schritte. Erfinde keine Firmen außerhalb der Daten. Kennzeichne die Daten als Beispieldaten.`,
    gather: (ctx) => leadFacts(ctx),
    template: "### Top-Leads\n_Vorlage ohne KI._ Öffne die App „Leads“ für die bewerteten Beispiel-Leads.",
  }),
  competitor: mdAgent({
    id: "competitor", name: "Wettbewerb", category: "marketing", preferredProvider: "anthropic",
    role: "Positionierung, Angebote und Botschaften der Konkurrenz vergleichen",
    system: `Du bist der Wettbewerbs-Agent im Elyra-Agenten-Team. Du kannst NICHT im Web suchen.
Arbeite nur mit dem, was im Auftrag oder Kontext über Wettbewerber steht, und mit allgemeinem Marktwissen, das du als solches kennzeichnest.
Markdown: ### Vergleich (Tabelle: Anbieter | Positionierung | Stärken | Lücken), ### Chancen für uns, ### Was noch recherchiert werden muss
(Tipp: den Recherche-Agenten mit Websuche nutzen).`,
    template: "### Vergleich\n_Vorlage ohne KI._ Nenne im Kontext 2–4 Wettbewerber mit Website.",
  }),
  tracking: {
    id: "tracking", name: "Tracking & Daten", category: "marketing", preferredProvider: "openai", json: true, phase: 1,
    role: "GA4-/Conversion-Setup prüfen, Tracking-Pläne, dataLayer-Snippets",
    system: `Du bist der Tracking-Agent im Elyra-Agenten-Team (GA4, Google Tag Manager, Google-Ads-Conversions, Consent Mode).
Antworte NUR mit JSON: {"markdown": string (### Tracking-Plan als Tabelle: Ereignis | Auslöser | Parameter | Ziel, ### Prüfliste, ### Datenschutz-Hinweise),
 "files": [{"path": string, "language": string, "content": string}] (1–2 Dateien, z. B. dataLayer-Snippet oder GTM-Notizen)}
Keine echten IDs oder Schlüssel – Platzhalter wie G-XXXXXXX verwenden. Consent beachten.
${COMMON_RULES}`,
    parse: (raw) => AGENTS.coding.parse(raw),
    template: () => ({ kind: "code", markdown: "_Vorlage ohne KI._ Beispiel-dataLayer für einen Kauf.", files: [{ path: "datalayer-purchase.js", language: "javascript", content: "window.dataLayer = window.dataLayer || [];\nwindow.dataLayer.push({\n  event: 'purchase',\n  ecommerce: { transaction_id: 'T123', value: 0, currency: 'EUR', items: [] }\n});\n" }] }),
  },
  application: mdAgent({
    id: "application", name: "Bewerbung", category: "personal", preferredProvider: "anthropic",
    role: "Stellenanzeige analysieren, CV anpassen, Anschreiben oder Video-Skript",
    system: `Du bist der Bewerbungs-Agent im Elyra-Agenten-Team. Im Kontext stehen meist Stellenanzeige und/oder Lebenslauf.
Erfinde NIE Stationen, Zahlen, Abschlüsse oder Ergebnisse – nutze nur, was im Kontext steht, und markiere Lücken.
Markdown: ### Passung (Stärken, Lücken, wie man die Lücke anspricht), ### CV-Anpassungen (konkrete Änderungen),
### Anschreiben oder Video-Skript (je nachdem, was die Anzeige verlangt; Sprache der Anzeige), ### Gehalt (nur wenn gefragt, marktgerecht mit Spanne).`,
    template: "### Passung\n_Vorlage ohne KI._ Füge Stellenanzeige und Lebenslauf in den Kontext ein.",
  }),
  mail: mdAgent({
    id: "mail", name: "Mail & Termine", category: "personal", preferredProvider: "anthropic",
    role: "Posteingang sortieren, Antworten entwerfen, freie Termine finden (nur lesend)",
    system: `Du bist der Mail-&-Termine-Agent im Elyra-Agenten-Team. Unter "werkzeugDaten" stehen Mails und Termine (nur gelesen).
Du kannst NICHTS senden und KEINE Termine anlegen – du lieferst Entwürfe.
Markdown: ### Wichtig (was Antwort oder Handlung braucht, mit Absender/Betreff), ### Antwort-Entwürfe (max. 3),
### Freie Zeitfenster (aus den Terminen abgeleitet), ### Kann warten. Wenn Google nicht verbunden ist, sag das klar.`,
    gather: (ctx) => mailCalendarFacts(ctx),
    template: "### Wichtig\n_Vorlage ohne KI._ Für Mails und Termine Google in den Einstellungen verbinden.",
  }),
  authority: mdAgent({
    id: "authority", name: "Behörden-Brief", category: "personal", preferredProvider: "anthropic",
    role: "Formelle Briefe an Behörden, Arbeitgeber, Vermieter – Portugiesisch mit deutscher Übersetzung",
    system: `Du bist der Behörden-Brief-Agent im Elyra-Agenten-Team (Schwerpunkt Portugal: Finanças, Segurança Social, SNS, ACT, Vermieter, Arbeitgeber).
Markdown: ### Brief (Portugiesisch, formell, mit Betreff "Assunto:", Anrede, Bezug, Anliegen, Bitte, Grußformel, Platzhalter in [eckigen Klammern] für NIF, Aktenzeichen usw.),
### Deutsche Übersetzung, ### Hinweise (Fristen, Anlagen, Versandweg – nur allgemein, keine Rechtsberatung).
Erfinde keine Gesetzesartikel oder Aktenzeichen.`,
    template: "### Brief\n_Vorlage ohne KI._\nAssunto: [Betreff]\n\nExmos. Senhores,\n\n[Anliegen]\n\nCom os melhores cumprimentos,\n[Nome]",
  }),
  research: mdAgent({
    id: "research", name: "Recherche", category: "personal", preferredProvider: "gemini",
    role: "Websuche mit Quellen (Gemini + Google-Suche)",
    system: `Du bist der Recherche-Agent im Elyra-Agenten-Team und nutzt die Google-Suche.
Beantworte den Auftrag sachlich auf Deutsch: ### Kurzantwort (3–5 Sätze), ### Details (gegliedert), ### Unsicherheiten.
Stütze dich auf die Suchergebnisse, nenne Datum/Stand, wenn relevant. Keine Quellenliste schreiben – die wird automatisch angehängt.`,
    call: (system, user) => callGeminiWithSearch(system, user),
    template: "### Kurzantwort\n_Websuche nicht verfügbar._ Für Recherchen wird ein Gemini-API-Schlüssel (GEMINI_API_KEY) benötigt.",
  }),
  coach: mdAgent({
    id: "coach", name: "Lern-Coach", category: "personal", preferredProvider: "gemini",
    role: "Lern- und Übungspläne für neue Fähigkeiten (Tools, Sprachen, Weiterbildung)",
    system: `Du bist der Lern-Coach im Elyra-Agenten-Team. Du erstellst Lernpläne, z. B. für neue Tools, Sprachen oder Weiterbildungen im Team.
Markdown: ### Ziel & Niveau, ### Plan (Tabelle: Tag | Übung | Dauer), ### Heute starten (3 konkrete Übungen mit Anleitung), ### Fortschritt messen.
Realistisch: kurze tägliche Einheiten statt Marathon-Sessions.`,
    template: "### Plan\n_Vorlage ohne KI._\n| Tag | Übung | Dauer |\n|---|---|---|\n| 1 | Grundlage | 15 min |",
  }),
  review: mdAgent({
    id: "review", name: "Code-Review", category: "dev", preferredProvider: "anthropic",
    role: "Code auf Fehler, Sicherheit und Lesbarkeit prüfen",
    system: `Du bist der Code-Review-Agent im Elyra-Agenten-Team. Der Code steht im Kontext (oder im Auftrag).
Markdown: ### Zusammenfassung, ### Fehler & Risiken (nach Schwere: kritisch/mittel/gering, jeweils Stelle + Begründung + Vorschlag),
### Sicherheit, ### Lesbarkeit & Wartbarkeit, ### Verbesserter Ausschnitt (nur wo sinnvoll, als Codeblock).
Wenn kein Code mitgeschickt wurde, sag das und frag danach. Erfinde keine Zeilen, die nicht im Code stehen.`,
    template: "### Zusammenfassung\n_Vorlage ohne KI._ Füge den Code in den Kontext ein.",
  }),
  qa: {
    id: "qa", name: "QA / Tester", category: "dev", preferredProvider: "openai", json: true, phase: 1,
    role: "Tests schreiben und Testfälle planen",
    system: `Du bist der QA-Agent im Elyra-Agenten-Team. Der zu testende Code oder die Funktion steht im Kontext oder Auftrag.
Antworte NUR mit JSON: {"markdown": string (### Testplan als Tabelle: Fall | Eingabe | Erwartung, ### Randfälle, ### Was nicht getestet ist),
 "files": [{"path": string, "language": string, "content": string}] (1–2 Testdateien, bevorzugt Vitest/Jest für TypeScript, pytest für Python)}
Tests nur gegen das, was im Kontext steht – keine erfundenen Funktionen.
${COMMON_RULES}`,
    parse: (raw) => AGENTS.coding.parse(raw),
    template: () => ({ kind: "code", markdown: "_Vorlage ohne KI._ Test-Gerüst.", files: [{ path: "example.test.ts", language: "typescript", content: "import { describe, it, expect } from 'vitest';\n\ndescribe('Funktion', () => {\n  it('liefert das erwartete Ergebnis', () => {\n    expect(true).toBe(true);\n  });\n});\n" }] }),
  },
};

export const AGENT_ORDER: AgentId[] = [
  "marketing", "sea", "seo", "social", "copy", "reporting", "leads", "competitor", "tracking",
  "design", "coding", "review", "qa",
  "application", "mail", "authority", "research", "coach",
  "presentation",
];
