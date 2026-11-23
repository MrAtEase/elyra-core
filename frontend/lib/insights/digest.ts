/**
 * KI-Newsletter-Digest: liest Newsletter/Updates aus Gmail (nur lesend), fasst sie mit Gemini
 * zu einem Branchen-Briefing zusammen und speichert es in insights_digests.
 */
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { callGeminiText } from "@/lib/ai/geminiDirect";
import { ensureGoogleAccessToken } from "@/lib/google/tokenStore";
import { getGmailMessageDetail, listGmailMessages } from "@/lib/google/gmail";
import { GOOGLE_GMAIL_READONLY_SCOPE } from "@/lib/google/scopes";

export class DigestError extends Error {}

export const DEFAULT_QUERY = "(category:promotions OR category:updates OR label:newsletter OR unsubscribe OR abmelden) -category:social -category:forums -from:(instagram OR facebook OR tiktok OR quora OR joyn OR netflix OR chess)";
export const DEFAULT_FOCUS = "KI, MarTech, Performance-Marketing, Google/Meta/Amazon Ads, Retail Media, Suchmaschinen und KI-Suche";

export type DigestSource = { n: number; subject: string; from: string; date: string; url: string };
export type Digest = {
  id: string;
  workspace_id: string;
  created_at: string;
  query: string;
  focus: string;
  days: number;
  message_count: number;
  content: string;
  sources: DigestSource[];
};

function dbFail(message: string): never {
  if (/relation .*insights_digests|Could not find the table/i.test(message)) {
    throw new DigestError("Tabelle fehlt – bitte frontend/db/migrations/0016_insights_automations.sql im Supabase SQL Editor ausführen.");
  }
  throw new DigestError(message);
}

const strip = (s: string) => s.replace(/https?:\/\/\S+/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export type DigestSourceMode = "gmail" | "rss" | "both";

/** Fachquellen mit öffentlichem RSS/Atom-Feed. Feeds, die nicht antworten, werden übersprungen (Hinweis im Ergebnis). */
export const DEFAULT_FEEDS: string[] = [
  // Deutsch – Marketing, SEO/SEA, KI
  "https://t3n.de/rss.xml",
  "https://t3n.de/tag/kuenstliche-intelligenz/rss.xml",
  "https://onlinemarketing.de/feed",
  "https://www.horizont.net/news/feed/",
  "https://www.seo-suedwest.de/?format=feed&type=rss",
  // Paid Search, Ads & Retail Media
  "https://ppc.land/rss/",
  "https://www.seroundtable.com/index.xml",
  "https://www.searchenginejournal.com/feed/",
  "https://www.adexchanger.com/feed/",
  "https://digiday.com/feed/",
  "https://www.retaildive.com/feeds/news/",
  // MarTech & Marketing allgemein
  "https://martech.org/feed/",
  "https://www.marketingdive.com/feeds/news/",
  "https://www.socialmediatoday.com/feeds/news/",
  "https://blog.hubspot.com/marketing/rss.xml",
  // Plattformen & KI
  "https://blog.google/products/ads-commerce/rss/",
  "https://blog.google/technology/ai/rss/",
  "https://openai.com/news/rss.xml",
  "https://www.deepmind.com/blog/rss.xml",
  "https://techcrunch.com/category/artificial-intelligence/feed/",
  "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
];

type Item = { from: string; subject: string; date: string; url: string; body: string };

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();

function tag(block: string, names: string[]): string {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (m?.[1]?.trim()) return m[1];
  }
  return "";
}

export async function fetchFeed(url: string, sinceMs: number, perFeed: number): Promise<Item[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (Elyra News Digest)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const channel = decode(tag(xml.split(/<item|<entry/i)[0] ?? "", ["title"])) || new URL(url).hostname.replace(/^www\./, "");
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  if (!blocks.length) throw new Error("kein RSS/Atom");
  const items: Item[] = [];
  for (const b of blocks) {
    const link = decode(tag(b, ["link"])) || b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "";
    const dateRaw = decode(tag(b, ["pubDate", "published", "updated", "dc:date"]));
    const t = Date.parse(dateRaw);
    if (Number.isFinite(t) && t < sinceMs) continue;
    items.push({
      from: channel.slice(0, 80),
      subject: decode(tag(b, ["title"])).slice(0, 200) || "(ohne Titel)",
      date: Number.isFinite(t) ? new Date(t).toISOString() : dateRaw,
      url: link,
      body: decode(tag(b, ["description", "summary", "content:encoded", "content"])).slice(0, 900),
    });
  }
  return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, perFeed);
}

