/**
 * Paid-Organic-Synergie: Google-Ads-Suchbegriffe × Google Search Console.
 * Pure functions – run in the browser; the AI commentary is fetched separately.
 */
import { findColumn, parseNumber, parseTable } from "@/lib/data/table";

export type PaidRow = { term: string; clicks: number; impressions: number; cost: number; conversions: number };
export type OrganicRow = { term: string; clicks: number; impressions: number; ctr: number; position: number };

export type SynergyClass = "sparen" | "seo_chance" | "paid_chance" | "doppelt" | "nur_paid" | "nur_organisch";

export type SynergyRow = {
  term: string;
  brand: boolean;
  paid: PaidRow | null;
  organic: OrganicRow | null;
  cls: SynergyClass;
  note: string;
};

export type SynergyResult = {
  rows: SynergyRow[];
  kpis: {
    paidTerms: number;
    organicTerms: number;
    overlap: number;
    paidCost: number;
    paidConversions: number;
    costOnTop3: number;
    convOnSeoChances: number;
    organicClicks: number;
    paidGapImpressions: number;
  };
  counts: Record<SynergyClass, number>;
};

export const CLASS_LABEL: Record<SynergyClass, string> = {
  sparen: "Sparpotenzial",
  seo_chance: "SEO-Chance",
  paid_chance: "Paid-Lücke",
  doppelt: "Doppelt stark",
  nur_paid: "Kosten prüfen",
  nur_organisch: "Nur organisch",
};

const PAID_TERM = ["suchbegriff", "search term", "suchanfrage", "search query", "keyword", "suchbegriffe"];
const ORG_TERM = ["haufigste suchanfragen", "top queries", "suchanfragen", "suchanfrage", "query", "queries", "anfrage"];

export function normTerm(s: string): string {
  return s.toLowerCase().replace(/^\[|\]$|^"|"$|^\+/g, "").replace(/\s+/g, " ").trim();
}

export function parsePaid(text: string): PaidRow[] {
  const t = parseTable(text, (cells) => cells.some((c) => PAID_TERM.includes(c)) && cells.some((c) => c.startsWith("klick") || c.startsWith("click")));
  const term = findColumn(t.headers, PAID_TERM);
  if (!term) throw new Error("Im Google-Ads-Export fehlt die Spalte „Suchbegriff“ bzw. „Search term“.");
  const clicks = findColumn(t.headers, ["klicks", "clicks"]);
  const impr = findColumn(t.headers, ["impr", "impressionen", "impressions"]);
  const cost = findColumn(t.headers, ["kosten", "cost"]);
  const conv = findColumn(t.headers, ["conversions", "conv", "konversionen"]);
  const map = new Map<string, PaidRow>();
  for (const r of t.rows) {
    const key = normTerm(r[term] ?? "");
    if (!key) continue;
    const e = map.get(key) ?? { term: key, clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    e.clicks += parseNumber(clicks ? r[clicks] : "");
    e.impressions += parseNumber(impr ? r[impr] : "");
    e.cost += parseNumber(cost ? r[cost] : "");
    e.conversions += parseNumber(conv ? r[conv] : "");
    map.set(key, e);
  }
  return [...map.values()];
}

export function parseOrganic(text: string): OrganicRow[] {
  const t = parseTable(text, (cells) => cells.some((c) => ORG_TERM.includes(c)) && cells.some((c) => c.startsWith("position")));
  const term = findColumn(t.headers, ORG_TERM);
  if (!term) throw new Error("Im Search-Console-Export fehlt die Spalte „Häufigste Suchanfragen“ bzw. „Top queries“.");
  const clicks = findColumn(t.headers, ["klicks", "clicks"]);
  const impr = findColumn(t.headers, ["impressionen", "impressions", "impr"]);
  const ctr = findColumn(t.headers, ["ctr", "klickrate"]);
  const pos = findColumn(t.headers, ["position", "durchschnittliche position", "average position"]);
  return t.rows
    .map((r) => ({
      term: normTerm(r[term] ?? ""),
      clicks: parseNumber(clicks ? r[clicks] : ""),
      impressions: parseNumber(impr ? r[impr] : ""),
      ctr: parseNumber(ctr ? r[ctr] : ""),
      position: parseNumber(pos ? r[pos] : "") || 0,
    }))
    .filter((r) => r.term);
}

export function analyzeSynergy(paid: PaidRow[], organic: OrganicRow[], brandTerms: string[]): SynergyResult {
  const brands = brandTerms.map((b) => b.toLowerCase().trim()).filter(Boolean);
  const isBrand = (t: string) => brands.some((b) => t.includes(b));
  const p = new Map(paid.map((r) => [r.term, r]));
  const o = new Map(organic.map((r) => [r.term, r]));
  const terms = new Set([...p.keys(), ...o.keys()]);
  const rows: SynergyRow[] = [];

  for (const term of terms) {
    const pr = p.get(term) ?? null;
    const or = o.get(term) ?? null;
    const brand = isBrand(term);
    let cls: SynergyClass;
    let note: string;
    if (pr && or && pr.cost > 0 && or.position > 0 && or.position <= 3) {
      cls = "sparen";
      note = brand
        ? `Marke auf Platz ${or.position.toFixed(1)} – Anzeige nur halten, wenn Wettbewerber auf den Namen bieten.`
        : `Organisch Platz ${or.position.toFixed(1)} – Pausieren testen, ${or.clicks} organische Klicks sind schon da.`;
    } else if (pr && pr.conversions > 0 && (!or || or.position > 10)) {
      cls = "seo_chance";
      note = or
        ? `Konvertiert bezahlt, organisch nur Platz ${or.position.toFixed(1)} – Inhalt/Seite ausbauen.`
        : "Konvertiert bezahlt, organisch nicht sichtbar – eigene Seite/Inhalt erstellen.";
    } else if (!pr && or && or.impressions >= 100 && or.position > 3 && or.position <= 20) {
      cls = "paid_chance";
      note = `${or.impressions} Impressionen, Platz ${or.position.toFixed(1)} – Anzeige testen oder SEO-Push auf Top 3.`;
    } else if (pr && or && pr.conversions === 0 && pr.cost > 0) {
      cls = "nur_paid";
      note = `Kosten ohne Conversion, organisch Platz ${or.position ? or.position.toFixed(1) : "–"} – Relevanz prüfen.`;
    } else if (pr && or) {
      cls = "doppelt";
      note = `Bezahlt und organisch (Platz ${or.position ? or.position.toFixed(1) : "–"}) – gemeinsam beobachten.`;
    } else if (pr) {
      cls = "nur_paid";
      note = pr.cost > 0 && pr.conversions === 0 ? "Kosten ohne Conversion – Relevanz prüfen, ggf. als auszuschließendes Keyword anlegen." : "Nur bezahlt sichtbar.";
    } else {
      cls = "nur_organisch";
      note = "Nur organisch sichtbar.";
    }
    rows.push({ term, brand, paid: pr, organic: or, cls, note });
  }

  const order: SynergyClass[] = ["sparen", "seo_chance", "paid_chance", "doppelt", "nur_paid", "nur_organisch"];
  rows.sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || (b.paid?.cost ?? 0) - (a.paid?.cost ?? 0) || (b.organic?.impressions ?? 0) - (a.organic?.impressions ?? 0));

  const counts = Object.fromEntries(order.map((c) => [c, rows.filter((r) => r.cls === c).length])) as Record<SynergyClass, number>;
  const sum = (list: SynergyRow[], f: (r: SynergyRow) => number) => list.reduce((s, r) => s + f(r), 0);
  return {
    rows,
    counts,
    kpis: {
      paidTerms: paid.length,
      organicTerms: organic.length,
      overlap: rows.filter((r) => r.paid && r.organic).length,
      paidCost: sum(rows, (r) => r.paid?.cost ?? 0),
      paidConversions: sum(rows, (r) => r.paid?.conversions ?? 0),
      costOnTop3: sum(rows.filter((r) => r.cls === "sparen"), (r) => r.paid?.cost ?? 0),
      convOnSeoChances: sum(rows.filter((r) => r.cls === "seo_chance"), (r) => r.paid?.conversions ?? 0),
      organicClicks: sum(rows, (r) => r.organic?.clicks ?? 0),
      paidGapImpressions: sum(rows.filter((r) => r.cls === "paid_chance"), (r) => r.organic?.impressions ?? 0),
    },
  };
}

