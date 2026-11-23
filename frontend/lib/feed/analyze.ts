/**
 * Shopping-Feed-Optimierer – liest Google-Merchant-Feeds (CSV/TSV oder RSS/Atom-XML), prüft sie und exportiert sie wieder.
 * Pure functions (browser); KI-Vorschläge kommen über /api/os/feed.
 */
import { normHeader, parseTable, toCsv } from "@/lib/data/table";

export type Product = Record<string, string> & { id: string };
export type Issue = { field: string; level: "error" | "warn"; msg: string };
export type CheckedProduct = { product: Product; issues: Issue[]; score: number };

/** Canonical Merchant Center attribute names and the header spellings we accept. */
const ALIASES: Record<string, string[]> = {
  id: ["id", "artikelnummer", "item id", "sku", "produkt id"],
  title: ["title", "titel", "produktname", "name"],
  description: ["description", "beschreibung"],
  link: ["link", "url", "produkt url", "product url"],
  image_link: ["image link", "image_link", "bild link", "bildlink", "image url", "bild url"],
  price: ["price", "preis"],
  sale_price: ["sale price", "angebotspreis", "sonderpreis"],
  availability: ["availability", "verfugbarkeit", "verfuegbarkeit"],
  condition: ["condition", "zustand"],
  brand: ["brand", "marke"],
  gtin: ["gtin", "ean"],
  mpn: ["mpn", "herstellernummer"],
  identifier_exists: ["identifier exists", "identifier_exists"],
  google_product_category: ["google product category", "google produktkategorie"],
  product_type: ["product type", "produkttyp"],
  color: ["color", "farbe"],
  size: ["size", "grosse", "groesse"],
  gender: ["gender", "geschlecht"],
  age_group: ["age group", "altersgruppe"],
  material: ["material"],
};

function canonical(header: string): string {
  const n = normHeader(header).replace(/^g /, "");
  for (const [key, list] of Object.entries(ALIASES)) if (list.includes(n) || n === key.replace(/_/g, " ")) return key;
  return n.replace(/ /g, "_");
}

function parseXml(text: string): Product[] {
  const items = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  return items.map((item) => {
    const p: Record<string, string> = {};
    const re = /<(?:g:)?([a-zA-Z_]+)(?:\s[^>]*)?>([\s\S]*?)<\/(?:g:)?\1>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(item))) {
      const key = canonical(m[1]!);
      if (!p[key]) p[key] = decode(m[2]!);
    }
    return { ...p, id: p.id ?? "" } as Product;
  });
}

export function parseFeed(text: string): { products: Product[]; columns: string[] } {
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    const products = parseXml(trimmed);
    const columns = [...new Set(products.flatMap((p) => Object.keys(p)))];
    return { products, columns };
  }
  const t = parseTable(trimmed, (cells) => cells.some((c) => ALIASES.id!.includes(c)) && cells.some((c) => ALIASES.title!.includes(c)));
  const map = t.headers.map((h) => canonical(h));
  const products = t.rows.map((r) => {
    const p: Record<string, string> = {};
    t.headers.forEach((h, i) => { p[map[i]!] = (r[h] ?? "").trim(); });
    return { ...p, id: p.id ?? "" } as Product;
  });
  return { products, columns: [...new Set(map)] };
}

const PROMO = /\b(gratis|kostenlos|sale|rabatt|angebot|bestseller|top[- ]?preis|nur heute|versandkostenfrei|free shipping|best price)\b|!{2,}|%/i;
const APPAREL = /(bekleidung|apparel|kleidung|schuhe|shoes|mode|fashion|shirt|hose|jacke|kleid)/i;

