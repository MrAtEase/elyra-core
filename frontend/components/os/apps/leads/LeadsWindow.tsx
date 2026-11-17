"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Mail, RefreshCw, ShieldCheck, Sparkles, Star, Target, X } from "lucide-react";
import {
  fetchLeadDraft,
  fetchLeads,
  type LeadDraft,
  type LeadItem,
  type LeadSearchResponse,
} from "@/components/os/kernel/aiClient";

/**
 * Marketing Tools › Leads — B2B lead finder (prototype, fictional sample data).
 * Scoring is deterministic in the AI service; Gemini only drafts the first email.
 * Nothing is sent automatically: every draft needs explicit approval (human in the loop).
 */

type Stage = "neu" | "entwurf" | "freigegeben" | "angeschrieben" | "antwort" | "kein_interesse";

const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "neu", label: "Neu", color: "#94a3b8" },
  { id: "entwurf", label: "Entwurf", color: "#0ea5e9" },
  { id: "freigegeben", label: "Freigegeben", color: "#7B61FF" },
  { id: "angeschrieben", label: "Angeschrieben", color: "#f59e0b" },
  { id: "antwort", label: "Antwort", color: "#16a34a" },
  { id: "kein_interesse", label: "Kein Interesse", color: "#dc2626" },
];

const TIER_COLOR: Record<string, string> = { A: "#16a34a", B: "#f59e0b", C: "#94a3b8" };
const STORE_KEY = "elyra:leads:pipeline:v1";

type Pipeline = Record<string, { stage: Stage; draft?: LeadDraft }>;