// ── Demo data (fictitious Stuttgart agency) ─────────────────────────────────

export const DEMO_PAID = `Suchbegriffbericht
1. Oktober 2026 - 31. Oktober 2026
Suchbegriff;Übereinstimmungstyp;Klicks;Impr.;Kosten;Conversions
seo agentur stuttgart;Wortgruppe;84;1.920;612,40;6
google ads agentur stuttgart;Genau;121;2.340;988,10;11
online marketing agentur stuttgart;Wortgruppe;66;2.910;503,20;3
musteragentur;Genau;212;640;95,30;19
musteragentur erfahrungen;Wortgruppe;18;120;14,20;1
sea agentur;Weitgehend;41;3.880;402,70;0
performance marketing agentur;Wortgruppe;37;1.650;455,90;4
google ads betreuung kosten;Wortgruppe;29;860;231,00;5
shopping kampagnen agentur;Wortgruppe;22;710;198,40;3
werbeagentur in der nähe;Weitgehend;35;4.200;188,60;0
linkedin ads agentur;Wortgruppe;12;530;141,80;1
Gesamt;;677;19.760;3.831,60;53`;

export const DEMO_ORGANIC = `Häufigste Suchanfragen,Klicks,Impressionen,CTR,Position
musteragentur,1240,2100,59.05%,1.1
musteragentur erfahrungen,96,410,23.41%,1.8
seo agentur stuttgart,58,3120,1.86%,2.6
online marketing agentur stuttgart,9,2480,0.36%,14.2
google ads agentur stuttgart,4,1890,0.21%,18.9
was kostet google ads,41,5200,0.79%,6.3
google ads betreuung kosten,7,980,0.71%,9.8
geo optimierung,22,1430,1.54%,7.4
ki sichtbarkeit unternehmen,6,820,0.73%,11.6
chatgpt ads deutschland,14,1960,0.71%,8.9
performance marketing agentur,2,1340,0.15%,27.5`;