export async function runDigest(input: {
  workspaceId: string; userId?: string | null | undefined; days?: number | undefined; query?: string | undefined; focus?: string | undefined;
  limit?: number | undefined; source?: DigestSourceMode | undefined; feeds?: string[] | undefined;
}): Promise<Digest & { warnings: string[] }> {
  const days = Math.max(1, Math.min(31, Math.round(input.days ?? 7)));
  const query = (input.query?.trim() || DEFAULT_QUERY).slice(0, 400);
  const focus = (input.focus?.trim() || DEFAULT_FOCUS).slice(0, 400);
  const limit = Math.max(3, Math.min(40, input.limit ?? 25));
  const mode: DigestSourceMode = input.source === "gmail" || input.source === "both" ? input.source : "rss";
  const feeds = [...new Set((input.feeds?.length ? input.feeds : DEFAULT_FEEDS).map((f) => f.trim()).filter((f) => /^https?:\/\//.test(f)))].slice(0, 20);
  const warnings: string[] = [];
  const items: Item[] = [];

  if (mode !== "gmail") {
    const sinceMs = Date.now() - days * 86_400_000;
    const perFeed = Math.max(3, Math.min(8, Math.floor(60 / Math.max(1, feeds.length))));
    const results = await Promise.all(feeds.map((f) => fetchFeed(f, sinceMs, perFeed).then((r) => ({ f, r, e: null as string | null })).catch((e: Error) => ({ f, r: [] as Item[], e: e.message }))));
    for (const { f, r, e } of results) {
      if (e) warnings.push(`Feed nicht erreichbar: ${f} (${e})`);
      items.push(...r);
    }
  }

  if (mode !== "rss") {
    try {
      const token = await ensureGoogleAccessToken({ workspaceId: input.workspaceId, userId: input.userId ?? null, requiredScopes: [GOOGLE_GMAIL_READONLY_SCOPE] });
      const list = await listGmailMessages({ accessToken: token.accessToken, q: `newer_than:${days}d ${query}`, limit });
      const details = await Promise.all(list.map((m) => getGmailMessageDetail({ accessToken: token.accessToken, messageId: m.id }).catch(() => null)));
      for (const m of details) {
        if (!m) continue;
        items.push({
          from: m.from.replace(/<.*?>/g, "").replace(/"/g, "").trim() || m.from,
          subject: m.subject || "(ohne Betreff)",
          date: m.date,
          url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
          body: strip(m.bodyText || m.preview).slice(0, 3500),
        });
      }
    } catch (err) {
      if (mode === "gmail") throw new DigestError(`Gmail ist nicht verbunden (${(err as Error).message}). Bitte unter Integrationen Google verbinden.`);
      warnings.push(`Gmail übersprungen: ${(err as Error).message}`);
    }
  }

  if (items.length === 0) {
    throw new DigestError(`Keine Beiträge in den letzten ${days} Tagen gefunden.${warnings.length ? " " + warnings.join(" · ") : ""}`);
  }

  const sources: DigestSource[] = items.map((it, i) => ({ n: i + 1, subject: it.subject, from: it.from, date: it.date, url: it.url }));
  const mails = items;
  const corpus = items
    .map((it, i) => `[${i + 1}] Quelle: ${it.from} · Titel: ${it.subject} · ${it.date}\n${it.body}`)
    .join("\n\n---\n\n")
    .slice(0, 90_000);

  const { text } = await callGeminiText({
    system: `Du bist Analyst für ein Innovationsteam (Agentur für Performance-Marketing). Erstelle aus Fachartikeln und Newslettern ein knappes, nützliches Branchen-Briefing auf Deutsch.
Fokus: ${focus}. Werbung, Rabattaktionen und Irrelevantes weglassen.
Verwende genau diese vier Überschriften (Markdown, ohne Zusätze in Klammern):
## Das Wichtigste in 30 Sekunden
## Neuigkeiten nach Thema
## Was bedeutet das für uns?
## Lesenswert
Inhalt: unter „Das Wichtigste“ 3–5 Bullets; unter „Neuigkeiten“ je Thema eine ### Zwischenüberschrift mit 2–5 Bullets; unter „Was bedeutet das für uns?“ konkrete Chancen und Ideen für die Agentur und ihre Kunden; unter „Lesenswert“ höchstens 5 Beiträge mit kurzem Grund.
Jede Aussage mit Quelle wie [3]. Nur Fakten aus den Beiträgen, nichts erfinden.`,
    prompt: `Zeitraum: letzte ${days} Tage · ${mails.length} Beiträge\n\n${corpus}`,
    temperature: 0.3,
    maxOutputTokens: 4000,
    timeoutMs: 120_000,
  });

  // Only list the mails the briefing actually cites (numbering stays as in the text).
  const cited = new Set<number>();
  for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) for (const n of m[1]!.split(",")) cited.add(Number(n.trim()));
  const usedSources = cited.size ? sources.filter((src) => cited.has(src.n)) : sources;

  const { data, error } = await getSupabaseAdminClient()
    .from("insights_digests")
    .insert({ workspace_id: input.workspaceId, query: mode === "rss" ? `rss: ${feeds.length} Feeds` : mode === "both" ? `rss+gmail: ${query}` : query, focus, days, message_count: mails.length, content: text.trim(), sources: usedSources })
    .select("*")
    .single();
  if (error) dbFail(error.message);
  return { ...(data as Digest), warnings };
}

export async function listDigests(workspaceId: string, limit = 20): Promise<Digest[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from("insights_digests").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (error) dbFail(error.message);
  return (data ?? []) as Digest[];
}

export async function deleteDigest(workspaceId: string, id: string) {
  const { error } = await getSupabaseAdminClient().from("insights_digests").delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbFail(error.message);
}

/** Prüft Feeds: erreichbar? wie viele Beiträge in den letzten `days` Tagen? */
export async function testFeeds(urls: string[], days = 7) {
  const sinceMs = Date.now() - days * 86_400_000;
  const list = [...new Set(urls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)))].slice(0, 40);
  return Promise.all(list.map(async (url) => {
    try {
      const items = await fetchFeed(url, sinceMs, 100);
      return { url, ok: true, count: items.length, source: items[0]?.from ?? "", latest: items[0]?.subject ?? "", error: null as string | null };
    } catch (err) {
      return { url, ok: false, count: 0, source: "", latest: "", error: (err as Error).message };
    }
  }));
}
