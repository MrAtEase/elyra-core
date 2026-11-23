"use client";

/**
 * KI-Sichtbarkeit – wird ein Unternehmen von ChatGPT, Gemini und Claude empfohlen?
 * Projekt anlegen → Fragen (selbst oder vorgeschlagen) → messen → Bericht, Verlauf, Wettbewerber, GEO-Maßnahmen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Plus, Printer, Sparkles, Trash2, Wand2, XCircle } from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { Markdown } from "@/components/os/apps/toolbox/ToolboxWindow";
import { PrintVisibilityReport } from "@/components/os/apps/visibility/VisibilityReport";
import { BrandPanel, type BrandRunLite } from "@/components/os/apps/visibility/BrandPanel";

type ProviderId = "gemini" | "openai" | "anthropic";
type Provider = { id: ProviderId; label: string; configured: boolean; model: string };
type Project = {
  id: string; name: string; domain: string | null; aliases: string[]; competitors: string[]; location: string | null; industry: string | null;
  prompts: string[]; providers: ProviderId[]; web_search: boolean;
};
type Summary = {
  total: number; answered: number; mentioned: number; rate: number; avg_position: number | null;
  by_provider: Record<string, { answered: number; mentioned: number; rate: number }>;
  competitors: Array<{ name: string; mentions: number; rate: number }>;
  others: Array<{ name: string; mentions: number }>;
};
type RunLite = { id: string; project_id: string; created_at: string; summary: Summary };
type Result = {
  prompt: string; provider: ProviderId; model: string; ok: boolean; error?: string; answer: string; mentioned: boolean; position: number | null;
  brands: Array<{ name: string; rank: number }>; competitors_mentioned: string[]; sources: string[]; searched: boolean;
};
type Run = RunLite & { results: Result[]; recommendations: string | null };

const ACCENT = "#7c3aed";
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const input = "w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";
const label = "mb-1 block text-[11.5px] font-medium text-[color:var(--text-secondary)]";
const PROVIDER_LABEL: Record<ProviderId, string> = { gemini: "Gemini", openai: "ChatGPT", anthropic: "Claude" };

const pct = (x: number) => `${Math.round(x * 100)} %`;
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

async function api<T>(body?: Record<string, unknown>, query = ""): Promise<T> {
  const res = await fetch(`/api/os/visibility${query}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    cache: "no-store",
    headers: await withSupabaseAuthorization(body ? { "Content-Type": "application/json" } : undefined),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

function emptyDraft(): Record<string, string | boolean | ProviderId[]> {
  return { name: "", domain: "", aliases: "", competitors: "", location: "", industry: "", prompts: "", providers: ["gemini"], web_search: true };
}

function TrendChart({ runs }: { runs: RunLite[] }) {
  if (runs.length < 2) return <p className="text-[11.5px] text-[color:var(--text-muted)]">Der Verlauf erscheint ab der zweiten Messung.</p>;
  const W = 520, H = 120, P = 24;
  const xs = (i: number) => P + (i * (W - 2 * P)) / (runs.length - 1);
  const ys = (r: number) => H - P - r * (H - 2 * P);
  const pts = runs.map((r, i) => `${xs(i)},${ys(r.summary.rate)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Verlauf der Erwähnungsrate">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={P} x2={W - P} y1={ys(g)} y2={ys(g)} stroke="currentColor" strokeOpacity={0.12} />
          <text x={2} y={ys(g) + 3} fontSize={9} fill="currentColor" opacity={0.5}>{g * 100}%</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinejoin="round" />
      {runs.map((r, i) => (
        <g key={r.id}>
          <circle cx={xs(i)} cy={ys(r.summary.rate)} r={3.5} fill={ACCENT} />
          <text x={xs(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.55}>
            {new Date(r.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function VisibilityWindow() {
  const { activeWorkspace } = useKernel();
  const ws = activeWorkspace.id;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<RunLite[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [brandRuns, setBrandRuns] = useState<BrandRunLite[]>([]);
  const [tab, setTab] = useState<"mentions" | "brand">("mentions");

  const load = useCallback(async () => {
    try {
      const data = await api<{ providers: Provider[]; projects: Project[]; runs: RunLite[]; brand_runs?: BrandRunLite[]; setup_error?: string }>(undefined, `?workspaceId=${encodeURIComponent(ws)}`);
      setProviders(data.providers);
      setProjects(data.projects);
      setRuns(data.runs);
      setBrandRuns(data.brand_runs ?? []);
      setSetupError(data.setup_error ?? null);
      return data;
    } catch (err) {
      setSetupError((err as Error).message);
      return null;
    }
  }, [ws]);

  useEffect(() => {
    void load().then((d) => {
      if (d && d.projects.length && !selectedId) setSelectedId(d.projects[0]!.id);
      if (d && d.projects.length === 0) setEditing(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const project = useMemo(() => projects.find((p) => p.id === selectedId) ?? null, [projects, selectedId]);
  const projectRuns = useMemo(() => runs.filter((r) => r.project_id === selectedId), [runs, selectedId]);
  const latest = projectRuns[projectRuns.length - 1] ?? null;
  const previous = projectRuns.length > 1 ? projectRuns[projectRuns.length - 2]! : null;

  // load full latest run of the selected project
  useEffect(() => {
    setRun(null);
    if (!latest) return;
    void api<{ run: Run }>(undefined, `?workspaceId=${encodeURIComponent(ws)}&runId=${latest.id}`).then((d) => setRun(d.run)).catch(() => undefined);
  }, [latest?.id, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(p: Project | null) {
    setError(null);
    setDraft(p ? {
      name: p.name, domain: p.domain ?? "", aliases: p.aliases.join("\n"), competitors: p.competitors.join("\n"), location: p.location ?? "",
      industry: p.industry ?? "", prompts: p.prompts.join("\n"), providers: p.providers, web_search: p.web_search,
    } : emptyDraft());
    setEditing(true);
    if (!p) setSelectedId(null);
  }

  const draftPayload = () => ({
    name: draft.name, domain: draft.domain, location: draft.location, industry: draft.industry,
    aliases: lines(String(draft.aliases)), competitors: lines(String(draft.competitors)), prompts: lines(String(draft.prompts)),
    providers: draft.providers, web_search: draft.web_search,
  });

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  const save = () => act("save", async () => {
    const d = await api<{ project: Project }>({ workspaceId: ws, action: "save", id: selectedId, project: draftPayload() });
    await load();
    setSelectedId(d.project.id);
    setEditing(false);
  });

  const suggest = () => act("suggest", async () => {
    const d = await api<{ prompts: string[] }>({ workspaceId: ws, action: "suggest", project: draftPayload() });
    const existing = lines(String(draft.prompts));
    setDraft({ ...draft, prompts: [...new Set([...existing, ...d.prompts])].join("\n") });
  });

  const measure = () => act("run", async () => {
    if (!project) return;
    const d = await api<{ run: Run }>({ workspaceId: ws, action: "run", id: project.id });
    setRun(d.run);
    await load();
  });

  const advise = () => act("rec", async () => {
    if (!run) return;
    const d = await api<{ recommendations: string }>({ workspaceId: ws, action: "recommend", runId: run.id });
    setRun({ ...run, recommendations: d.recommendations });
  });

  const remove = () => act("del", async () => {
    if (!project || !window.confirm(`„${project.name}“ und alle Messungen löschen?`)) return;
    await api({ workspaceId: ws, action: "delete", id: project.id });
    setSelectedId(null);
    const d = await load();
    if (d?.projects.length) setSelectedId(d.projects[0]!.id); else startEdit(null);
  });

  const configured = providers.filter((p) => p.configured);
  const s = run?.summary ?? null;
  const delta = s && previous ? Math.round((s.rate - previous.summary.rate) * 100) : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] bg-[color:var(--bg-canvas)] text-[color:var(--text-primary)]">
      {/* Projects */}
      <aside className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-[color:var(--os-border-soft)] p-3 print:hidden">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Unternehmen</span>
          <button type="button" onClick={() => startEdit(null)} className="rounded-md p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)]" title="Neues Unternehmen"><Plus size={14} /></button>
        </div>
        {projects.map((p) => {
          const last = [...runs].reverse().find((r) => r.project_id === p.id);
          return (
            <button key={p.id} type="button" onClick={() => { setSelectedId(p.id); setEditing(false); }}
              className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${p.id === selectedId && !editing ? "bg-[color:var(--bg-surface-hover)]" : "hover:bg-[color:var(--bg-surface)]"}`}>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="block truncate text-[11px] text-[color:var(--text-muted)]">{[p.industry, p.location].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              {last ? <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: ACCENT }}>{pct(last.summary.rate)}</span> : null}
            </button>
          );
        })}
        {projects.length === 0 && !setupError ? <p className="px-2 text-[11.5px] text-[color:var(--text-muted)]">Noch kein Unternehmen.</p> : null}
      </aside>

      {printing && run && project ? (
        <PrintVisibilityReport project={project} run={run} history={projectRuns} onDone={() => setPrinting(false)} />
      ) : null}
      <section className="min-h-0 overflow-y-auto p-6">
        {setupError ? <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-700">{setupError}</p> : null}
        {error ? <p className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12.5px] text-rose-600">{error}</p> : null}

        {editing ? (
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[18px] font-semibold">{selectedId ? "Unternehmen bearbeiten" : "Neues Unternehmen prüfen"}</h2>
            <p className="mt-1 text-[12.5px] text-[color:var(--text-muted)]">Elyra stellt KI-Assistenten typische Kundenfragen und prüft, ob dieses Unternehmen empfohlen wird – und wer stattdessen.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label><span className={label}>Name des Unternehmens *</span><input className={input} value={String(draft.name)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Elektro Müller GmbH" /></label>
              <label><span className={label}>Website</span><input className={input} value={String(draft.domain)} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} placeholder="elektro-mueller.de" /></label>
              <label><span className={label}>Branche / Leistung</span><input className={input} value={String(draft.industry)} onChange={(e) => setDraft({ ...draft, industry: e.target.value })} placeholder="z. B. Elektriker, Photovoltaik" /></label>
              <label><span className={label}>Ort / Region</span><input className={input} value={String(draft.location)} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="z. B. Stuttgart" /></label>
              <label><span className={label}>Andere Schreibweisen (eine pro Zeile)</span><textarea rows={3} className={input} value={String(draft.aliases)} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} placeholder={"Elektro Müller\nMüller Elektrotechnik"} /></label>
              <label><span className={label}>Wettbewerber (eine pro Zeile)</span><textarea rows={3} className={input} value={String(draft.competitors)} onChange={(e) => setDraft({ ...draft, competitors: e.target.value })} placeholder={"Elektro Schmidt\nVolt & Co."} /></label>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between">
                <span className={label}>Kundenfragen an die KI (eine pro Zeile)</span>
                <button type="button" className={btn} disabled={busy === "suggest" || !String(draft.industry || draft.name)} onClick={() => void suggest()}>
                  {busy === "suggest" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Fragen vorschlagen
                </button>
              </div>
              <textarea rows={8} className={`${input} font-mono text-[12px]`} value={String(draft.prompts)} onChange={(e) => setDraft({ ...draft, prompts: e.target.value })} placeholder={"Welcher Elektriker in Stuttgart ist empfehlenswert?\nWer installiert Wallboxen in Stuttgart?"} />
              <p className="mt-1 text-[10.5px] text-[color:var(--text-muted)]">Tipp: Fragen so stellen, wie echte Kunden fragen – ohne den Firmennamen. 8–12 Fragen ergeben ein gutes Bild.</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <span className={label}>KI-Assistenten:</span>
              {providers.map((p) => {
                const list = draft.providers as ProviderId[];
                const on = list.includes(p.id);
                return (
                  <label key={p.id} className={`flex items-center gap-1.5 text-[12.5px] ${p.configured ? "" : "opacity-50"}`} title={p.configured ? p.model : "Kein API-Schlüssel in .env.local"}>
                    <input type="checkbox" disabled={!p.configured} checked={on && p.configured} onChange={() => setDraft({ ...draft, providers: on ? list.filter((x) => x !== p.id) : [...list, p.id] })} />
                    {p.label}{!p.configured ? " (kein Schlüssel)" : ""}
                  </label>
                );
              })}
              <label className="flex items-center gap-1.5 text-[12.5px]">
                <input type="checkbox" checked={Boolean(draft.web_search)} onChange={(e) => setDraft({ ...draft, web_search: e.target.checked })} /> mit Websuche (wie in der App)
              </label>
            </div>

            <div className="mt-6 flex gap-2">
              <button type="button" onClick={() => void save()} disabled={busy === "save"} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : null} Speichern
              </button>
              {projects.length ? <button type="button" className={btn} onClick={() => setEditing(false)}>Abbrechen</button> : null}
            </div>
          </div>
        ) : project ? (
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-semibold">{project.name}</h2>
                <p className="text-[12.5px] text-[color:var(--text-muted)]">{[project.industry, project.location, project.domain].filter(Boolean).join(" · ")} · {project.prompts.length} Fragen · {project.providers.map((p) => PROVIDER_LABEL[p]).join(", ")}</p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button type="button" onClick={() => void measure()} disabled={busy === "run" || configured.length === 0} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
                  {busy === "run" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {busy === "run" ? "Frage KIs …" : "Jetzt messen"}
                </button>
                <button type="button" className={btn} onClick={() => startEdit(project)}>Bearbeiten</button>
                {run ? <button type="button" className={btn} onClick={() => setPrinting(true)} title="Bericht als PDF (Drucken → Als PDF sichern)"><Printer size={12} /> Bericht (PDF)</button> : null}
                <button type="button" className={`${btn} text-rose-600`} onClick={() => void remove()}><Trash2 size={12} /></button>
              </div>
            </div>

            <div className="mt-4 flex gap-1 border-b border-[color:var(--os-border-soft)] print:hidden">
              {([["mentions", "Empfehlungen & Wettbewerb"], ["brand", "Marken-Wahrnehmung"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-[12.5px] ${tab === k ? "font-semibold" : "border-transparent text-[color:var(--text-muted)]"}`} style={tab === k ? { borderColor: ACCENT, color: ACCENT } : undefined}>{l}</button>
              ))}
            </div>

            {tab === "brand" ? (
              <BrandPanel ws={ws} projectId={project.id} projectName={project.name} hasDomain={Boolean(project.domain)} runs={brandRuns.filter((r) => r.project_id === project.id)} onChanged={load} />
            ) : (<>
            {busy === "run" ? (
              <div className={`${card} mt-5 flex items-center gap-3 text-[13px] text-[color:var(--text-secondary)]`}>
                <Loader2 size={16} className="animate-spin" /> Stelle {project.prompts.length * project.providers.filter((p) => configured.some((c) => c.id === p)).length} Fragen an die KI-Assistenten und werte die Antworten aus … (ca. 1 Minute)
              </div>
            ) : null}

            {!run && busy !== "run" ? (
              <div className={`${card} mt-5 text-center`}>
                <p className="text-[13px] text-[color:var(--text-secondary)]">Noch keine Messung. Klick auf <b>Jetzt messen</b>.</p>
              </div>
            ) : null}

            {run && s ? (
              <>
                {/* KPIs */}
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className={`${card} md:col-span-2`}>
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Erwähnt in KI-Antworten</p>
                    <p className="mt-1 text-[34px] font-semibold leading-none tabular-nums" style={{ color: ACCENT }}>{s.mentioned} <span className="text-[18px] text-[color:var(--text-muted)]">von {s.answered}</span></p>
                    <p className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">
                      {pct(s.rate)} Sichtbarkeit{delta !== null ? <span className={delta >= 0 ? "text-emerald-600" : "text-rose-600"}> · {delta >= 0 ? "+" : ""}{delta} Punkte seit letzter Messung</span> : null}
                    </p>
                  </div>
                  <div className={card}>
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Ø Position</p>
                    <p className="mt-1 text-[28px] font-semibold tabular-nums">{s.avg_position ?? "–"}</p>
                    <p className="text-[11.5px] text-[color:var(--text-muted)]">wenn genannt (1 = zuerst)</p>
                  </div>
                  <div className={card}>
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Je Assistent</p>
                    <div className="mt-2 space-y-1.5">
                      {Object.entries(s.by_provider).map(([k, v]) => (
                        <div key={k}>
                          <div className="flex justify-between text-[11.5px]"><span>{PROVIDER_LABEL[k as ProviderId] ?? k}</span><span className="tabular-nums">{v.mentioned}/{v.answered}</span></div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-[color:var(--bg-surface-hover)]"><div className="h-1.5 rounded-full" style={{ width: pct(v.rate), background: ACCENT }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Competitors & others */}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className={card}>
                    <p className="mb-2 text-[13px] font-semibold">Du im Vergleich</p>
                    {[{ name: project.name, mentions: s.mentioned, you: true }, ...s.competitors.map((c) => ({ ...c, you: false }))]
                      .sort((a, b) => b.mentions - a.mentions)
                      .map((c) => (
                        <div key={c.name} className="mb-1.5">
                          <div className="flex justify-between text-[12px]"><span className={c.you ? "font-semibold" : ""}>{c.name}{c.you ? " (du)" : ""}</span><span className="tabular-nums">{c.mentions}×</span></div>
                          <div className="mt-0.5 h-2 rounded-full bg-[color:var(--bg-surface-hover)]"><div className="h-2 rounded-full" style={{ width: s.answered ? `${(c.mentions / s.answered) * 100}%` : "0%", background: c.you ? ACCENT : "color-mix(in srgb, var(--text-muted) 55%, transparent)" }} /></div>
                        </div>
                      ))}
                    {s.competitors.length === 0 ? <p className="text-[11.5px] text-[color:var(--text-muted)]">Trag Wettbewerber ein, um sie zu vergleichen.</p> : null}
                  </div>
                  <div className={card}>
                    <p className="mb-2 text-[13px] font-semibold">Wer stattdessen empfohlen wird</p>
                    {s.others.length === 0 ? <p className="text-[11.5px] text-[color:var(--text-muted)]">Keine weiteren Firmen genannt.</p> : (
                      <ol className="space-y-1 text-[12.5px]">
                        {s.others.slice(0, 10).map((o, i) => (
                          <li key={o.name} className="flex justify-between gap-2"><span className="truncate"><span className="mr-2 text-[color:var(--text-muted)]">{i + 1}.</span>{o.name}</span><span className="tabular-nums text-[color:var(--text-muted)]">{o.mentions}×</span></li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>

                <div className={`${card} mt-3`}>
                  <p className="mb-2 text-[13px] font-semibold">Verlauf</p>
                  <TrendChart runs={projectRuns} />
                </div>

                {/* Per question */}
                <div className={`${card} mt-3`}>
                  <p className="mb-2 text-[13px] font-semibold">Antworten im Detail</p>
                  <div className="divide-y divide-[color:var(--os-border-soft)]">
                    {run.results.map((r, i) => (
                      <div key={i}>
                        <button type="button" onClick={() => setOpenRow(openRow === i ? null : i)} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px]">
                          {openRow === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {!r.ok ? <XCircle size={14} className="shrink-0 text-amber-500" /> : r.mentioned ? <CheckCircle2 size={14} className="shrink-0 text-emerald-500" /> : <XCircle size={14} className="shrink-0 text-rose-500" />}
                          <span className="w-16 shrink-0 text-[11px] text-[color:var(--text-muted)]">{PROVIDER_LABEL[r.provider]}</span>
                          <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
                          <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">{r.ok ? (r.mentioned ? (r.position ? `Platz ${r.position}` : "genannt") : r.brands.slice(0, 2).map((b) => b.name).join(", ") || "keine Firma") : "Fehler"}</span>
                        </button>
                        {openRow === i ? (
                          <div className="mb-3 ml-6 rounded-lg bg-[color:var(--bg-elevated)] p-3 text-[12px]">
                            {r.ok ? (
                              <>
                                <p className="whitespace-pre-wrap leading-relaxed text-[color:var(--text-secondary)]">{r.answer}</p>
                                <p className="mt-2 text-[10.5px] text-[color:var(--text-muted)]">{r.model}{r.searched ? " · mit Websuche" : " · ohne Websuche"}{r.sources.length ? ` · Quellen: ${r.sources.slice(0, 5).join(", ")}` : ""}</p>
                              </>
                            ) : <p className="text-rose-600">{r.error}</p>}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {/* GEO recommendations */}
                <div className={`${card} mt-3`}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[13px] font-semibold">Maßnahmen für mehr KI-Sichtbarkeit (GEO)</p>
                    <button type="button" className={`${btn} print:hidden`} disabled={busy === "rec"} onClick={() => void advise()}>
                      {busy === "rec" ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} {run.recommendations ? "Neu erstellen" : "Maßnahmen ableiten"}
                    </button>
                  </div>
                  {run.recommendations ? <Markdown text={run.recommendations} /> : <p className="text-[12px] text-[color:var(--text-muted)]">Elyra analysiert Ergebnis, Wettbewerber und Website und erstellt einen konkreten Maßnahmenplan.</p>}
                </div>
                <p className="mt-3 text-[10.5px] text-[color:var(--text-muted)]">Gemessen am {new Date(run.created_at).toLocaleString("de-DE")}. KI-Antworten schwanken – aussagekräftig ist der Verlauf über mehrere Messungen.</p>
              </>
            ) : null}
            </>)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
