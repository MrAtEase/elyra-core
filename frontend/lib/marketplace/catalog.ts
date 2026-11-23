/**
 * Marketplace catalog: optional apps and skills a workspace can install.
 *
 * Core apps (Mail, Kalender, Aufgaben, Drive, Folien, Recherche, Wetter, Übersetzen, Elly)
 * are always there and are not listed. Everything here is optional:
 *  - Existing workspaces keep what they had (migration 0017 installs all of it for them).
 *  - New workspaces start slim and pick what they need – themselves or via Elly.
 * Mini-apps that Elly builds are stored per workspace (table mini_apps), not here.
 */

export type CatalogKind = "app" | "skill" | "connector";

import { TEMPLATES, type MiniAppTemplate } from "@/lib/marketplace/templates";

export type CatalogItem = {
  id: string;
  kind: CatalogKind;
  name: string;
  category: string;
  description: string;
  /** lucide icon key used by the launcher (see APP_ICONS_BY_NAME). */
  icon: string;
  /** Words Elly uses to match a request like "ich brauche was für Google Shopping". */
  hints: string[];
  /** For apps: the window to open. */
  launch?: string;
  /** For skills: what Elly is told when the skill is used. */
  instructions?: string;
  /** For skills: text placed in Elly's input so the user only adds the details. */
  starter?: string;
  /** For connectors: how to connect (shown in the marketplace). */
  setup?: string;
};

export const MARKETPLACE_CATEGORIES = [
  "Marketing",
  "Vertrieb",
  "Lernen & Hobby",
  "Schreiben",
  "Business",
  "Finanzen",
  "Karriere",
  "Alltag",
  "CRM",
  "Weitere Dienste",
] as const;

/** Elly may read these services but never move money or send on her own – stated in every connector. */
const READ_FIRST = "Elly liest und fasst zusammen. Änderungen im CRM (z. B. Deal-Status, Notiz) nur nach deiner Freigabe.";

