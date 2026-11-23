import { randomUUID } from "node:crypto";
import { callModel } from "../models/router.js";
import { logger } from "../lib/logger.js";
import { readSearchTerms, readHours, runAudit } from "../ads-audit/analyze.js";
import { AGENTS, AGENT_ORDER, isLogoTask } from "./roster.js";
import type { AgentId, AgentOutput, AgentState, TeamRun } from "./types.js";

/**
 * Agenten-Team-Orchestrator
 * 1. Planen: Auftrag in Teilaufträge für Spezial-Agenten zerlegen
 * 2. Phase 1: Marketing, Texter, Design, Coding arbeiten PARALLEL
 * 3. Phase 2: Präsentation baut auf den Ergebnissen von Phase 1 auf
 * 4. Zusammenführen: Gesamtergebnis mit nächsten Schritten
 * Alle Ergebnisse sind Entwürfe – nichts wird extern umgesetzt, ein Mensch gibt frei.
 */

const AGENT_TIMEOUT_MS = 120_000;
const MAX_RUNS_STORED = 30;
const RUN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVE_RUNS = 3;

const runs = new Map<string, TeamRun>();

const now = () => new Date().toISOString();

function prune() {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) {
    if (Date.parse(run.createdAt) < cutoff) runs.delete(id);
  }
  while (runs.size > MAX_RUNS_STORED) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
}

export function getRun(id: string): TeamRun | undefined {
  return runs.get(id);
}

export function listRuns(): Array<Pick<TeamRun, "id" | "task" | "status" | "createdAt" | "mode"> & { agents: AgentId[] }> {
  return [...runs.values()].reverse().map(({ id, task, status, createdAt, mode, agents }) => ({ id, task, status, createdAt, mode, agents: agents.map((a) => a.agent) }));
}

