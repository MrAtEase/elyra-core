/**
 * KI-Sichtbarkeit (GEO-Monitoring): asks AI assistants typical customer questions and checks
 * whether a business is mentioned – and who is recommended instead.
 *
 * Providers: Gemini (GEMINI_API_KEY), ChatGPT/OpenAI (OPENAI_API_KEY), Claude/Anthropic (ANTHROPIC_API_KEY).
 * Models are configurable: VISIBILITY_GEMINI_MODEL, VISIBILITY_OPENAI_MODEL, VISIBILITY_ANTHROPIC_MODEL.
 */
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { callGeminiText } from "@/lib/ai/geminiDirect";

export type ProviderId = "gemini" | "openai" | "anthropic";

export type VisibilityProject = {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  aliases: string[];
  competitors: string[];
  location: string | null;
  industry: string | null;
  language: string;
  prompts: string[];
  providers: ProviderId[];
  web_search: boolean;
  created_at: string;
  updated_at: string;
};

export type BrandHit = { name: string; rank: number };
export type AnswerResult = {
  prompt: string;
  provider: ProviderId;
  model: string;
  ok: boolean;
  error?: string;
  answer: string;
  mentioned: boolean;
  position: number | null;
  brands: BrandHit[];
  competitors_mentioned: string[];
  sources: string[];
  searched: boolean;
};

export type RunSummary = {
  total: number;
  answered: number;
  mentioned: number;
  rate: number;
  avg_position: number | null;
  by_provider: Record<string, { answered: number; mentioned: number; rate: number }>;
  competitors: Array<{ name: string; mentions: number; rate: number }>;
  others: Array<{ name: string; mentions: number }>;
};

export type VisibilityRun = {
  id: string;
  project_id: string;
  workspace_id: string;
  created_at: string;
  summary: RunSummary;
  results: AnswerResult[];
  recommendations: string | null;
};

export class VisibilityError extends Error {}

const PROJECTS = "visibility_projects";
const RUNS = "visibility_runs";

export function dbFail(message: string): never {
  if (/relation .*visibility_|Could not find the table/i.test(message)) {
    throw new VisibilityError("Tabellen fehlen – bitte frontend/db/migrations/0015_ai_visibility.sql im Supabase SQL Editor ausführen.");
  }
  throw new VisibilityError(message);
}

// ── Providers ───────────────────────────────────────────────────────────────

