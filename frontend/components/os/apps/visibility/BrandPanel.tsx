"use client";

/** Marken-Wahrnehmung: Was ChatGPT, Gemini und Claude über die Marke sagen – abgeglichen mit der Website. */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Loader2, ScanFace, XCircle } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type ProviderId = "gemini" | "openai" | "anthropic";
type Fact = { claim: string; providers: ProviderId[]; verdict: "richtig" | "falsch" | "unbelegt"; correction: string | null };
type BrandSummary = {
  type: "brand"; total: number; answered: number; knows: Record<string, boolean>; sentiment: Record<string, string>;
  accuracy: number | null; facts: Fact[]; topics: string[]; missing: string[]; summary: string; site_checked: boolean;
};
export type BrandRunLite = { id: string; project_id: string; created_at: string; summary: BrandSummary };
type BrandRun = BrandRunLite & { results: Array<{ prompt: string; provider: ProviderId; model: string; ok: boolean; error?: string; answer: string }> };

const ACCENT = "#7c3aed";
const card = "rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const LABEL: Record<string, string> = { gemini: "Gemini", openai: "ChatGPT", anthropic: "Claude" };
const SENT_COLOR: Record<string, string> = { positiv: "#047857", neutral: "#64748b", negativ: "#b91c1c", unbekannt: "#94a3b8" };