export function checkProduct(p: Product, duplicateIds: Set<string>): CheckedProduct {
  const issues: Issue[] = [];
  const err = (field: string, msg: string) => issues.push({ field, level: "error", msg });
  const warn = (field: string, msg: string) => issues.push({ field, level: "warn", msg });
  const v = (k: string) => (p[k] ?? "").trim();

  if (!v("id")) err("id", "ID fehlt");
  else if (duplicateIds.has(v("id"))) err("id", "ID doppelt vergeben");
  if (!v("title")) err("title", "Titel fehlt");
  else {
    if (v("title").length > 150) err("title", `Titel zu lang (${v("title").length}/150)`);
    else if (v("title").length < 30) warn("title", `Titel sehr kurz (${v("title").length} Zeichen) – Marke, Typ, Merkmale ergänzen`);
    if (v("title") === v("title").toUpperCase() && /[A-ZÄÖÜ]{6,}/.test(v("title"))) warn("title", "Titel komplett in Großbuchstaben");
    if (PROMO.test(v("title"))) warn("title", "Werbe-Begriffe im Titel (nicht erlaubt)");
  }
  if (!v("description")) err("description", "Beschreibung fehlt");
  else {
    if (v("description").length < 100) warn("description", `Beschreibung kurz (${v("description").length} Zeichen)`);
    if (v("description").length > 5000) err("description", "Beschreibung über 5000 Zeichen");
    if (PROMO.test(v("description"))) warn("description", "Werbe-Begriffe in der Beschreibung");
  }
  if (!v("link")) err("link", "Produkt-Link fehlt");
  else if (!/^https?:\/\//.test(v("link"))) err("link", "Link ohne http(s)");
  if (!v("image_link")) err("image_link", "Bild-Link fehlt");
  else if (!/^https?:\/\//.test(v("image_link"))) err("image_link", "Bild-Link ohne http(s)");
  if (!v("price")) err("price", "Preis fehlt");
  else if (!/^\d+([.,]\d{1,2})?\s?[A-Z]{3}$/.test(v("price"))) warn("price", `Preisformat „${v("price")}“ – erwartet z. B. „19.99 EUR“`);
  if (!v("availability")) err("availability", "Verfügbarkeit fehlt");
  else if (!/^(in[ _]stock|out[ _]of[ _]stock|preorder|backorder|auf lager|nicht auf lager|vorbestellt)$/i.test(v("availability"))) warn("availability", `Unbekannter Wert „${v("availability")}“`);
  if (!v("brand")) warn("brand", "Marke fehlt");
  if (!v("gtin") && !v("mpn") && !/^(no|false|nein)$/i.test(v("identifier_exists"))) err("gtin", "GTIN/EAN und MPN fehlen (oder identifier_exists = no setzen)");
  if (v("gtin") && !/^\d{8}$|^\d{12,14}$/.test(v("gtin"))) warn("gtin", "GTIN hat ein ungewöhnliches Format");
  if (!v("google_product_category")) warn("google_product_category", "Google-Produktkategorie fehlt");
  if (!v("condition")) warn("condition", "Zustand fehlt (new/used/refurbished)");
  if (APPAREL.test(`${v("google_product_category")} ${v("product_type")} ${v("title")}`)) {
    for (const f of ["color", "size", "gender", "age_group"]) if (!v(f)) warn(f, `Bekleidung: ${f} fehlt`);
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.length - errors;
  return { product: p, issues, score: Math.max(0, 100 - errors * 15 - warns * 5) };
}

export function checkFeed(products: Product[]): CheckedProduct[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of products) { if (p.id && seen.has(p.id)) dup.add(p.id); seen.add(p.id); }
  return products.map((p) => checkProduct(p, dup));
}

export function exportFeed(products: Product[], columns: string[]): string {
  const cols = ["id", ...columns.filter((c) => c !== "id")];
  return toCsv(products, cols, "\t");
}

export const DEMO_FEED = `id\ttitle\tdescription\tlink\timage link\tprice\tavailability\tcondition\tbrand\tgtin\tmpn\tgoogle product category\tproduct type\tcolor\tsize
SHOE-001\tLaufschuh\tBequemer Schuh.\thttps://shop.example.de/p/shoe-001\thttps://shop.example.de/img/shoe-001.jpg\t89.95 EUR\tin stock\tnew\tVelora\t4006381333931\t\tBekleidung & Accessoires > Schuhe\tLaufschuhe > Herren\tSchwarz\t43
SHOE-002\tVELORA TRAIL PRO GORE-TEX WASSERDICHT TOP PREIS!!!\tDer Trailschuh für jedes Gelände. Wasserdicht dank Membran, griffige Sohle, gedämpft.\thttps://shop.example.de/p/shoe-002\thttps://shop.example.de/img/shoe-002.jpg\t129,00\tin stock\tnew\tVelora\t\t\tBekleidung & Accessoires > Schuhe\tTrailschuhe\t\t
BAG-010\tRucksack Urban 22 L, recyceltes Polyester, Laptopfach 15 Zoll, wasserabweisend – Anthrazit\tUrbaner Tagesrucksack mit 22 Litern Volumen aus recyceltem Polyester. Gepolstertes Laptopfach für Geräte bis 15 Zoll, wasserabweisende Oberfläche, Brustgurt und Trolley-Lasche. Ideal für Pendler und kurze Reisen.\thttps://shop.example.de/p/bag-010\thttps://shop.example.de/img/bag-010.jpg\t69.90 EUR\tin stock\tnew\tUrbanpack\t4260123456789\tUP-22-ANT\tGepäck & Taschen > Rucksäcke\tRucksäcke\tAnthrazit\t
BAG-011\tTasche\t\thttps://shop.example.de/p/bag-011\t\t39.90 EUR\t\tnew\t\t\t\t\tTaschen\t\t
SHOE-001\tLaufschuh Damen\tLeichter Laufschuh für Damen mit atmungsaktivem Obermaterial.\thttps://shop.example.de/p/shoe-001-w\thttps://shop.example.de/img/shoe-001-w.jpg\t89.95 EUR\tin stock\tnew\tVelora\t4006381333948\t\tBekleidung & Accessoires > Schuhe\tLaufschuhe > Damen\tWeiß\t39`;