export function providerStatus() {
  const env = (k: string) => Boolean(process.env[k]?.trim());
  return [
    { id: "gemini" as const, label: "Gemini", configured: env("GEMINI_API_KEY"), model: process.env.VISIBILITY_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite" },
    { id: "openai" as const, label: "ChatGPT (OpenAI)", configured: env("OPENAI_API_KEY"), model: process.env.VISIBILITY_OPENAI_MODEL || "gpt-5.4-mini" },
    { id: "anthropic" as const, label: "Claude (Anthropic)", configured: env("ANTHROPIC_API_KEY"), model: process.env.VISIBILITY_ANTHROPIC_MODEL || "claude-haiku-5-5" },
  ];
}

const SYSTEM = "Du bist ein hilfreicher Assistent. Beantworte die Frage so, wie du es für einen normalen Nutzer tun würdest. Wenn nach Anbietern, Firmen oder Empfehlungen gefragt wird, nenne konkrete Namen.";

type Asked = { text: string; sources: string[]; searched: boolean; model: string };

async function askGemini(prompt: string, webSearch: boolean): Promise<Asked> {
  const model = providerStatus()[0]!.model;
  const run = async (search: boolean) => {
    const r = await callGeminiText({ system: SYSTEM, prompt, temperature: 0.7, maxOutputTokens: 1500, timeoutMs: 60_000, preferredModel: model, ...(search ? { googleSearch: true } : {}) });
    return { text: r.text, sources: r.sources.map((s) => s.title || s.uri), searched: search, model: r.model };
  };
  if (!webSearch) return run(false);
  try { return await run(true); } catch { return run(false); }
}

async function askOpenAI(prompt: string, webSearch: boolean): Promise<Asked> {
  const model = providerStatus()[1]!.model;
  const call = async (search: boolean) => {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model, instructions: SYSTEM, input: prompt, max_output_tokens: 1500, ...(search ? { tools: [{ type: "web_search" }] } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      output_text?: string;
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }>;
    };
    if (!res.ok || data.error) throw new Error(data.error?.message ?? `OpenAI HTTP ${res.status}`);
    const parts = (data.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
    const text = data.output_text ?? parts.map((p) => p.text ?? "").join("");
    const sources = parts.flatMap((p) => p.annotations ?? []).filter((a) => a.url).map((a) => a.title || a.url!);
    return { text, sources: [...new Set(sources)], searched: search, model };
  };
  if (!webSearch) return call(false);
  try { return await call(true); } catch { return call(false); }
}

async function askAnthropic(prompt: string, webSearch: boolean): Promise<Asked> {
  const model = providerStatus()[2]!.model;
  const call = async (search: boolean) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content: prompt }],
        ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      content?: Array<{ type: string; text?: string; citations?: Array<{ url?: string; title?: string }> }>;
    };
    if (!res.ok || data.error) throw new Error(data.error?.message ?? `Anthropic HTTP ${res.status}`);
    const blocks = (data.content ?? []).filter((b) => b.type === "text");
    const sources = blocks.flatMap((b) => b.citations ?? []).filter((c) => c.url).map((c) => c.title || c.url!);
    return { text: blocks.map((b) => b.text ?? "").join(""), sources: [...new Set(sources)], searched: search, model };
  };
  if (!webSearch) return call(false);
  try { return await call(true); } catch { return call(false); }
}

export function ask(provider: ProviderId, prompt: string, webSearch: boolean) {
  if (provider === "openai") return askOpenAI(prompt, webSearch);
  if (provider === "anthropic") return askAnthropic(prompt, webSearch);
  return askGemini(prompt, webSearch);
}

// ── Analysis ────────────────────────────────────────────────────────────────