async function call<T>(body?: Record<string, unknown>, query = ""): Promise<T> {
  const res = await fetch(`/api/os/visibility${query}`, {
    method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
    headers: await withSupabaseAuthorization(body ? { "Content-Type": "application/json" } : undefined),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

export function BrandPanel({ ws, projectId, projectName, hasDomain, runs, onChanged }: {
  ws: string; projectId: string; projectName: string; hasDomain: boolean; runs: BrandRunLite[]; onChanged: () => Promise<unknown>;
}) {
  const latest = runs[runs.length - 1] ?? null;
  const [run, setRun] = useState<BrandRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setRun(null);
    if (!latest) return;
    void call<{ run: BrandRun }>(undefined, `?workspaceId=${encodeURIComponent(ws)}&runId=${latest.id}`).then((d) => setRun(d.run)).catch(() => undefined);
  }, [latest?.id, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    setBusy(true); setError(null);
    try {
      const d = await call<{ run: BrandRun }>({ workspaceId: ws, action: "brand", id: projectId });
      setRun(d.run);
      await onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const s = run?.summary ?? null;
  const wrong = s?.facts.filter((f) => f.verdict === "falsch") ?? [];
  const right = s?.facts.filter((f) => f.verdict === "richtig") ?? [];
  const unproven = s?.facts.filter((f) => f.verdict === "unbelegt") ?? [];

  return (
    <div className="mt-5">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold">Was wissen die KIs über {projectName}?</p>
          <p className="text-[12px] text-[color:var(--text-muted)]">Elyra fragt jeden Assistenten nach Firma, Leistungen, Standort, Stärken/Schwächen und Themen – ohne Websuche, also aus dem „Gedächtnis“ des Modells – und prüft jede Aussage gegen die Website.{!hasDomain ? " Tipp: Website im Projekt eintragen, sonst kann nichts verifiziert werden." : ""}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void check()} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60" style={{ background: ACCENT }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ScanFace size={13} />} {busy ? "Prüfe Marke …" : latest ? "Erneut prüfen" : "Marke prüfen"}
        </button>
      </div>
      {error ? <p className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12.5px] text-rose-600">{error}</p> : null}

      {s && run ? (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className={card}>
              <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Faktentreue</p>
              <p className="mt-1 text-[30px] font-semibold tabular-nums" style={{ color: s.accuracy === null ? undefined : s.accuracy >= 0.8 ? "#047857" : s.accuracy >= 0.5 ? "#b45309" : "#b91c1c" }}>{s.accuracy === null ? "–" : `${Math.round(s.accuracy * 100)} %`}</p>
              <p className="text-[11.5px] text-[color:var(--text-muted)]">{right.length} richtig · {wrong.length} falsch · {unproven.length} unbelegt</p>
            </div>
            <div className={`${card} md:col-span-3`}>
              <p className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Je Assistent</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {Object.keys(s.knows).map((p) => (
                  <div key={p} className="rounded-xl bg-[color:var(--bg-elevated)] px-3 py-2">
                    <p className="text-[12.5px] font-semibold">{LABEL[p] ?? p}</p>
                    <p className="text-[11.5px]">{s.knows[p] ? <span className="text-emerald-600">kennt die Marke</span> : <span className="text-rose-600">kennt die Marke nicht</span>}</p>
                    <p className="text-[11.5px]">Tonalität: <span style={{ color: SENT_COLOR[s.sentiment[p] ?? "unbekannt"] }}>{s.sentiment[p] ?? "unbekannt"}</span></p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {s.summary ? <div className={`${card} mt-3 text-[12.5px] leading-relaxed text-[color:var(--text-secondary)]`}>{s.summary}</div> : null}

          {wrong.length ? (
            <div className={`${card} mt-3 border-rose-400/40`}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-rose-600"><AlertTriangle size={14} /> Falsche Aussagen über die Marke</p>
              {wrong.map((f, i) => (
                <div key={i} className="mb-2 text-[12.5px]">
                  <p>„{f.claim}“ <span className="text-[11px] text-[color:var(--text-muted)]">– {f.providers.map((p) => LABEL[p] ?? p).join(", ")}</span></p>
                  {f.correction ? <p className="text-[12px] text-emerald-700">Richtig laut Website: {f.correction}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={card}>
              <p className="mb-2 text-[13px] font-semibold">Aussagen der KIs</p>
              {[...right, ...unproven].map((f, i) => (
                <p key={i} className="mb-1 flex gap-1.5 text-[12px]">
                  {f.verdict === "richtig" ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" /> : <HelpCircle size={13} className="mt-0.5 shrink-0 text-slate-400" />}
                  <span>{f.claim} <span className="text-[10.5px] text-[color:var(--text-muted)]">({f.providers.map((p) => LABEL[p] ?? p).join(", ")})</span></span>
                </p>
              ))}
              {right.length + unproven.length === 0 ? <p className="text-[11.5px] text-[color:var(--text-muted)]">Keine weiteren Aussagen.</p> : null}
            </div>
            <div className={card}>
              <p className="mb-2 text-[13px] font-semibold">Wofür die Marke steht (laut KI)</p>
              <div className="flex flex-wrap gap-1.5">{s.topics.map((t) => <span key={t} className="rounded-full bg-[color:var(--bg-elevated)] px-2.5 py-0.5 text-[11.5px]">{t}</span>)}</div>
              {s.missing.length ? (
                <>
                  <p className="mb-1 mt-4 text-[13px] font-semibold">Fehlt in den KI-Antworten</p>
                  {s.missing.map((m) => <p key={m} className="flex gap-1.5 text-[12px]"><XCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />{m}</p>)}
                  <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">Diese Themen gezielt auf der Website, in Verzeichnissen, Pressemitteilungen und Fachartikeln verankern – das ist der Hebel, damit KIs sie künftig nennen.</p>
                </>
              ) : null}
            </div>
          </div>

          <div className={`${card} mt-3`}>
            <p className="mb-2 text-[13px] font-semibold">Antworten im Wortlaut</p>
            <div className="divide-y divide-[color:var(--os-border-soft)]">
              {run.results.map((r, i) => (
                <div key={i}>
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px]">
                    {open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="w-16 shrink-0 text-[11px] text-[color:var(--text-muted)]">{LABEL[r.provider]}</span>
                    <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
                  </button>
                  {open === i ? <p className="mb-3 ml-6 whitespace-pre-wrap rounded-lg bg-[color:var(--bg-elevated)] p-3 text-[12px] leading-relaxed text-[color:var(--text-secondary)]">{r.ok ? r.answer : r.error}</p> : null}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[10.5px] text-[color:var(--text-muted)]">Geprüft am {new Date(run.created_at).toLocaleString("de-DE")}{s.site_checked ? " · mit Website abgeglichen" : " · Website nicht abrufbar – Aussagen unbelegt"}. Bewertung durch Gemini; Stichproben selbst prüfen.</p>
        </>
      ) : !busy ? <p className="mt-3 text-[12.5px] text-[color:var(--text-muted)]">Noch keine Markenprüfung für dieses Unternehmen.</p> : null}
    </div>
  );
}