export const CATALOG: CatalogItem[] = [
  // ── Apps: Marketing ───────────────────────────────────────────────────────
  { id: "visibility", kind: "app", name: "KI-Sichtbarkeit", category: "Marketing", icon: "radar", launch: "visibility",
    description: "Misst, ob ChatGPT, Gemini und Claude deine Marke empfehlen – inklusive Wettbewerbsvergleich und Marken-Wahrnehmung.",
    hints: ["geo", "chatgpt", "ki-suche", "sichtbarkeit", "marke", "wettbewerb", "llm", "ai search"] },
  { id: "synergy", kind: "app", name: "Paid × Organic", category: "Marketing", icon: "git-merge", launch: "synergy",
    description: "Vergleicht Google Ads mit der Search Console: wo du für Klicks zahlst, die du organisch schon hast.",
    hints: ["sea", "seo", "google ads", "search console", "keywords", "budget", "kannibalisierung"] },
  { id: "feed", kind: "app", name: "Feed-Optimierer", category: "Marketing", icon: "shopping-bag", launch: "feed",
    description: "Prüft Google-Shopping-Feeds und verbessert Titel und Beschreibungen per KI – mit Freigabe und Export.",
    hints: ["shopping", "merchant center", "produktfeed", "feed", "pmax", "e-commerce", "produkte", "gtin"] },
  { id: "insights", kind: "app", name: "Newsletter-Digest", category: "Marketing", icon: "newspaper", launch: "insights",
    description: "Fasst Fachseiten und Newsletter zu einem Branchen-Briefing zusammen – mit Quellen.",
    hints: ["newsletter", "digest", "news", "briefing", "trends", "branche", "nachrichten"] },
  { id: "automations", kind: "app", name: "Automationen", category: "Marketing", icon: "workflow", launch: "automations",
    description: "Verbindet Elyra mit n8n, Make oder Zapier: Webhooks und API-Tokens.",
    hints: ["n8n", "make", "zapier", "webhook", "automation", "automatisierung", "api"] },
  { id: "ads_audit", kind: "app", name: "Ads Audit", category: "Marketing", icon: "scan-search", launch: "ads_audit",
    description: "Findet teure Suchbegriffe ohne Conversions und schlägt Ausschlüsse vor.",
    hints: ["google ads", "suchbegriffe", "ausschluss", "audit", "kampagne", "sea"] },
  { id: "reporting", kind: "app", name: "Reporting", category: "Marketing", icon: "chart", launch: "reporting",
    description: "Marketing-Kennzahlen und Kampagnen-Reports an einem Ort.",
    hints: ["report", "reporting", "kpi", "roas", "performance", "kennzahlen", "dashboard"] },
  { id: "agent_team", kind: "app", name: "Agenten-Team", category: "Marketing", icon: "users", launch: "agent_team",
    description: "Mehrere KI-Agenten arbeiten zusammen: Texte, Design, Präsentation, Kampagnen.",
    hints: ["agenten", "team", "kampagne", "multi-agent", "texte", "konzept"] },
  // ── Apps: Vertrieb ────────────────────────────────────────────────────────
  { id: "leads", kind: "app", name: "Leads", category: "Vertrieb", icon: "target", launch: "leads",
    description: "Neukunden finden und Kontakte vorbereiten.",
    hints: ["leads", "akquise", "neukunden", "vertrieb", "sales", "kunden finden"] },
  // ── Apps: Lernen & Hobby ──────────────────────────────────────────────────
  { id: "languages", kind: "app", name: "Sprachen", category: "Lernen & Hobby", icon: "languages", launch: "languages",
    description: "Vokabeln und Sätze üben, mit Aussprache.",
    hints: ["sprache", "sprachen", "vokabeln", "lernen", "englisch", "portugiesisch", "spanisch"] },
  { id: "guitar", kind: "app", name: "Gitarre", category: "Lernen & Hobby", icon: "guitar", launch: "guitar",
    description: "Akkorde, Stimmgerät und Übungen für Einsteiger.",
    hints: ["gitarre", "musik", "akkorde", "stimmen", "tabs", "guitar"] },
  { id: "magic", kind: "app", name: "Kartenmagie", category: "Lernen & Hobby", icon: "spade", launch: "magic",
    description: "Kartentricks lernen und üben – Schritt für Schritt.",
    hints: ["zaubern", "zauberei", "magie", "kartentricks", "magic"] },

  // ── Skills ────────────────────────────────────────────────────────────────
  { id: "skill-bewerbung", kind: "skill", name: "Bewerbung schreiben", category: "Schreiben", icon: "file-text",
    description: "Aus einer Stellenanzeige: Einschätzung, zugeschnittener Lebenslauf-Text und Anschreiben oder Video-Skript.",
    hints: ["bewerbung", "anschreiben", "lebenslauf", "cv", "stellenanzeige", "job"],
    instructions: "Du hilfst bei einer Bewerbung. Lies die Stellenanzeige, nenne in höchstens 5 Zeilen Passung, stärkste Argumente und eine ehrliche Lücke. Schreibe dann ein Anschreiben (oder auf Wunsch ein 2–3-minütiges Video-Skript) in der Sprache der Anzeige: konkret, menschlich, ohne Floskeln wie „hochmotiviert“. Erfinde keine Erfahrungen.",
    starter: "Hier ist die Stellenanzeige: " },
  { id: "skill-behoerde-pt", kind: "skill", name: "Behördenbrief Portugal", category: "Schreiben", icon: "file-text",
    description: "Formeller Brief an Finanças, Segurança Social, SNS oder Vermieter – auf Portugiesisch mit deutscher Übersetzung.",
    hints: ["behörde", "finanças", "segurança social", "portugal", "brief", "vermieter", "reclamação"],
    instructions: "Schreibe einen formellen Brief auf Europäischem Portugiesisch an die genannte Stelle (Anrede, Betreff, Bezug, Anliegen, Bitte, Grußformel). Gib danach eine deutsche Übersetzung. Frage nach fehlenden Pflichtangaben (NIF, Aktenzeichen, Datum), statt sie zu erfinden.",
    starter: "Schreib einen Brief an … wegen: " },
  { id: "skill-angebot", kind: "skill", name: "Angebot erstellen", category: "Business", icon: "file-text",
    description: "Aus einer Kundenanfrage ein klares Angebot mit Leistungen, Aufwand und Preis-Optionen.",
    hints: ["angebot", "kostenvoranschlag", "proposal", "kunde", "preis", "auftrag"],
    instructions: "Erstelle aus der Anfrage ein Angebot: Ausgangslage, Ziel, Leistungen in Paketen (Basis/Empfohlen/Premium), Aufwand in Stunden, Preis, Zeitplan, nächste Schritte. Markiere Annahmen klar. Ton: professionell, knapp.",
    starter: "Kundenanfrage: " },
  { id: "skill-social", kind: "skill", name: "Social-Media-Posts", category: "Marketing", icon: "sparkles",
    description: "Aus einem Thema oder Link: Posts für LinkedIn, Instagram und X in passender Länge und Tonalität.",
    hints: ["social media", "linkedin", "instagram", "post", "posting", "content"],
    instructions: "Schreibe zu dem Thema je einen Post für LinkedIn (bis 1.300 Zeichen, mit Haken in der ersten Zeile), Instagram (kurz, mit 5 Hashtags) und X (unter 280 Zeichen). Keine Übertreibungen, keine erfundenen Zahlen.",
    starter: "Thema für die Posts: " },
  { id: "skill-meeting", kind: "skill", name: "Meeting-Protokoll", category: "Business", icon: "file-text",
    description: "Aus Notizen oder einem Transkript: Zusammenfassung, Entscheidungen, Aufgaben mit Verantwortlichen.",
    hints: ["meeting", "protokoll", "besprechung", "notizen", "transkript", "aufgaben"],
    instructions: "Erstelle aus den Notizen ein Protokoll mit: Kurzfassung (3 Sätze), Entscheidungen, offene Fragen, Aufgaben als Tabelle (Aufgabe | wer | bis wann). Nichts hinzuerfinden; Unklares als offen markieren.",
    starter: "Meine Notizen: " },
  { id: "skill-seo-text", kind: "skill", name: "SEO-Text", category: "Marketing", icon: "sparkles",
    description: "Suchmaschinen-optimierter Text zu einem Keyword – mit Title, Meta-Beschreibung und Gliederung.",
    hints: ["seo", "keyword", "blog", "artikel", "meta description", "title tag"],
    instructions: "Schreibe zum Keyword: Title (max. 60 Zeichen), Meta-Beschreibung (max. 155 Zeichen), H1, Gliederung mit H2/H3 und den Text (ca. 600 Wörter). Natürlich formuliert, Keyword ohne Überoptimierung, eine klare Handlungsaufforderung am Ende.",
    starter: "Keyword und Zielgruppe: " },
  { id: "skill-rechnung", kind: "skill", name: "Rechnung schreiben", category: "Finanzen", icon: "file-text",
    description: "Aus Leistung, Kunde und Betrag eine saubere Rechnung mit allen Pflichtangaben (DE oder PT).",
    hints: ["rechnung", "fatura", "invoice", "abrechnen", "honorar"],
    instructions: "Erstelle eine Rechnung als übersichtlichen Text/Tabelle: Rechnungssteller, Empfänger, Rechnungsnummer, Datum, Leistungszeitraum, Positionen (Menge, Einzelpreis, Summe), Netto, Steuersatz, Steuer, Brutto, Zahlungsziel, Bankverbindung als Platzhalter. Frage nach fehlenden Pflichtangaben (Steuernummer/NIF), erfinde keine. Weise darauf hin, dass in Portugal zertifizierte Software für Faturas nötig sein kann.",
    starter: "Rechnung an: … Leistung: … Betrag: " },
  { id: "skill-mahnung", kind: "skill", name: "Zahlungserinnerung", category: "Finanzen", icon: "file-text",
    description: "Freundliche, aber klare Erinnerung an eine offene Rechnung – in drei Stufen.",
    hints: ["mahnung", "zahlungserinnerung", "offene rechnung", "nicht bezahlt"],
    instructions: "Schreibe eine Zahlungserinnerung in der gewünschten Stufe (1: freundlich, 2: bestimmt, 3: letzte Mahnung mit Frist). Nenne Rechnungsnummer, Betrag, ursprüngliches Fälligkeitsdatum und neue Frist. Kurz, höflich, ohne Drohungen außer sachlichen nächsten Schritten.",
    starter: "Offene Rechnung: Nr. … Betrag … fällig seit … Stufe: " },
  { id: "skill-ausgaben-erklaeren", kind: "skill", name: "Kontoauszug verstehen", category: "Finanzen", icon: "sparkles",
    description: "Kontoauszug einfügen – Elly fasst Ausgaben nach Kategorien zusammen und findet Abos.",
    hints: ["kontoauszug", "ausgaben", "revolut", "bank", "wofür geht mein geld"],
    instructions: "Fasse die eingefügten Buchungen zusammen: Summe Einnahmen/Ausgaben, Ausgaben nach Kategorien (Tabelle), wiederkehrende Zahlungen (Abos), 3 auffällige Posten. Nur beschreiben, keine Anlage- oder Steuerberatung. Kontonummern und IBANs in der Antwort weglassen.",
    starter: "Hier meine Buchungen (aus dem Kontoauszug kopiert): " },
  { id: "skill-kaltakquise", kind: "skill", name: "Kaltakquise-Mail", category: "Vertrieb", icon: "sparkles",
    description: "Kurze, persönliche Erstansprache an eine Firma – mit konkretem Aufhänger statt Floskeln.",
    hints: ["kaltakquise", "erstansprache", "outreach", "neukunde", "prospect"],
    instructions: "Schreibe eine Erstansprache-Mail (max. 120 Wörter): Betreff (max. 6 Wörter), persönlicher Aufhänger zur Firma, ein konkreter Nutzen, eine kleine Bitte (15-Minuten-Gespräch). Keine Floskeln, keine Übertreibungen. Gib zusätzlich eine kürzere LinkedIn-Variante (max. 300 Zeichen).",
    starter: "Firma und was ich anbiete: " },
  { id: "skill-followup", kind: "skill", name: "Follow-up", category: "Vertrieb", icon: "sparkles",
    description: "Nachfassen nach Angebot, Termin oder Funkstille – kurz und mit neuem Mehrwert.",
    hints: ["follow-up", "nachfassen", "nachhaken", "keine antwort"],
    instructions: "Schreibe ein kurzes Follow-up (max. 80 Wörter), das auf den letzten Kontakt Bezug nimmt, einen neuen kleinen Mehrwert bietet (Info, Idee, Beispiel) und eine einfache Ja/Nein-Frage stellt. Kein Vorwurf wegen ausbleibender Antwort.",
    starter: "Letzter Kontakt war: … am … Ziel: " },
  { id: "skill-gespraechsvorbereitung", kind: "skill", name: "Gesprächsvorbereitung", category: "Vertrieb", icon: "sparkles",
    description: "Vor einem Kunden- oder Bewerbungsgespräch: Ziele, Fragen, Einwände und Antworten.",
    hints: ["gesprächsvorbereitung", "termin vorbereiten", "pitch", "einwände", "meeting vorbereiten"],
    instructions: "Bereite das Gespräch vor: Ziel in einem Satz, 5 kluge Fragen, 3 wahrscheinliche Einwände mit kurzen Antworten, 3 Kernbotschaften, sinnvoller nächster Schritt am Ende. Nichts über das Gegenüber erfinden.",
    starter: "Gespräch mit: … Thema: … mein Ziel: " },
  { id: "skill-linkedin", kind: "skill", name: "LinkedIn-Profil", category: "Karriere", icon: "sparkles",
    description: "Headline, Info-Text und Erfahrungs-Bullets für dein Profil – passend zu deinem Ziel-Job.",
    hints: ["linkedin", "profil", "headline", "about", "xing"],
    instructions: "Schreibe für das LinkedIn-Profil: 3 Headline-Varianten (max. 220 Zeichen), einen Info-Text (ca. 150 Wörter, erste Person, konkret), und für die genannten Stationen je 3 Bullets mit Ergebnissen. Nur Fakten aus der Eingabe verwenden, nichts erfinden.",
    starter: "Ziel-Job: … meine Stationen: " },
  { id: "skill-mietvertrag", kind: "skill", name: "Vertrag erklären", category: "Alltag", icon: "file-text",
    description: "Miet-, Handy- oder Arbeitsvertrag einfügen – Elly erklärt die wichtigsten Punkte und Fristen.",
    hints: ["mietvertrag", "vertrag", "contrato", "kündigungsfrist", "kleingedrucktes"],
    instructions: "Erkläre den Vertrag in einfacher Sprache: Worum geht es, Laufzeit und Kündigungsfristen, Kosten und Erhöhungen, Pflichten beider Seiten, 3–5 Punkte, auf die man achten sollte. Weise klar darauf hin, dass dies keine Rechtsberatung ist und bei Streit eine Beratung (z. B. Mieterverein, DECO in Portugal) sinnvoll ist.",
    starter: "Hier ist der Vertrag (oder die wichtigen Abschnitte): " },
  { id: "skill-reiseplan", kind: "skill", name: "Reiseplan", category: "Alltag", icon: "sparkles",
    description: "Ziel, Dauer und Interessen angeben – Elly plant Tage, Wege und Budget grob vor.",
    hints: ["reise", "urlaub", "trip", "reiseplan", "wochenende"],
    instructions: "Plane die Reise Tag für Tag (Vormittag/Nachmittag/Abend), mit realistischen Wegen zwischen den Orten, einer groben Budget-Schätzung als Spanne und 3 Tipps für Einheimische. Kennzeichne, was vorab gebucht werden sollte. Öffnungszeiten und Preise als „bitte prüfen“ markieren.",
    starter: "Reiseziel: … Tage: … Interessen: " },

  // ── Connectors: CRM & services (via MCP – data stays in the source system) ──
  { id: "conn-hubspot", kind: "connector", name: "HubSpot", category: "CRM", icon: "plug",
    description: "Kontakte, Firmen und Deals aus HubSpot: „Welche Deals hängen seit 2 Wochen?“, „Fass Firma X zusammen“.",
    hints: ["hubspot", "crm", "deals", "pipeline", "kontakte"],
    setup: `Im MCP-Bereich den offiziellen HubSpot-MCP-Server bzw. eine HubSpot Private App (Access Token, nur Lese-Scopes für CRM-Objekte) eintragen. ${READ_FIRST}` },
  { id: "conn-salesforce", kind: "connector", name: "Salesforce", category: "CRM", icon: "plug",
    description: "Accounts, Opportunities und Aktivitäten aus Salesforce abfragen und zusammenfassen.",
    hints: ["salesforce", "crm", "opportunity", "sales cloud"],
    setup: `Im MCP-Bereich einen Salesforce-MCP-Server mit einer Connected App (OAuth, eingeschränkter Nutzer mit Leserechten) verbinden. ${READ_FIRST}` },
  { id: "conn-pipedrive", kind: "connector", name: "Pipedrive", category: "CRM", icon: "plug",
    description: "Deals und Aktivitäten aus Pipedrive – Follow-ups vorbereiten, Pipeline-Überblick.",
    hints: ["pipedrive", "crm", "deals", "pipeline"],
    setup: `Im MCP-Bereich einen Pipedrive-MCP-Server mit API-Token verbinden. ${READ_FIRST}` },
  { id: "conn-zoho", kind: "connector", name: "Zoho CRM", category: "CRM", icon: "plug",
    description: "Leads, Kontakte und Deals aus Zoho CRM lesen und zusammenfassen.",
    hints: ["zoho", "crm", "leads"],
    setup: `Im MCP-Bereich einen Zoho-CRM-MCP-Server verbinden (OAuth, Leserechte). ${READ_FIRST}` },
  { id: "conn-bank", kind: "connector", name: "Bankkonto (nur lesen)", category: "Weitere Dienste", icon: "plug",
    description: "Kontoumsätze über einen lizenzierten Open-Banking-Anbieter – nur lesen, Überweisungen technisch ausgeschlossen. Bis dahin: CSV-Import im Haushaltsbuch.",
    hints: ["bank", "revolut", "open banking", "konto", "umsätze"],
    setup: "Geplant: Anbindung über einen lizenzierten Open-Banking-Anbieter (PSD2, nur Kontoinformationsdienst). Es wird nur die Lese-Berechtigung angefragt – Zahlungen auszulösen ist damit technisch unmöglich. Bis dahin den Kontoauszug als CSV ins Haushaltsbuch importieren." },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

export const OPTIONAL_APP_IDS = CATALOG.filter((item) => item.kind === "app").map((item) => item.id);

export function isInstallable(item: CatalogItem): boolean {
  return item.kind === "app" || item.kind === "skill";
}

/**
 * Install state for a workspace. `null` = no marketplace data yet (migration not run, or offline):
 * then everything stays visible as before, so nobody loses apps.
 */
export type InstalledMap = Record<string, boolean> | null;

export function isItemInstalled(map: InstalledMap, id: string): boolean {
  if (!map) return true;
  return map[id] === true;
}

// ── Elly: recognise install / build requests ────────────────────────────────

const INSTALL_TRIGGERS = [
  /\binstallier/i, /\binstall\b/i, /\bhinzuf(ü|ue)g/i, /\baktivier\w* (die |den |das )?app/i,
  /\bbrauche (eine |ein |was |etwas |ein tool |ein werkzeug |eine app )/i, /\bgibt es (eine |ein )?(app|tool|werkzeug)/i,
  /\bapp f(ü|ue)r\b/i, /\bmarktplatz\b/i, /\bskill\b/i, /\bvorlage\b/i, /\bverbind\w* (mit |mein\w* )?/i, /\banbindung\b/i,
];
const BUILD_TRIGGER = /\b(bau|baue|erstell|erstelle|programmier|mach)\w* (mir |uns )?(eine |ein |einen )?(kleine |eigene |neue )?(mini-?)?(app|tool|rechner|tracker|planer|generator|widget)\b/i;

export type EllyMarketplaceIntent =
  | { type: "install"; items: CatalogItem[]; templates: MiniAppTemplate[]; query: string }
  | { type: "build"; description: string }
  | { type: "open" };

function score(item: CatalogItem, text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  if (t.includes(item.name.toLowerCase())) s += 5;
  for (const hint of item.hints) if (t.includes(hint)) s += hint.includes(" ") ? 3 : 2;
  return s;
}

function scoreTemplate(tpl: MiniAppTemplate, text: string): number {
  const t = text.toLowerCase();
  let s = t.includes(tpl.name.toLowerCase()) ? 5 : 0;
  const words = `${tpl.name} ${tpl.description}`.toLowerCase().split(/[^a-zäöüß0-9-]+/).filter((w) => w.length >= 5);
  for (const w of new Set(words)) if (t.includes(w)) s += 1;
  return s;
}

/** Returns what Elly should do with a message, or null when it is not about apps/skills. */
export function matchMarketplaceIntent(text: string): EllyMarketplaceIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (BUILD_TRIGGER.test(trimmed)) return { type: "build", description: trimmed };
  if (!INSTALL_TRIGGERS.some((re) => re.test(trimmed))) return null;
  const ranked = CATALOG.map((item) => ({ item, s: score(item, trimmed) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);
  const rankedTemplates = TEMPLATES.map((tpl) => ({ tpl, s: scoreTemplate(tpl, trimmed) }))
    .filter((r) => r.s >= 2)
    .sort((a, b) => b.s - a.s);
  if (ranked.length === 0 && rankedTemplates.length === 0) return /\bmarktplatz\b/i.test(trimmed) ? { type: "open" } : null;
  const top = ranked[0]?.s ?? 0;
  return {
    type: "install",
    items: ranked.filter((r) => r.s >= Math.max(2, top - 1)).slice(0, 3).map((r) => r.item),
    templates: rankedTemplates.slice(0, 2).map((r) => r.tpl),
    query: trimmed,
  };
}