function activeRunCount(): number {
  return [...runs.values()].filter((r) => r.status === "planning" || r.status === "running" || r.status === "merging").length;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: Zeitlimit überschritten`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------- Planung ----------

const KEYWORDS: Record<AgentId, RegExp> = {
  marketing: /\b(marketing|kampagne|strategie|zielgruppe|kanäle|kanal|budget|performance|launch|reichweite)/i,
  sea: /\b(google ads|sea|adwords|ausschluss|suchbegriff|gebot|cpc|cpa|ads-konto|ads konto)/i,
  seo: /\b(seo|ranking|meta-titel|meta titel|keyword-recherche|organisch|suchmaschinen)/i,
  social: /\b(social|instagram|linkedin|tiktok|facebook|redaktionsplan|posts?)\b/i,
  copy: /\b(text|texte|anzeige|anzeigen|slogan|claim|headline|copy|betreff|newsletter|landingpage)/i,
  reporting: /\b(report|reporting|kundenbericht|monatsbericht|auswertung|kpi)/i,
  leads: /\b(leads?|neukunden|akquise|prospects?)\b/i,
  competitor: /\b(wettbewerb|konkurrenz|mitbewerber|competitor)/i,
  tracking: /\b(tracking|ga4|analytics|tag manager|gtm|conversion-tracking|datalayer|consent)/i,
  design: /\b(design|logo|farbe|farben|look|layout|banner|visual|mockup|branding|signet)/i,
  coding: /\b(script|skript|code schreiben|automatis|tool bauen|api|programm|bot|webhook|integration)/i,
  review: /\b(code-review|code review|review|prüfe den code|refactor)/i,
  qa: /\b(tests?|testfälle|qa|unit-test|unittest)\b/i,
  application: /\b(bewerbung|lebenslauf|cv|anschreiben|stellenanzeige|vorstellungsgespräch)/i,
  mail: /\b(mails?|e-mails?|posteingang|inbox|termine?|kalender)\b/i,
  authority: /\b(behörde|finanças|financas|segurança social|sns|vermieter|amt|formeller brief|brief an)/i,
  research: /\b(recherchier|recherche|finde heraus|aktuell|news|suche im web|quellen)/i,
  coach: /\b(lernen|üben|gitarre|sprache|vokabeln|zauber|trainingsplan|übungsplan)/i,
  presentation: /\b(präsentation|praesentation|pitch|slides|folien|deck|vortrag)/i,
};

/** Nur die Agenten, nach denen gefragt wurde. Ohne Treffer: Marketing + Texter als sinnvolle Grundbesetzung. */
function ruleBasedSelection(task: string): AgentId[] {
  if (isLogoTask(task) && !KEYWORDS.marketing.test(task) && !KEYWORDS.presentation.test(task)) return ["design"];
  const picked = AGENT_ORDER.filter((id) => KEYWORDS[id].test(task)).slice(0, 5);
  return picked.length ? picked : ["marketing", "copy"];
}

async function planTeam(task: string, context: string | null, selected: AgentId[] | null): Promise<{
  summary: string;
  source: "model" | "rules";
  tasks: Array<{ agent: AgentId; brief: string }>;
}> {
  const allowed = selected && selected.length ? selected : null;
  const roster = AGENT_ORDER.filter((a) => !allowed || allowed.includes(a))
    .map((a) => `- ${a}: ${AGENTS[a].name} – ${AGENTS[a].role}`)
    .join("\n");
  try {
    const res = await withTimeout(
      callModel(
        `Du bist der Orchestrator eines KI-Agenten-Teams in einer Marketing-Agentur.
Verfügbare Agenten:
${roster}
Zerlege den Auftrag in klare Teilaufträge. ${allowed ? "Setze GENAU diese Agenten ein." : `Setze NUR Agenten ein, nach deren Arbeit der Auftrag wirklich fragt – oft reicht EIN Agent.
Beispiele: "Designe ein Logo" → nur design. "Schreib Anzeigentexte" → nur copy. "Bau ein Script" → nur coding.
"Mach eine Präsentation über X" → presentation (plus höchstens die Agenten, deren Inhalte dafür fehlen).
Füge nie Online-Marketing, Strategie oder Zielgruppenanalyse hinzu, wenn nicht danach gefragt wurde.`}
Formuliere jeden Teilauftrag so, dass der Agent genau das Verlangte liefert (bei Logos: Logo-Entwürfe, keine Landingpage).
Antworte NUR mit JSON: {"summary": string (1–2 Sätze: wie das Team vorgeht), "tasks": [{"agent": string, "brief": string (konkreter Auftrag, 2–4 Sätze)}]}`,
        JSON.stringify({ task, context: context ? context.slice(0, 6000) : null }),
        { json: true, preferredProvider: "anthropic" },
      ),
      45_000,
      "Planung",
    );
    const text = res.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { summary?: unknown; tasks?: unknown };
    const tasks = Array.isArray(parsed.tasks)
      ? (parsed.tasks as Array<Record<string, unknown>>).flatMap((t) => {
          const agent = t["agent"];
          const brief = typeof t["brief"] === "string" ? t["brief"].trim().slice(0, 1500) : "";
          return typeof agent === "string" && agent in AGENTS && (!allowed || allowed.includes(agent as AgentId)) && brief
            ? [{ agent: agent as AgentId, brief }]
            : [];
        })
      : [];
    // Doppelte Agenten zusammenführen, gewählte Agenten ohne Brief ergänzen
    const unique = new Map<AgentId, string>();
    for (const t of tasks) if (!unique.has(t.agent)) unique.set(t.agent, t.brief);
    for (const a of allowed ?? []) if (!unique.has(a)) unique.set(a, task);
    // Sicherheitsnetz: Marketing nur, wenn danach gefragt wurde (der Planer neigt dazu, es überall dazuzunehmen)
    if (!allowed && unique.size > 1 && !KEYWORDS.marketing.test(task)) unique.delete("marketing");
    if (unique.size >= 1) {
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 600) : "",
        source: "model",
        tasks: AGENT_ORDER.filter((a) => unique.has(a)).map((a) => ({ agent: a, brief: unique.get(a)! })),
      };
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "agent-team: planner unavailable, using rule-based plan");
  }
  const agents = allowed ?? ruleBasedSelection(task);
  return {
    summary: "Regelbasierte Aufteilung (kein KI-Planer erreichbar).",
    source: "rules",
    tasks: agents.map((agent) => ({ agent, brief: task })),
  };
}

// ---------- Agenten ausführen ----------

function outputDigest(state: AgentState): string {
  const o = state.output;
  if (!o) return "";
  if (o.kind === "markdown") return o.markdown;
  if (o.kind === "design" && o.design.deliverable === "logo") return `${o.markdown}\nLogo-Entwürfe: ${o.design.logos.map((l) => `${l.name} – ${l.idea}`).join("; ")}\nFarben: ${o.design.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}`;
  if (o.kind === "design") return `${o.markdown}\nFarben: ${o.design.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}\nSchriften: ${o.design.fonts.heading} / ${o.design.fonts.body}\nPrinzipien: ${o.design.principles.join("; ")}`;
  if (o.kind === "code") return `${o.markdown}\nDateien: ${o.files.map((f) => f.path).join(", ")}`;
  return `${o.markdown}\nFolien: ${o.deck.slides.map((s) => s.title).join(" | ")}`;
}

async function runAgent(run: TeamRun, state: AgentState, feedback: string | null = null): Promise<void> {
  const def = AGENTS[state.agent];
  state.status = "running";
  state.startedAt = now();
  state.finishedAt = null;
  state.error = null;

  const teamResults = state.phase === 2
    ? run.agents.filter((a) => a.phase === 1 && a.output).map((a) => `## ${a.name}\n${outputDigest(a).slice(0, 4000)}`).join("\n\n")
    : null;

  let toolData: string | null = null;
  if (def.gather) {
    try {
      toolData = await withTimeout(def.gather({ task: run.task, brief: state.brief, workspaceId: run.workspaceId }), 30_000, `${def.name}-Werkzeug`);
    } catch (err) {
      toolData = JSON.stringify({ werkzeugFehler: (err as Error).message });
    }
  }

  const userMessage = JSON.stringify({
    werkzeugDaten: toolData,
    auftrag: run.task,
    teilauftrag: state.brief,
    kontext: run.context ? run.context.slice(0, 8000) : null,
    ergebnisseDerAnderenAgenten: teamResults,
    vorherigesErgebnis: feedback && state.output ? outputDigest(state).slice(0, 4000) : null,
    feedbackDesMenschen: feedback,
  });

  let output: AgentOutput | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !output; attempt++) {
    try {
      const system = attempt === 0 ? def.system : `${def.system}\n\nWICHTIG: Deine letzte Antwort war ungültig (${lastError}). Halte das Format exakt ein.`;
      const res = await withTimeout(
        def.call ? def.call(system, userMessage) : callModel(system, userMessage, { json: def.json, preferredProvider: def.preferredProvider }),
        AGENT_TIMEOUT_MS,
        def.name,
      );
      output = def.parse(res.text);
      state.model = res.model;
      state.source = "model";
    } catch (err) {
      lastError = (err as Error).message;
      // Ohne konfigurierte Anbieter lohnt kein zweiter Versuch
      if (/No AI model providers configured/i.test(lastError)) break;
    }
  }

  if (!output) {
    logger.warn({ agent: state.agent, err: lastError }, "agent-team: agent fell back to template");
    output = def.template(run.task, state.brief);
    state.model = null;
    state.source = "template";
    state.error = /No AI model providers configured/i.test(lastError)
      ? "Kein KI-Modell konfiguriert – Vorlage angezeigt."
      : `KI-Antwort nicht verwendbar (${lastError}) – Vorlage angezeigt.`;
  }

  state.output = output;
  state.status = "done";
  state.finishedAt = now();
}

