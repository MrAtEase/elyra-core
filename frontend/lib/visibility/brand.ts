/**
 * Marken-Wahrnehmung (Brand Entities): Was wissen ChatGPT, Gemini und Claude über eine Marke –
 * und stimmt das? Die KI-Antworten werden mit dem Text der eigenen Website abgeglichen.
 * Gespeichert in visibility_runs mit summary.type = "brand".
 */
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { callGeminiText } from "@/lib/ai/geminiDirect";
import {
  ask, dbFail, fetchSiteText, getProject, pool, providerStatus, VisibilityError,
  type ProviderId, type VisibilityProject,
} from "@/lib/visibility/engine";

export type BrandFact = {
  claim: string;
  providers: ProviderId[];
  verdict: "richtig" | "falsch" | "unbelegt";
  correction: string | null;
};

export type BrandAnswer = { prompt: string; provider: ProviderId; model: string; ok: boolean; error?: string; answer: string; sources: string[] };

export type BrandSummary = {
  type: "brand";
  total: number;
  answered: number;
  knows: Record<string, boolean>;
  sentiment: Record<string, "positiv" | "neutral" | "negativ" | "unbekannt">;
  accuracy: number | null;
  facts: BrandFact[];
  topics: string[];
  missing: string[];
  summary: string;
  site_checked: boolean;
};

export type BrandRun = {
  id: string;
  project_id: string;
  workspace_id: string;
  created_at: string;
  summary: BrandSummary;
  results: BrandAnswer[];
  recommendations: string | null;
};

export function brandPrompts(p: Pick<VisibilityProject, "name" | "domain" | "location">): string[] {
  const n = p.domain ? `${p.name} (${p.domain})` : p.name;
  return [
    `Was ist ${n}? Beschreibe das Unternehmen kurz.`,
    `Welche Leistungen oder Produkte bietet ${n} an?`,
    `Wo hat ${n} seinen Sitz, wann wurde es gegründet und wie groß ist es ungefähr?`,
    `Was sind die Stärken und Schwächen von ${n}? Was sagen Kunden?`,
    `Für welche Themen und Kompetenzen ist ${n} bekannt?`,
  ];
}

const VERDICTS = new Set(["richtig", "falsch", "unbelegt"]);
const SENTIMENTS = new Set(["positiv", "neutral", "negativ", "unbekannt"]);