function loadPipeline(): Pipeline {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Pipeline;
  } catch {
    return {};
  }
}
function savePipeline(p: Pipeline) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tabular-nums text-[color:var(--text-primary)]">{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{sub}</p> : null}
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-muted)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border bg-transparent px-2 py-1.5 text-[12px] text-[color:var(--text-primary)]"
        style={{ borderColor: "var(--os-border-soft)" }}
      >
        <option value="alle">Alle</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export default function LeadsWindow() {
  const [industry, setIndustry] = useState("alle");
  const [region, setRegion] = useState("alle");
  const [data, setData] = useState<LeadSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline>({});
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setPipeline(loadPipeline()), []);

  const updatePipeline = useCallback((id: string, patch: Partial<Pipeline[string]>) => {
    setPipeline((prev) => {
      const next = { ...prev, [id]: { stage: prev[id]?.stage ?? "neu", ...prev[id], ...patch } };
      savePipeline(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLeads({ industry, region });
      setData(res);
      setSelectedId((cur) => (cur && res.leads.some((l) => l.id === cur) ? cur : res.leads[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message || "Leads konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [industry, region]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected: LeadItem | undefined = useMemo(() => data?.leads.find((l) => l.id === selectedId), [data, selectedId]);
  const entry = selected ? pipeline[selected.id] : undefined;
  const stage: Stage = entry?.stage ?? "neu";

  const stageCounts = useMemo(() => {
    const counts: Record<Stage, number> = { neu: 0, entwurf: 0, freigegeben: 0, angeschrieben: 0, antwort: 0, kein_interesse: 0 };
    for (const l of data?.leads ?? []) counts[pipeline[l.id]?.stage ?? "neu"] += 1;
    return counts;
  }, [data, pipeline]);

  const createDraft = useCallback(async () => {
    if (!selected) return;
    setDrafting(true);
    try {
      const draft = await fetchLeadDraft({ leadId: selected.id });
      updatePipeline(selected.id, { stage: "entwurf", draft });
    } catch (e) {
      setError((e as Error).message || "Entwurf fehlgeschlagen.");
    } finally {
      setDrafting(false);
    }
  }, [selected, updatePipeline]);

  const editDraft = (field: "subject" | "body", value: string) => {
    if (!selected || !entry?.draft) return;
    updatePipeline(selected.id, { draft: { ...entry.draft, [field]: value }, stage: entry.stage === "freigegeben" ? "entwurf" : entry.stage });
  };

  const copyDraft = async () => {
    if (!entry?.draft) return;
    try {
      await navigator.clipboard.writeText(`Betreff: ${entry.draft.subject}\n\n${entry.draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const avgScore = data?.leads.length ? Math.round(data.leads.reduce((s, l) => s + l.score, 0) / data.leads.length) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-base, transparent)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <div className="flex items-center gap-2">
          <Target size={18} className="text-[color:var(--text-primary)]" />
          <h1 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Leads</h1>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide" style={{ background: "color-mix(in srgb, #f59e0b 18%, transparent)", color: "#b45309" }}>
            BEISPIELDATEN · FIKTIV
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Select label="Branche" value={industry} onChange={setIndustry} options={data?.industries ?? []} />
          <Select label="Region" value={region} onChange={setRegion} options={data?.regions ?? []} />
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Suchen
          </button>
        </div>
      </div>

      {error ? <div className="mx-5 mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: "color-mix(in srgb, #dc2626 12%, transparent)", color: "#dc2626" }}>{error}</div> : null}

      <div className="flex-1 overflow-auto p-5">
        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Gefundene Leads" value={String(data?.summary.total ?? 0)} sub="nach Filter" />
          <Tile label="A-Leads" value={String(data?.summary.tierA ?? 0)} sub="Score ≥ 65 – zuerst ansprechen" />
          <Tile label="Ø Score" value={String(avgScore)} sub="Bedarf an Online-Marketing" />
          <Tile label="In Ansprache" value={String(stageCounts.entwurf + stageCounts.freigegeben + stageCounts.angeschrieben)} sub={`${stageCounts.antwort} Antworten`} />
        </div>

        {/* Pipeline strip */}
        <div className="mt-4 flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label} <b className="tabular-nums">{stageCounts[s.id]}</b>
            </span>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Lead list */}
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
            {(data?.leads ?? []).map((l) => {
              const st = STAGES.find((s) => s.id === (pipeline[l.id]?.stage ?? "neu"))!;
              const active = l.id === selectedId;
              return (
                <button
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0"
                  style={{ borderColor: "var(--os-border-soft)", background: active ? "color-mix(in srgb, #7B61FF 10%, transparent)" : undefined }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white" style={{ background: TIER_COLOR[l.tier] }}>
                    {l.score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{l.company}</span>
                    <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                      {l.industry} · {l.city} · {l.reasons[0] ?? ""}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>
                    {st.label}
                  </span>
                </button>
              );
            })}
            {data && data.leads.length === 0 ? <p className="p-6 text-center text-[12px] text-[color:var(--text-muted)]">Keine Leads für diesen Filter.</p> : null}
          </div>

          {/* Detail */}
          <div className="space-y-4">
            {selected ? (
              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[color:var(--text-primary)]">{selected.company}</h2>
                    <p className="text-[12px] text-[color:var(--text-muted)]">
                      {selected.industry} · {selected.city} · {selected.employees} MA · Ansprechpartner: {selected.contactRole}
                    </p>
                  </div>
                  <span className="rounded-lg px-2 py-1 text-[12px] font-bold text-white" style={{ background: TIER_COLOR[selected.tier] }}>
                    {selected.tier} · {selected.score}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--text-muted)]">
                  <span className="inline-flex items-center gap-1"><Star size={12} /> {selected.googleRating?.toFixed(1) ?? "–"} ({selected.googleReviews})</span>
                  <span>Website: {selected.website ? `${selected.websiteMobile ? "mobil" : "nicht mobil"} · ${selected.websiteLastUpdate ?? "?"}` : "keine"}</span>
                  <span>Google Ads: {selected.runsGoogleAds ? "ja" : "nein"}</span>
                  <span>Social Ads: {selected.runsSocialAds ? "ja" : "nein"}</span>
                  <span>Online-Buchung: {selected.onlineBooking ? "ja" : "nein"}</span>
                </div>

                <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Warum dieser Score</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[color:var(--text-primary)]">
                  {selected.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                {selected.opportunities.length ? (
                  <>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Ansatzpunkte</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {selected.opportunities.map((o) => (
                        <span key={o} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "color-mix(in srgb, #7B61FF 14%, transparent)", color: "var(--text-primary)" }}>{o}</span>
                      ))}
                    </div>
                  </>
                ) : null}

                {/* Outreach */}
                <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--os-border-soft)" }}>
                  {!entry?.draft ? (
                    <button
                      onClick={() => void createDraft()}
                      disabled={drafting}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
                      style={{ background: "#7B61FF" }}
                    >
                      <Sparkles size={14} className={drafting ? "animate-pulse" : ""} />
                      {drafting ? "Elli schreibt…" : "Erstansprache entwerfen"}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                          Entwurf · {entry.draft.source === "model" ? `Gemini (${entry.draft.model ?? "KI"})` : "Vorlage (ohne KI)"}
                        </p>
                        <button onClick={() => void createDraft()} disabled={drafting} className="text-[11px] text-[color:var(--text-muted)] underline">
                          {drafting ? "…" : "neu schreiben"}
                        </button>
                      </div>
                      <input
                        value={entry.draft.subject}
                        onChange={(e) => editDraft("subject", e.target.value)}
                        className="w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[12px] font-semibold text-[color:var(--text-primary)]"
                        style={{ borderColor: "var(--os-border-soft)" }}
                      />
                      <textarea
                        value={entry.draft.body}
                        onChange={(e) => editDraft("body", e.target.value)}
                        rows={9}
                        className="w-full rounded-lg border bg-transparent px-2.5 py-2 text-[12px] leading-relaxed text-[color:var(--text-primary)]"
                        style={{ borderColor: "var(--os-border-soft)" }}
                      />
                      <div className="flex flex-wrap gap-2">
                        {stage !== "freigegeben" && stage !== "angeschrieben" && stage !== "antwort" ? (
                          <button onClick={() => updatePipeline(selected.id, { stage: "freigegeben" })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "#16a34a" }}>
                            <ShieldCheck size={13} /> Freigeben
                          </button>
                        ) : null}
                        <button onClick={() => void copyDraft()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Kopiert" : "Kopieren"}
                        </button>
                        {stage === "freigegeben" ? (
                          <button onClick={() => updatePipeline(selected.id, { stage: "angeschrieben" })} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                            <Mail size={13} /> Als gesendet markieren
                          </button>
                        ) : null}
                        {stage === "angeschrieben" ? (
                          <>
                            <button onClick={() => updatePipeline(selected.id, { stage: "antwort" })} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                              <Check size={13} /> Antwort erhalten
                            </button>
                            <button onClick={() => updatePipeline(selected.id, { stage: "kein_interesse" })} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                              <X size={13} /> Kein Interesse
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Sending setup */}
            <div className="rounded-2xl border p-4 text-[12px]" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
              <p className="flex items-center gap-1.5 font-semibold text-[color:var(--text-primary)]"><ShieldCheck size={14} /> Versand-Setup</p>
              <p className="mt-1 text-[color:var(--text-muted)]">
                Status: <b className="text-[color:var(--text-primary)]">nicht eingerichtet</b> – Elli versendet nichts automatisch.
                Für echten Versand: eigene Zweitdomain (nicht die Hauptdomain), SPF/DKIM/DMARC, 2–3 Wochen Warm-up,
                danach max. ~30 Mails pro Tag und Postfach, Abmeldelink und Rechtsgrundlage (B2B, berechtigtes Interesse) prüfen.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-[color:var(--text-muted)]">
          Prototyp: Firmen und Signale sind fiktiv. Der Score wird regelbasiert im Code berechnet (Bewertungen, Werbung, Website, Größe);
          Gemini schreibt nur die Mail-Entwürfe. Später: echte Daten über Google Places und Website-Check.
        </p>
      </div>
    </div>
  );
}