export function norm(s: string): string {
  // "Müller", "Mueller" and "Muller" all become "muller" (applied to both sides of every comparison)
  return s.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function domainCore(domain: string | null): string | null {
  if (!domain) return null;
  const host = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  return host || null;
}

/** All spellings under which the client counts as "mentioned". */
function clientNeedles(p: Pick<VisibilityProject, "name" | "aliases" | "domain">): string[] {
  const needles = [p.name, ...p.aliases].map(norm).filter((n) => n.length >= 3);
  const host = domainCore(p.domain);
  if (host) {
    needles.push(norm(host));
    const label = host.split(".")[0];
    if (label && label.length >= 4) needles.push(norm(label));
  }
  return [...new Set(needles)];
}

function contains(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

async function extractBrands(answer: string, prompt: string): Promise<BrandHit[]> {
  if (!answer.trim()) return [];
  try {
    const { text } = await callGeminiText({
      system: "Extrahiere aus einer KI-Antwort alle konkret genannten Firmen, Marken, Betriebe oder Anbieter in der Reihenfolge ihrer Nennung. Keine Plattformen wie Google, Yelp, MyHammer, außer sie werden als Anbieter empfohlen. Antworte nur mit JSON: {\"brands\":[{\"name\":\"…\",\"rank\":1}]}",
      prompt: `Frage: ${prompt}\n\nAntwort:\n${answer.slice(0, 6000)}`,
      json: true,
      temperature: 0,
      maxOutputTokens: 800,
      timeoutMs: 30_000,
    });
    const parsed = JSON.parse(text) as { brands?: Array<{ name?: unknown; rank?: unknown }> };
    return (parsed.brands ?? [])
      .filter((b) => typeof b.name === "string" && b.name.trim())
      .map((b, i) => ({ name: String(b.name).trim().slice(0, 120), rank: typeof b.rank === "number" ? b.rank : i + 1 }))
      .slice(0, 25);
  } catch {
    return [];
  }
}

async function analyze(project: VisibilityProject, prompt: string, provider: ProviderId): Promise<AnswerResult> {
  const base = { prompt, provider, model: "", answer: "", mentioned: false, position: null, brands: [], competitors_mentioned: [], sources: [], searched: false };
  let asked: Asked;
  try {
    asked = await ask(provider, prompt, project.web_search);
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
  const answerNorm = norm(asked.text);
  const needles = clientNeedles(project);
  const mentioned = needles.some((n) => contains(answerNorm, n));
  const brands = await extractBrands(asked.text, prompt);
  const hit = brands.find((b) => needles.some((n) => contains(norm(b.name), n) || contains(n, norm(b.name))));
  const competitorsMentioned = project.competitors.filter((c) => {
    const n = norm(c);
    return n.length >= 3 && contains(answerNorm, n);
  });
  return {
    ...base,
    ok: true,
    model: asked.model,
    answer: asked.text.slice(0, 5000),
    mentioned: mentioned || Boolean(hit),
    position: hit ? hit.rank : null,
    brands,
    competitors_mentioned: competitorsMentioned,
    sources: asked.sources.slice(0, 10),
    searched: asked.searched,
  };
}

function summarize(project: VisibilityProject, results: AnswerResult[]): RunSummary {
  const answered = results.filter((r) => r.ok);
  const mentioned = answered.filter((r) => r.mentioned);
  const positions = mentioned.map((r) => r.position).filter((p): p is number => typeof p === "number");
  const byProvider: RunSummary["by_provider"] = {};
  for (const r of answered) {
    const e = (byProvider[r.provider] ??= { answered: 0, mentioned: 0, rate: 0 });
    e.answered++;
    if (r.mentioned) e.mentioned++;
  }
  for (const e of Object.values(byProvider)) e.rate = e.answered ? e.mentioned / e.answered : 0;

  const competitors = project.competitors.map((c) => {
    const mentions = answered.filter((r) => r.competitors_mentioned.includes(c)).length;
    return { name: c, mentions, rate: answered.length ? mentions / answered.length : 0 };
  }).sort((a, b) => b.mentions - a.mentions);

  const needles = clientNeedles(project);
  const known = new Set(project.competitors.map(norm));
  const counts = new Map<string, { name: string; mentions: number }>();
  for (const r of answered) {
    const seen = new Set<string>();
    for (const b of r.brands) {
      const n = norm(b.name);
      if (!n || seen.has(n) || needles.some((x) => contains(n, x) || contains(x, n)) || known.has(n)) continue;
      seen.add(n);
      const entry = counts.get(n) ?? { name: b.name, mentions: 0 };
      entry.mentions++;
      counts.set(n, entry);
    }
  }
  const others = [...counts.values()].sort((a, b) => b.mentions - a.mentions).slice(0, 15);

  return {
    total: results.length,
    answered: answered.length,
    mentioned: mentioned.length,
    rate: answered.length ? mentioned.length / answered.length : 0,
    avg_position: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
    by_provider: byProvider,
    competitors,
    others,
  };
}

export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }));
  return out;
}

// ── Projects & runs (DB) ────────────────────────────────────────────────────

const clean = (list: unknown, max: number, len = 200) =>
  Array.isArray(list) ? [...new Set(list.map((x) => String(x).trim()).filter(Boolean).map((x) => x.slice(0, len)))].slice(0, max) : [];

export function sanitizeProject(input: Record<string, unknown>) {
  const providers = clean(input.providers, 3).filter((p): p is ProviderId => p === "gemini" || p === "openai" || p === "anthropic");
  return {
    name: String(input.name ?? "").trim().slice(0, 120),
    domain: String(input.domain ?? "").trim().slice(0, 200) || null,
    aliases: clean(input.aliases, 10, 120),
    competitors: clean(input.competitors, 15, 120),
    location: String(input.location ?? "").trim().slice(0, 120) || null,
    industry: String(input.industry ?? "").trim().slice(0, 120) || null,
    language: String(input.language ?? "de").trim().slice(0, 8) || "de",
    prompts: clean(input.prompts, 25, 300),
    providers: providers.length ? providers : (["gemini"] as ProviderId[]),
    web_search: input.web_search !== false,
  };
}