// ---------- Zusammenführen ----------

async function mergeResults(run: TeamRun): Promise<{ markdown: string; source: "model" | "rules" }> {
  const results = run.agents.map((a) => `## ${a.name}${a.source === "template" ? " (Vorlage)" : ""}\n${outputDigest(a).slice(0, 3000)}`).join("\n\n");
  try {
    const res = await withTimeout(
      callModel(
        `Du bist der Orchestrator eines KI-Agenten-Teams. Fasse die Ergebnisse für den Menschen zusammen, der sie freigeben muss.
Markdown, Deutsch: "### Ergebnis in Kürze" (3–4 Sätze), "### Was das Team geliefert hat" (je Agent 1 Zeile),
"### Offene Punkte & Annahmen", "### Nächste Schritte" (3 nummerierte Punkte). Erfinde nichts, was nicht in den Ergebnissen steht.
Wenn ein Ergebnis als Vorlage markiert ist, weise darauf hin.`,
        JSON.stringify({ auftrag: run.task, ergebnisse: results }),
        { preferredProvider: "anthropic" },
      ),
      60_000,
      "Zusammenführung",
    );
    const markdown = res.text.trim();
    if (markdown.length > 40) return { markdown, source: "model" };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "agent-team: merge unavailable, using rule-based summary");
  }
  const lines = [
    "### Ergebnis in Kürze",
    `Das Team hat ${run.agents.length} Teilaufträge bearbeitet: ${run.agents.map((a) => a.name).join(", ")}.`,
    run.agents.some((a) => a.source === "template") ? "Einige Ergebnisse sind Vorlagen, weil kein KI-Modell erreichbar war." : "",
    "",
    "### Nächste Schritte",
    "1. Ergebnisse je Agent prüfen und freigeben oder mit Feedback überarbeiten lassen.",
    "2. Freigegebene Präsentation in Slides öffnen und anpassen.",
    "3. Code nur nach Prüfung im Prüfmodus testen.",
  ];
  return { markdown: lines.filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n"), source: "rules" };
}

// ---------- Öffentliche API ----------