async function evaluate(project: VisibilityProject, answers: BrandAnswer[], site: string) {
  const providers = [...new Set(answers.map((a) => a.provider))];
  const block = answers
    .filter((a) => a.ok)
    .map((a) => `### ${a.provider} – ${a.prompt}\n${a.answer.slice(0, 2500)}`)
    .join("\n\n");
  const { text } = await callGeminiText({
    system: `Du prüfst, was KI-Assistenten über eine Marke wissen, und gleichst es mit der offiziellen Website ab.
Extrahiere die konkreten Tatsachenbehauptungen (Leistungen, Standort, Gründung, Größe, Zielgruppe, Positionierung) aus den Antworten. Fasse gleiche Aussagen zusammen.
verdict: "richtig" wenn die Website es bestätigt, "falsch" wenn die Website widerspricht oder die Aussage klar eine andere Firma meint, "unbelegt" wenn die Website nichts dazu sagt. Bei "falsch" eine kurze Korrektur laut Website.
knows: true, wenn der Anbieter die Marke offensichtlich kennt (nicht nur rät oder sagt, er kenne sie nicht).
sentiment pro Anbieter: positiv/neutral/negativ/unbekannt.
topics: Themen, mit denen die KIs die Marke verbinden. missing: wichtige Leistungen/Themen von der Website, die keine KI erwähnt.
summary: 2–3 Sätze Fazit auf Deutsch.
Antworte nur mit JSON: {"knows":{"<provider>":bool},"sentiment":{"<provider>":"…"},"facts":[{"claim":"…","providers":["gemini"],"verdict":"…","correction":null}],"topics":["…"],"missing":["…"],"summary":"…"}`,
    prompt: `Marke: ${project.name}${project.domain ? ` (${project.domain})` : ""}
Branche: ${project.industry ?? "–"} · Ort: ${project.location ?? "–"}
Anbieter: ${providers.join(", ")}

Website-Text (Auszug):
${site || "(nicht abrufbar – dann alle Fakten als \"unbelegt\" werten, außer sie widersprechen den Angaben oben)"}

KI-Antworten:
${block}`,
    json: true,
    temperature: 0.2,
    maxOutputTokens: 4000,
  });
  const raw = JSON.parse(text) as Record<string, unknown>;
  const knows: Record<string, boolean> = {};
  const sentiment: BrandSummary["sentiment"] = {};
  for (const p of providers) {
    knows[p] = Boolean((raw.knows as Record<string, unknown> | undefined)?.[p]);
    const s = String((raw.sentiment as Record<string, unknown> | undefined)?.[p] ?? "unbekannt");
    sentiment[p] = (SENTIMENTS.has(s) ? s : "unbekannt") as BrandSummary["sentiment"][string];
  }
  const facts: BrandFact[] = (Array.isArray(raw.facts) ? raw.facts : [])
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.claim === "string" && f.claim.trim())
    .slice(0, 40)
    .map((f) => ({
      claim: String(f.claim).slice(0, 400),
      providers: (Array.isArray(f.providers) ? f.providers : []).map(String).filter((p): p is ProviderId => providers.includes(p as ProviderId)),
      verdict: (VERDICTS.has(String(f.verdict)) ? f.verdict : "unbelegt") as BrandFact["verdict"],
      correction: f.correction ? String(f.correction).slice(0, 400) : null,
    }));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 15) : []);
  const checked = facts.filter((f) => f.verdict !== "unbelegt");
  return {
    knows, sentiment, facts,
    topics: list(raw.topics),
    missing: list(raw.missing),
    summary: String(raw.summary ?? "").slice(0, 1200),
    accuracy: checked.length ? checked.filter((f) => f.verdict === "richtig").length / checked.length : null,
  };
}

export async function runBrandCheck(workspaceId: string, projectId: string): Promise<BrandRun> {
  const project = await getProject(workspaceId, projectId);
  const available = providerStatus().filter((p) => p.configured).map((p) => p.id);
  const providers = project.providers.filter((p) => available.includes(p));
  if (providers.length === 0) throw new VisibilityError("Keiner der gewählten KI-Anbieter hat einen API-Schlüssel in .env.local.");

  const prompts = brandPrompts(project);
  const jobs = prompts.flatMap((prompt) => providers.map((provider) => ({ prompt, provider })));
  const [results, site] = await Promise.all([
    pool(jobs, 4, async (j): Promise<BrandAnswer> => {
      try {
        // Ohne Websuche: gemessen wird, was das Modell selbst über die Marke „weiß“.
        const r = await ask(j.provider, j.prompt, false);
        return { prompt: j.prompt, provider: j.provider, model: r.model, ok: true, answer: r.text, sources: r.sources };
      } catch (err) {
        return { prompt: j.prompt, provider: j.provider, model: "", ok: false, error: (err as Error).message, answer: "", sources: [] };
      }
    }),
    fetchSiteText(project.domain),
  ]);
  if (!results.some((r) => r.ok)) throw new VisibilityError(results[0]?.error ?? "Keine Antwort von den KI-Anbietern.");

  const ev = await evaluate(project, results, site);
  const summary: BrandSummary = {
    type: "brand",
    total: results.length,
    answered: results.filter((r) => r.ok).length,
    site_checked: Boolean(site),
    ...ev,
  };
  const { data, error } = await getSupabaseAdminClient()
    .from("visibility_runs")
    .insert({ project_id: project.id, workspace_id: workspaceId, summary, results })
    .select("*")
    .single();
  if (error) dbFail(error.message);
  return data as BrandRun;
}