export async function listProjects(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from(PROJECTS).select("*").eq("workspace_id", workspaceId).order("created_at");
  if (error) dbFail(error.message);
  const projects = (data ?? []) as VisibilityProject[];
  const ids = projects.map((p) => p.id);
  const runs: Array<{ id: string; project_id: string; created_at: string; summary: RunSummary }> = [];
  if (ids.length) {
    const r = await supabase.from(RUNS).select("id,project_id,created_at,summary").in("project_id", ids).order("created_at", { ascending: true }).limit(500);
    if (r.error) dbFail(r.error.message);
    runs.push(...((r.data ?? []) as typeof runs));
  }
  const isBrand = (x: { summary: unknown }) => (x.summary as { type?: string } | null)?.type === "brand";
  return { projects, runs: runs.filter((x) => !isBrand(x)), brand_runs: runs.filter(isBrand) };
}

export async function saveProject(workspaceId: string, id: string | null, input: Record<string, unknown>) {
  const values = sanitizeProject(input);
  if (!values.name) throw new VisibilityError("Bitte den Namen des Unternehmens angeben.");
  const supabase = getSupabaseAdminClient();
  const q = id
    ? supabase.from(PROJECTS).update({ ...values, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", id).select("*").single()
    : supabase.from(PROJECTS).insert({ ...values, workspace_id: workspaceId }).select("*").single();
  const { data, error } = await q;
  if (error) dbFail(error.message);
  return data as VisibilityProject;
}

export async function deleteProject(workspaceId: string, id: string) {
  const { error } = await getSupabaseAdminClient().from(PROJECTS).delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) dbFail(error.message);
}

export async function getRun(workspaceId: string, runId: string): Promise<VisibilityRun> {
  const { data, error } = await getSupabaseAdminClient().from(RUNS).select("*").eq("workspace_id", workspaceId).eq("id", runId).maybeSingle();
  if (error) dbFail(error.message);
  if (!data) throw new VisibilityError("Messung nicht gefunden.");
  return data as VisibilityRun;
}

export async function getProject(workspaceId: string, id: string): Promise<VisibilityProject> {
  const { data, error } = await getSupabaseAdminClient().from(PROJECTS).select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) dbFail(error.message);
  if (!data) throw new VisibilityError("Projekt nicht gefunden.");
  return data as VisibilityProject;
}

export async function runCheck(workspaceId: string, projectId: string): Promise<VisibilityRun> {
  const project = await getProject(workspaceId, projectId);
  if (project.prompts.length === 0) throw new VisibilityError("Bitte zuerst Fragen anlegen (oder „Fragen vorschlagen“).");
  const available = providerStatus().filter((p) => p.configured).map((p) => p.id);
  const providers = project.providers.filter((p) => available.includes(p));
  if (providers.length === 0) throw new VisibilityError("Keiner der gewählten KI-Anbieter hat einen API-Schlüssel in .env.local.");

  const jobs = project.prompts.flatMap((prompt) => providers.map((provider) => ({ prompt, provider })));
  const results = await pool(jobs, 4, (j) => analyze(project, j.prompt, j.provider));
  const summary = summarize(project, results);

  const { data, error } = await getSupabaseAdminClient()
    .from(RUNS)
    .insert({ project_id: project.id, workspace_id: workspaceId, summary, results })
    .select("*")
    .single();
  if (error) dbFail(error.message);
  return data as VisibilityRun;
}

// ── Helpers powered by Gemini ───────────────────────────────────────────────