export function startTeamRun(input: { task: string; context?: string | null; agents?: AgentId[] | null; adsCsv?: string | null; hoursCsv?: string | null; mode?: "single" | "team"; workspaceId?: string | null }): TeamRun {
  const mode = input.mode ?? "team";
  if (mode === "single" && (input.agents?.length ?? 0) !== 1) throw new Error("Im Einzelmodus genau einen Agenten wählen.");
  prune();
  if (activeRunCount() >= MAX_ACTIVE_RUNS) {
    throw new Error(`Es laufen bereits ${MAX_ACTIVE_RUNS} Team-Aufträge. Bitte warten, bis einer fertig ist.`);
  }

  let context = input.context?.trim() || null;
  // Werkzeug für den Marketing-Agenten: deterministisches Ads-Audit, wenn ein Suchbegriff-Bericht dabei ist
  if (input.adsCsv) {
    const report = runAudit(readSearchTerms(input.adsCsv), input.hoursCsv ? readHours(input.hoursCsv) : []);
    const facts = {
      quelle: "Ads-Audit (berechnet, nicht geschätzt)",
      kostenGesamt: report.totals.cost,
      ohneConversion: report.wastedCost,
      cpa: report.totals.cpa,
      roas: report.totals.roas,
      ausschlussWoerter: report.negativeTokens.slice(0, 8).map((t) => `${t.token} (${t.cost} €)`),
      auffaelligeStunden: report.hourAnomalies.map((h) => `${h.hour} Uhr`),
      besteSuchbegriffe: report.topConverting.slice(0, 6),
    };
    context = `${context ? `${context}\n\n` : ""}Ads-Audit-Fakten: ${JSON.stringify(facts)}`;
  }

  const run: TeamRun = {
    id: randomUUID(),
    mode,
    workspaceId: input.workspaceId ?? null,
    task: input.task.trim(),
    context,
    status: "planning",
    createdAt: now(),
    plan: null,
    agents: [],
    final: null,
    error: null,
  };
  runs.set(run.id, run);
  void executeTeamRun(run, input.agents ?? null);
  return run;
}

async function executeTeamRun(run: TeamRun, selected: AgentId[] | null): Promise<void> {
  try {
    const single = run.mode === "single" && selected?.[0];
    const plan = single
      ? { summary: `Direkter Auftrag an ${AGENTS[single].name}.`, source: "rules" as const, tasks: [{ agent: single, brief: run.task }] }
      : await planTeam(run.task, run.context, selected);
    run.plan = { summary: plan.summary, source: plan.source };
    run.agents = plan.tasks.map(({ agent, brief }) => ({
      agent,
      name: AGENTS[agent].name,
      brief,
      phase: AGENTS[agent].phase,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      model: null,
      source: null,
      output: null,
      error: null,
      revisions: 0,
    }));
    run.status = "running";

    // Phase 1: parallel
    await Promise.allSettled(run.agents.filter((a) => a.phase === 1).map((a) => runAgent(run, a)));
    // Phase 2: baut auf Phase 1 auf
    for (const a of run.agents.filter((x) => x.phase === 2)) await runAgent(run, a);

    if (run.mode === "team") {
      run.status = "merging";
      run.final = await mergeResults(run);
    }
    run.status = "done";
  } catch (err) {
    logger.error({ err: (err as Error).message, runId: run.id }, "agent-team: run failed");
    run.status = "failed";
    run.error = (err as Error).message;
    for (const a of run.agents) if (a.status === "queued" || a.status === "running") { a.status = "failed"; a.error = "Abgebrochen"; }
  }
}

/** Ein einzelnes Ergebnis mit Feedback des Menschen überarbeiten lassen. */
export function reviseAgent(runId: string, agent: AgentId, feedback: string): TeamRun {
  const run = runs.get(runId);
  if (!run) throw new Error("Team-Auftrag nicht gefunden");
  const state = run.agents.find((a) => a.agent === agent);
  if (!state) throw new Error("Agent ist in diesem Auftrag nicht eingesetzt");
  if (state.status === "running" || state.status === "queued") throw new Error("Agent arbeitet noch");
  if (run.status !== "done") throw new Error("Bitte warten, bis das Team fertig ist");
  state.revisions += 1;
  run.status = "running";
  void (async () => {
    try {
      await runAgent(run, state, feedback.trim().slice(0, 2000));
      if (run.mode === "team") {
        run.status = "merging";
        run.final = await mergeResults(run);
      }
      run.status = "done";
    } catch (err) {
      run.status = "done";
      state.status = "failed";
      state.error = (err as Error).message;
    }
  })();
  return run;
}
