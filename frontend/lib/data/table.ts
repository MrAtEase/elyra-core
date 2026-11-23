/**
 * Tolerant reader for CSV/TSV exports (Google Ads, Search Console, Merchant Center …).
 * Detects the delimiter, skips title lines above the header row and understands German number formats.
 */

export type ParsedTable = { headers: string[]; rows: Array<Record<string, string>> };

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Splits text into logical lines, keeping line breaks inside quoted fields. */
function logicalLines(text: string): string[] {
  const lines: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 15);
  let best = ",";
  let bestScore = -1;
  for (const d of ["\t", ";", ","]) {
    const counts = sample.map((l) => splitLine(l, d).length).filter((n) => n > 1);
    if (counts.length === 0) continue;
    const max = Math.max(...counts);
    const score = counts.filter((n) => n === max).length * max;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export const normHeader = (h: string) =>
  h.toLowerCase().replace(/^\ufeff/, "").replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @param isHeader returns true for the row that is the real header (e.g. contains "Suchbegriff" or "Query").
 */
export function parseTable(text: string, isHeader?: (cells: string[]) => boolean): ParsedTable {
  const lines = logicalLines(text.replace(/^\ufeff/, "")).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines);
  const parsed = lines.map((l) => splitLine(l, delimiter));
  let headerIdx = 0;
  if (isHeader) {
    const found = parsed.findIndex((cells) => isHeader(cells.map(normHeader)));
    if (found >= 0) headerIdx = found;
  } else {
    const widest = Math.max(...parsed.slice(0, 10).map((c) => c.length));
    headerIdx = parsed.findIndex((c) => c.length === widest);
  }
  const headers = parsed[headerIdx]!.map((h) => h.replace(/^\ufeff/, "").trim());
  const rows: Array<Record<string, string>> = [];
  for (const cells of parsed.slice(headerIdx + 1)) {
    if (cells.every((c) => !c)) continue;
    const first = normHeader(cells[0] ?? "");
    if (/^(gesamt|total|summe|insgesamt)/.test(first)) continue; // footer totals in Ads exports
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

/** Finds the column whose normalized name matches one of the candidates (exact first, then prefix/contains). */
export function findColumn(headers: string[], candidates: string[]): string | null {
  const normed = headers.map((h) => ({ h, n: normHeader(h) }));
  for (const c of candidates) { const hit = normed.find((x) => x.n === c); if (hit) return hit.h; }
  for (const c of candidates) { const hit = normed.find((x) => x.n.startsWith(c)); if (hit) return hit.h; }
  for (const c of candidates) { const hit = normed.find((x) => x.n.includes(c)); if (hit) return hit.h; }
  return null;
}

/** "1.234,56 €" → 1234.56 · "1,234.56" → 1234.56 · "12,5 %" → 12.5 · "--" → 0 */
export function parseNumber(value: string | undefined | null): number {
  if (!value) return 0;
  let s = String(value).replace(/[€$£%\s\u00a0]/g, "").replace(/[a-zA-Z]+/g, "");
  if (!s || s === "-" || s === "--") return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 3 && s.split(",").length > 1 && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    const parts = s.split(".");
    if (parts.length > 2 || (parts[1]?.length === 3 && parts[0] !== "0")) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[], delimiter = ";"): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(delimiter), ...rows.map((r) => columns.map((c) => esc(r[c])).join(delimiter))].join("\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([`\ufeff${text}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
