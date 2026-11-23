/**
 * Elly Ads Audit – Analyse-Kern
 * ------------------------------------------------------------------
 * Reine Funktionen ohne Abhängigkeiten: CSV einlesen, verschwendetes
 * Budget finden, auszuschließende Keywords vorschlagen, auffällige
 * Klickmuster erkennen. Jede Änderung wird nur als *Vorschlag* mit
 * Status "pending" erzeugt – umgesetzt wird erst nach Freigabe durch
 * einen Menschen (Human in the Loop, siehe SPEC.md).
 *
 * Die KI-Schritte (Kundenbericht, Anzeigentitel) laufen in summarize.ts
 * über Elyras Model-Router und sehen nur die hier berechneten Fakten.
 */

// ---------- Typen ----------

export interface SearchTermRow {
  term: string;
  campaign: string;
  adGroup: string;
  matchType: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  convValue: number;
}

export interface HourRow {
  hour: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface AuditOptions {
  /** Ab so vielen Klicks ohne Conversion gilt ein Suchbegriff als Verschwendung */
  minClicksNoConv: number;
  /** … oder ab diesen Kosten ohne Conversion */
  minCostNoConv: number;
  /** Faktor über dem Konto-CPA, ab dem ein Begriff als "teuer" gilt */
  expensiveCpaFactor: number;
  /** Mindest-Verschwendung (€), damit ein Wort als Ausschluss vorgeschlagen wird */
  minNegativeTokenCost: number;
  /** Wörter, die nie als Ausschluss vorgeschlagen werden (z. B. Kernprodukt) */
  protectedTokens: string[];
}

export const DEFAULT_OPTIONS: AuditOptions = {
  minClicksNoConv: 10,
  minCostNoConv: 20,
  expensiveCpaFactor: 2.5,
  minNegativeTokenCost: 15,
  protectedTokens: [],
};

/** Wörter, die fast immer auf fehlende Kaufabsicht hindeuten – dürfen auch einzeln als Ausschluss vorgeschlagen werden. */
export const INTENT_SIGNALS = new Set([
  'gratis', 'kostenlos', 'umsonst', 'jobs', 'job', 'stellenangebote', 'ausbildung', 'gehalt',
  'gebraucht', 'ebay', 'kleinanzeigen', 'vinted', 'reparieren', 'reparatur', 'selber', 'selbst',
  'anleitung', 'diy', 'zeichnen', 'malvorlage', 'wikipedia', 'definition', 'free', 'used',
]);

export type ProposalType = 'negative_keyword_phrase' | 'negative_keyword_exact' | 'review_term' | 'review_hours';

export interface Proposal {
  id: string;
  type: ProposalType;
  status: 'pending' | 'approved' | 'rejected';
  /** Was konkret geändert würde */
  payload: Record<string, string | number | string[]>;
  /** Begründung in Klartext – für Freigabe-Dialog und Audit-Log */
  rationale: string;
  /** Kosten im Datenzeitraum, die die Maßnahme betrifft */
  affectedCost: number;
}

export interface AuditReport {
  totals: { cost: number; clicks: number; conversions: number; convValue: number; cpa: number | null; roas: number | null };
  wasted: SearchTermRow[];
  wastedCost: number;
  expensive: (SearchTermRow & { cpa: number })[];
  negativeTokens: { token: string; cost: number; clicks: number; examples: string[] }[];
  hourAnomalies: { hour: number; clicks: number; conversions: number; clickFactor: number }[];
  /** Suchbegriffe mit den meisten Conversions (Basis für neue Anzeigentitel) */
  topConverting: string[];
  proposals: Proposal[];
}

// ---------- CSV ----------

const HEADER_MAP: Record<string, keyof SearchTermRow> = {
  'suchbegriff': 'term', 'search term': 'term', 'suchanfrage': 'term',
  'kampagne': 'campaign', 'campaign': 'campaign',
  'anzeigengruppe': 'adGroup', 'ad group': 'adGroup',
  'übereinstimmungstyp': 'matchType', 'match type': 'matchType', 'keyword-übereinstimmungstyp': 'matchType',
  'impressionen': 'impressions', 'impr.': 'impressions', 'impressions': 'impressions',
  'klicks': 'clicks', 'clicks': 'clicks',
  'kosten': 'cost', 'cost': 'cost',
  'conversions': 'conversions', 'conv.': 'conversions',
  'conv.-wert': 'convValue', 'conv. value': 'convValue', 'conversion-wert': 'convValue', 'all conv. value': 'convValue',
};

const HOUR_MAP: Record<string, keyof HourRow> = {
  'stunde': 'hour', 'hour of the day': 'hour', 'hour': 'hour', 'tageszeit': 'hour',
  'klicks': 'clicks', 'clicks': 'clicks',
  'kosten': 'cost', 'cost': 'cost',
  'conversions': 'conversions', 'conv.': 'conversions',
};

/** Minimaler CSV-Parser mit Anführungszeichen-Support; erkennt ; oder , als Trenner. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  // Trenner anhand der ersten Zeilen erkennen (Exporte haben oft Titelzeilen ohne Trenner)
  const head = clean.split(/\r?\n/, 5);
  const count = (re: RegExp) => Math.max(...head.map((l) => l.match(re)?.length ?? 0));
  const delim = count(/;/g) > count(/,/g) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Zahl aus deutschem oder englischem Format ("1.234,56", "1,234.56", "12,5", "--"). */
export function parseNumber(raw: string): number {
  let s = (raw ?? '').trim().replace(/[€%\s]/g, '');
  if (s === '' || s === '--' || s === '-') return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // "12,5" = Dezimalkomma, "1,234,567" = englische Tausender
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.200" / "12.500" = deutsche Tausenderpunkte
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findHeaderRow(rows: string[][], map: Record<string, string>): number {
  // Google-Ads-Exporte haben oft 1–2 Titelzeilen vor dem Header
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const hits = (rows[i] ?? []).filter((h) => map[h.trim().toLowerCase()] !== undefined).length;
    if (hits >= 3) return i;
  }
  throw new Error('Keine passende Kopfzeile gefunden. Erwartet z. B. Suchbegriff, Klicks, Kosten, Conversions.');
}

export function readSearchTerms(text: string): SearchTermRow[] {
  const rows = parseCsv(text);
  const h = findHeaderRow(rows, HEADER_MAP);
  const cols = (rows[h] ?? []).map((x) => HEADER_MAP[x.trim().toLowerCase()]);
  const numeric = new Set<keyof SearchTermRow>(['impressions', 'clicks', 'cost', 'conversions', 'convValue']);
  return rows.slice(h + 1)
    .filter((r) => !/^(gesamt|total)/i.test((r[0] ?? '').trim()))
    .map((r) => {
      const o: SearchTermRow = { term: '', campaign: '', adGroup: '', matchType: '', impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 };
      cols.forEach((key, i) => {
        if (!key) return;
        if (numeric.has(key)) (o[key] as number) = parseNumber(r[i] ?? '');
        else (o[key] as string) = (r[i] ?? '').trim();
      });
      return o;
    })
    .filter((o) => o.term !== '');
}

export function readHours(text: string): HourRow[] {
  const rows = parseCsv(text);
  const h = findHeaderRow(rows, HOUR_MAP);
  const cols = (rows[h] ?? []).map((x) => HOUR_MAP[x.trim().toLowerCase()]);
  return rows.slice(h + 1).map((r) => {
    const o: HourRow = { hour: 0, clicks: 0, cost: 0, conversions: 0 };
    cols.forEach((key, i) => { if (key) o[key] = parseNumber(r[i] ?? ''); });
    return o;
  });
}

// ---------- Analyse ----------

const round2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const STOPWORDS = new Set(['der', 'die', 'das', 'und', 'oder', 'für', 'mit', 'in', 'im', 'von', 'zu', 'am', 'an', 'auf', 'ein', 'eine', 'the', 'and', 'for', 'of']);

export function tokenize(term: string): string[] {
  return term.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export function runAudit(terms: SearchTermRow[], hours: HourRow[] = [], opts: Partial<AuditOptions> = {}): AuditReport {
  const o = { ...DEFAULT_OPTIONS, ...opts };

  const totals = terms.reduce(
    (a, r) => ({ cost: a.cost + r.cost, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, convValue: a.convValue + r.convValue }),
    { cost: 0, clicks: 0, conversions: 0, convValue: 0 },
  );
  const cpa = totals.conversions > 0 ? totals.cost / totals.conversions : null;
  const roas = totals.cost > 0 ? totals.convValue / totals.cost : null;

  // 1) Verschwendung: Klicks/Kosten ohne jede Conversion
  const wasted = terms
    .filter((r) => r.conversions === 0 && (r.clicks >= o.minClicksNoConv || r.cost >= o.minCostNoConv))
    .sort((a, b) => b.cost - a.cost);
  const wastedCost = wasted.reduce((s, r) => s + r.cost, 0);

  // 2) Teuer: konvertiert zwar, aber CPA weit über Kontodurchschnitt
  const expensive = cpa === null ? [] : terms
    .filter((r) => r.conversions > 0 && r.cost / r.conversions > cpa * o.expensiveCpaFactor)
    .map((r) => ({ ...r, cpa: round2(r.cost / r.conversions) }))
    .sort((a, b) => b.cpa - a.cpa);

  // 3) Ausschluss-Wörter: kommen in verschwendeten Begriffen vor, aber nie in konvertierenden
  const convertingTokens = new Set(terms.filter((r) => r.conversions > 0).flatMap((r) => tokenize(r.term)));
  const protectedSet = new Set(o.protectedTokens.map((t) => t.toLowerCase()));
  const tokenStats = new Map<string, { cost: number; clicks: number; examples: string[] }>();
  for (const r of wasted) {
    for (const t of new Set(tokenize(r.term))) {
      if (convertingTokens.has(t) || protectedSet.has(t)) continue;
      const s = tokenStats.get(t) ?? { cost: 0, clicks: 0, examples: [] };
      s.cost += r.cost; s.clicks += r.clicks; s.examples.push(r.term);
      tokenStats.set(t, s);
    }
  }
  const isRisky = (t: string) => [...convertingTokens].some((c) => c.startsWith(t) || t.startsWith(c));
  const candidates = [...tokenStats.entries()]
    .filter(([token]) => !isRisky(token))
    .map(([token, s]) => ({ token, cost: round2(s.cost), clicks: s.clicks, terms: s.examples }))
    .filter((t) => t.cost >= o.minNegativeTokenCost && (t.terms.length >= 2 || INTENT_SIGNALS.has(t.token)))
    .sort((a, b) => b.terms.length - a.terms.length || b.cost - a.cost);
  // Greedy: ein Wort nur vorschlagen, wenn es noch nicht abgedeckte Suchbegriffe ausschließt
  const covered = new Set<string>();
  const negativeTokens: AuditReport['negativeTokens'] = [];
  for (const c of candidates) {
    if (c.terms.every((t) => covered.has(t))) continue;
    c.terms.forEach((t) => covered.add(t));
    negativeTokens.push({ token: c.token, cost: c.cost, clicks: c.clicks, examples: c.terms.slice(0, 3) });
  }
  negativeTokens.sort((a, b) => b.cost - a.cost);

  // 4) Auffällige Stunden: viele Klicks, kaum Conversions (Hinweis auf Bots/Klickbetrug)
  const hourAnomalies: AuditReport['hourAnomalies'] = [];
  if (hours.length >= 12) {
    const med = median(hours.map((h) => h.clicks));
    const totalClicks = hours.reduce((s, h) => s + h.clicks, 0);
    const totalConv = hours.reduce((s, h) => s + h.conversions, 0);
    const overallCr = totalClicks > 0 ? totalConv / totalClicks : 0;
    for (const h of hours) {
      const factor = med > 0 ? h.clicks / med : 0;
      const cr = h.clicks > 0 ? h.conversions / h.clicks : 0;
      // Auffällig: nennenswerter Traffic, aber Conversion-Rate unter 25 % des Kontodurchschnitts
      if (h.clicks >= Math.max(30, med * 0.5) && cr < overallCr * 0.25) {
        hourAnomalies.push({ hour: h.hour, clicks: h.clicks, conversions: h.conversions, clickFactor: round2(factor) });
      }
    }
  }

  // 5) Vorschläge – alle "pending", nichts wird automatisch umgesetzt
  const proposals: Proposal[] = [];
  let n = 1;
  const id = () => `P-${String(n++).padStart(3, '0')}`;
  const coveredByToken = new Set<string>();
  for (const t of negativeTokens) {
    wasted.filter((w) => tokenize(w.term).includes(t.token)).forEach((w) => coveredByToken.add(w.term));
    proposals.push({
      id: id(), type: 'negative_keyword_phrase', status: 'pending',
      payload: { keyword: t.token, level: 'Kampagne', examples: t.examples, campaigns: [...new Set(wasted.filter((w) => tokenize(w.term).includes(t.token)).map((w) => w.campaign))] },
      rationale: `„${t.token}“ kam in ${t.examples.length > 1 ? 'mehreren Suchbegriffen' : 'einem Suchbegriff'} vor, kostete ${eur(t.cost)} und brachte keine Conversion. In konvertierenden Suchbegriffen kommt das Wort nie vor.`,
      affectedCost: t.cost,
    });
  }
  for (const w of wasted.filter((w) => !coveredByToken.has(w.term))) {
    proposals.push({
      id: id(), type: 'negative_keyword_exact', status: 'pending',
      payload: { keyword: w.term, level: 'Anzeigengruppe', campaign: w.campaign, adGroup: w.adGroup },
      rationale: `„${w.term}“: ${w.clicks} Klicks für ${eur(w.cost)} ohne Conversion.`,
      affectedCost: round2(w.cost),
    });
  }
  for (const e of expensive) {
    proposals.push({
      id: id(), type: 'review_term', status: 'pending',
      payload: { keyword: e.term, campaign: e.campaign, cpa: e.cpa },
      rationale: `CPA ${eur(e.cpa)} liegt beim ${(e.cpa / (cpa ?? 1)).toLocaleString('de-DE', { maximumFractionDigits: 1 })}-fachen des Kontodurchschnitts. Gebot senken oder Landingpage prüfen – Entscheidung durch Mensch.`,
      affectedCost: round2(e.cost),
    });
  }
  if (hourAnomalies.length) {
    const hoursList = hourAnomalies.map((h) => `${h.hour}–${h.hour + 1} Uhr`);
    proposals.push({
      id: id(), type: 'review_hours', status: 'pending',
      payload: { hours: hoursList },
      rationale: `Ungewöhnlich viele Klicks bei fast keinen Conversions (${hoursList.join(', ')}). Möglicher ungültiger Traffic – IP-/Geräte-Analyse oder Werbezeitplan prüfen.`,
      affectedCost: round2(hours.filter((h) => hourAnomalies.some((a) => a.hour === h.hour)).reduce((s, h) => s + h.cost, 0)),
    });
  }

  return {
    totals: { cost: round2(totals.cost), clicks: totals.clicks, conversions: round2(totals.conversions), convValue: round2(totals.convValue), cpa: cpa === null ? null : round2(cpa), roas: roas === null ? null : round2(roas) },
    wasted, wastedCost: round2(wastedCost), expensive, negativeTokens, hourAnomalies,
    topConverting: terms.filter((r) => r.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 8).map((r) => r.term),
    proposals,
  };
}

// ---------- Ausgabe ----------

export function renderMarkdown(r: AuditReport, accountName = 'Demo-Konto'): string {
  const share = r.totals.cost > 0 ? (r.wastedCost / r.totals.cost) * 100 : 0;
  const lines: string[] = [];
  lines.push(`# Elly Ads Audit – ${accountName}`, '');
  lines.push(`**Kosten gesamt:** ${eur(r.totals.cost)} · **Conversions:** ${r.totals.conversions.toLocaleString('de-DE')} · **CPA:** ${r.totals.cpa === null ? '–' : eur(r.totals.cpa)} · **ROAS:** ${r.totals.roas === null ? '–' : r.totals.roas.toLocaleString('de-DE')}`, '');
  lines.push(`## Verschwendetes Budget: ${eur(r.wastedCost)} (${share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % der Kosten)`, '');
  lines.push('| Suchbegriff | Kampagne | Klicks | Kosten |', '|---|---|---:|---:|');
  r.wasted.forEach((w) => lines.push(`| ${w.term} | ${w.campaign} | ${w.clicks} | ${eur(w.cost)} |`));
  lines.push('', '## Vorgeschlagene Ausschluss-Keywords (Wortgruppe)', '');
  lines.push('| Wort | Kosten ohne Conversion | Beispiele |', '|---|---:|---|');
  r.negativeTokens.forEach((t) => lines.push(`| ${t.token} | ${eur(t.cost)} | ${t.examples.join('; ')} |`));
  if (r.expensive.length) {
    lines.push('', '## Teure Suchbegriffe (prüfen)', '', '| Suchbegriff | CPA |', '|---|---:|');
    r.expensive.forEach((e) => lines.push(`| ${e.term} | ${eur(e.cpa)} |`));
  }
  if (r.hourAnomalies.length) {
    lines.push('', '## Auffällige Klickzeiten', '', '| Uhrzeit | Klicks | Conversions | Conv.-Rate |', '|---|---:|---:|---:|');
    r.hourAnomalies.forEach((h) => lines.push(`| ${h.hour}–${h.hour + 1} Uhr | ${h.clicks} | ${h.conversions.toLocaleString('de-DE')} | ${(h.clicks ? (h.conversions / h.clicks) * 100 : 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % |`));
  }
  lines.push('', `## ${r.proposals.length} Vorschläge zur Freigabe`, '');
  r.proposals.forEach((p) => lines.push(`- **${p.id}** (${p.type}) – ${p.rationale}`));
  lines.push('', '_Hinweis: Alle Vorschläge sind „pending“. Nichts wird ohne menschliche Freigabe umgesetzt._');
  return lines.join('\n');
}

/** Prompt für Elyras Model-Router: Kundenbericht in Prosa + RSA-Anzeigentitel. */
export function buildLlmPrompt(r: AuditReport, accountName: string): string {
  const top = r.negativeTokens.slice(0, 5).map((t) => `${t.token} (${t.cost.toFixed(2)} €)`).join(', ');
  return [
    'Du bist Senior-SEA-Berater einer deutschen Performance-Agentur.',
    `Schreibe für den Kunden „${accountName}“ eine kurze Zusammenfassung (max. 120 Wörter, Deutsch, sachlich, ohne Übertreibung).`,
    `Fakten: Kosten ${r.totals.cost.toFixed(2)} €, davon ${r.wastedCost.toFixed(2)} € ohne Conversion. Wichtigste Ausschluss-Wörter: ${top}.`,
    r.hourAnomalies.length ? `Auffällige Klickzeiten: ${r.hourAnomalies.map((h) => h.hour + ' Uhr').join(', ')}.` : '',
    'Erfinde keine Zahlen. Nenne nur die angegebenen Fakten.',
    'Schlage danach 5 neue Anzeigentitel (max. 30 Zeichen) für die stärksten konvertierenden Suchbegriffe vor.',
    'Antworte als JSON: {"summary": string, "headlines": string[]}.',
  ].filter(Boolean).join('\n');
}

/**
 * Exportiert NUR freigegebene Ausschluss-Vorschläge als CSV für den Import in den Google Ads Editor.
 * Nicht freigegebene oder abgelehnte Vorschläge werden ignoriert.
 */
export function exportApprovedForAdsEditor(proposals: Proposal[]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['Campaign,Ad Group,Keyword,Criterion Type'];
  for (const p of proposals.filter((x) => x.status === 'approved')) {
    if (p.type === 'negative_keyword_phrase') {
      for (const c of (p.payload.campaigns as string[]) ?? []) {
        lines.push([q(c), q(''), q(String(p.payload.keyword)), q('Campaign Negative Phrase')].join(','));
      }
    } else if (p.type === 'negative_keyword_exact') {
      lines.push([q(String(p.payload.campaign)), q(String(p.payload.adGroup)), q(String(p.payload.keyword)), q('Negative Exact')].join(','));
    }
  }
  return lines.join('\n');
}