export async function suggestPrompts(input: { name: string; industry: string | null; location: string | null; domain: string | null }): Promise<string[]> {
  const { text } = await callGeminiText({
    system: `Du hilfst bei der Messung von KI-Sichtbarkeit. Erstelle 10 realistische Fragen, die potenzielle Kunden einem KI-Assistenten (ChatGPT, Gemini) stellen würden, wenn sie einen Anbieter wie diesen suchen.
Regeln: Der Firmenname kommt NICHT in den Fragen vor. Mische: Empfehlungen („Welcher … ist der beste in …?“), Vergleich, Preis, Notfall/Dringlichkeit, Qualität/Bewertungen, konkrete Leistungen. Natürliche Alltagssprache, Deutsch.
Antworte nur mit JSON: {"prompts":["…"]}`,
    prompt: `Branche/Leistung: ${input.industry ?? "unbekannt"}\nOrt: ${input.location ?? "unbekannt"}\nFirma (nur Kontext): ${input.name}${input.domain ? ` (${input.domain})` : ""}`,
    json: true,
    temperature: 0.6,
    maxOutputTokens: 1200,
  });
  const parsed = JSON.parse(text) as { prompts?: unknown };
  return clean(parsed.prompts, 12, 300);
}

export async function fetchSiteText(domain: string | null): Promise<string> {
  const host = domainCore(domain);
  if (!host) return "";
  try {
    const res = await fetch(`https://${host}`, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (Elyra GEO-Check)" } });
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return "";
  }
}

export async function recommend(workspaceId: string, runId: string): Promise<string> {
  const run = await getRun(workspaceId, runId);
  const project = await getProject(workspaceId, run.project_id);
  const site = await fetchSiteText(project.domain);
  const s = run.summary;
  const notMentioned = run.results.filter((r) => r.ok && !r.mentioned).slice(0, 6).map((r) => `- ${r.prompt} → genannt: ${r.brands.slice(0, 4).map((b) => b.name).join(", ") || "keine Firmen"}`).join("\n");
  const allSources = [...new Set(run.results.flatMap((r) => r.sources))].slice(0, 20).join(", ");
  const { text } = await callGeminiText({
    system: `Du bist GEO-Berater (Generative Engine Optimization) für kleine Unternehmen. Erstelle einen konkreten, priorisierten Maßnahmenplan, damit die Firma in Antworten von ChatGPT, Gemini und Claude häufiger empfohlen wird.
Gliederung: ## Kurzdiagnose (2–3 Sätze) · ## Top 5 Maßnahmen (je: Was, Warum, Aufwand niedrig/mittel/hoch) · ## Inhalte, die auf der Website fehlen · ## Erwähnungen außerhalb der Website (Verzeichnisse, Bewertungen, Presse, Branchenportale) · ## Nächste Messung.
Bleib konkret und ehrlich; verspreche keine Garantien. Deutsch, Markdown.`,
    prompt: `Firma: ${project.name}${project.domain ? ` (${project.domain})` : ""}
Branche: ${project.industry ?? "–"} · Ort: ${project.location ?? "–"}
Ergebnis: in ${s.mentioned} von ${s.answered} KI-Antworten erwähnt (${Math.round(s.rate * 100)} %).
Wettbewerber-Erwähnungen: ${s.competitors.map((c) => `${c.name} ${c.mentions}×`).join(", ") || "–"}
Stattdessen häufig genannt: ${s.others.slice(0, 8).map((o) => `${o.name} ${o.mentions}×`).join(", ") || "–"}
Von den KIs genutzte Quellen: ${allSources || "–"}
Fragen ohne Erwähnung:
${notMentioned || "–"}

Website-Text (Auszug):
${site || "(nicht abrufbar)"}`,
    temperature: 0.4,
    maxOutputTokens: 3000,
  });
  const md = text.trim();
  await getSupabaseAdminClient().from(RUNS).update({ recommendations: md }).eq("workspace_id", workspaceId).eq("id", runId);
  return md;
}
