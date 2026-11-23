"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Presentation, RefreshCw, Sparkles } from "lucide-react";
import ChatMarkdown from "@/components/agent/ChatMarkdown";
import {
  fetchReportingAnalysis,
  fetchReportingRecommendations,
  type ReportingAnalysisResponse,
  type ReportingCampaign,
} from "@/components/os/kernel/aiClient";

/**
 * Marketing Tools › Reporting — cross-channel performance dashboard (prototype, sample data).
 * KPIs are computed in the AI service (deterministic code); Elly/Gemini only writes recommendations.
 */

const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
const dec = (n: number, d = 2) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const signedPct = (n: number) => `${n > 0 ? "+" : ""}${dec(n, 1)} %`;

const CHANNEL_COLORS: Record<string, string> = {
  "Google Ads": "#4285F4",
  Meta: "#7B61FF",
  TikTok: "#25C2B5",
  "Microsoft Ads": "#F2A33A",
};

type SortKey = "spend" | "roas" | "cpa" | "roasChangePct";

function Delta({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const good = inverse ? value < 0 : value > 0;
  const neutral = Math.abs(value) < 0.05;
  const color = neutral ? "var(--text-muted)" : good ? "#16a34a" : "#dc2626";
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color }}>
      {!neutral && <Icon size={12} />}
      {signedPct(value)}
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tabular-nums text-[color:var(--text-primary)]">{value}</p>
      {sub ? <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

/** Deterministic client-report deck built only from computed KPIs (fallback without AI). */
function buildKpiDeck(data: ReportingAnalysisResponse): { title: string; slides: unknown[] } {
  const { account, analysis } = data;
  const t = analysis.totals;
  const flagged = analysis.campaigns.filter((c) => c.flags.length > 0);
  const scale = flagged.filter((c) => c.flags.some((f) => f.includes("Skalierung")));
  const problems = flagged.filter((c) => !c.flags.some((f) => f.includes("Skalierung")));
  const shift = analysis.budgetShift;
  const slides: unknown[] = [
    { title: `Performance-Report ${account.period}`, body: `${account.client}`, layout: "title",
      notes: `Überblick über die Kanal-Performance im ${account.period} im Vergleich zum ${account.previousPeriod}.` },
    { title: "Performance-Überblick", layout: "stats",
      stats: [
        { value: eur(t.spend), label: "Spend" },
        { value: eur(t.revenue), label: "Umsatz" },
        { value: dec(t.roas), label: `ROAS (Ziel ${dec(account.targetRoas, 1)})` },
      ],
      body: `ROAS ${signedPct(t.roasChangePct)} ggü. ${account.previousPeriod} · CPA ${eur(t.cpa)} · ${t.conversions.toLocaleString("de-DE")} Käufe`,
      notes: "Gesamtzahlen des Monats." },
    { title: "Kanäle", layout: "bullets", body: "Budgetanteil und Effizienz je Kanal",
      bullets: analysis.channels.map((c) => `${c.channel}: ${eur(c.spend)} (${dec(c.shareOfSpendPct, 1)} %) · ROAS ${dec(c.roas)}`) },
  ];
  if (scale.length > 0 || problems.length > 0) {
    slides.push({
      title: "Auffälligkeiten", layout: "comparison",
      columns: [
        { heading: "Handlungsbedarf", points: problems.slice(0, 4).map((c) => `${c.campaign}: ROAS ${dec(c.roas)}`) },
        { heading: "Skalieren", points: scale.slice(0, 4).map((c) => `${c.campaign}: ROAS ${dec(c.roas)}`) },
      ],
    });
  }
  if (shift) {
    slides.push({
      title: "Budget-Empfehlung", layout: "stats",
      stats: [{ value: eur(shift.amount), label: `von ${shift.from} zu ${shift.to}` }],
      body: `Grobe Schätzung: +${eur(shift.estimatedRevenueDelta)} Umsatz, falls der ROAS stabil bleibt.`,
    });
  }
  slides.push({
    title: "Nächste Schritte", layout: "timeline",
    steps: [
      ...(shift ? [{ label: "Budget umschichten", detail: `${eur(shift.amount)} zu ${shift.to.split(" – ").pop()}` }] : []),
      { label: "Abwärtstrends prüfen", detail: "Kampagnen mit sinkendem ROAS analysieren" },
      { label: "Creatives erneuern", detail: "Kampagnen mit niedriger CTR" },
      { label: "Review", detail: "Ergebnisse im nächsten Report bewerten" },
    ],
  });
  return { title: `Kunden-Report ${account.period} – ${account.client}`, slides };
}

export default function ReportingWindow() {
  const [targetRoas, setTargetRoas] = useState(3);
  const [data, setData] = useState<ReportingAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [recs, setRecs] = useState<{ markdown: string; source: string; model?: string } | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const load = useCallback(async (roas: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchReportingAnalysis(roas));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(targetRoas);
    setRecs(null);
  }, [load, targetRoas]);

  const generateRecs = useCallback(async () => {
    setRecsLoading(true);
    setRecsError(null);
    try {
      setRecs(await fetchReportingRecommendations({ targetRoas }));
    } catch (err) {
      setRecsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecsLoading(false);
    }
  }, [targetRoas]);

  /** Build a client report deck from the computed KPIs and open it in Slides. */
  const createDeck = useCallback(async () => {
    if (!data) return;
    setDeckLoading(true);
    setDeckError(null);
    try {
      const { account, analysis } = data;
      const context = JSON.stringify({
        client: account.client,
        period: account.period,
        previousPeriod: account.previousPeriod,
        targetRoas: account.targetRoas,
        totals: analysis.totals,
        channels: analysis.channels,
        campaigns: analysis.campaigns.map((c) => ({
          channel: c.channel, campaign: c.campaign, spend: c.spend, revenue: c.revenue, roas: c.roas,
          cpa: c.cpa, roasChangePct: c.roasChangePct, flags: c.flags,
        })),
        budgetShift: analysis.budgetShift,
        recommendations: recs?.markdown ?? null,
      });
      // Demo-safe: wait at most 25 s for Gemini, then fall back to the KPI deck.
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25_000);
      const res = await fetch("/api/os/slides/generate", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `Kunden-Report ${account.period} für ${account.client}: Performance-Überblick, Kanäle, Auffälligkeiten, Budget-Empfehlung, nächste Schritte`,
          slideCount: 8,
          style: "professional",
          provider: "gemini",
          context,
          workspaceId: searchParams.get("workspaceId") ?? undefined,
        }),
      }).catch(() => null);
      window.clearTimeout(timer);
      const payload = (res ? await res.json().catch(() => ({ ok: false })) : { ok: false }) as {
        ok: boolean;
        source?: string;
        deck?: { title: string; slides: unknown[] };
        providerLabel?: string;
        error?: string;
      };
      // If Gemini was unavailable, the generic template is useless for a client report —
      // build a deterministic deck straight from the computed KPIs instead.
      const useAi = payload.ok && payload.deck && payload.source === "ai";
      const deck = useAi
        ? { title: payload.deck!.title, slides: payload.deck!.slides, providerLabel: payload.providerLabel ?? "Gemini" }
        : { ...buildKpiDeck(data), providerLabel: "Aus Report-Daten (ohne KI)" };
      window.sessionStorage.setItem(
        "elyra:pending-deck",
        JSON.stringify({
          id: `report-${Date.now()}`,
          title: deck.title,
          slides: deck.slides,
          source: "generated",
          theme: "executive",
          providerLabel: deck.providerLabel,
        }),
      );
      const ws = searchParams.get("workspaceId");
      router.push(`/os/slides${ws ? `?workspaceId=${encodeURIComponent(ws)}` : ""}`);
    } catch (err) {
      setDeckError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeckLoading(false);
    }
  }, [data, recs, router, searchParams]);

  const campaigns = useMemo<ReportingCampaign[]>(() => {
    const list = [...(data?.analysis.campaigns ?? [])];
    return list.sort((a, b) => (sortKey === "cpa" ? a.cpa - b.cpa : sortKey === "roasChangePct" ? a.roasChangePct - b.roasChangePct : b[sortKey] - a[sortKey]));
  }, [data, sortKey]);

  if (loading && !data) {
    return <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">Lade Kampagnendaten…</div>;
  }
  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle size={20} className="text-amber-500" />
        <p className="text-sm text-[color:var(--text-primary)]">Reporting-Daten konnten nicht geladen werden.</p>
        <p className="max-w-md text-[12px] text-[color:var(--text-muted)]">{error} – läuft der KI-Dienst (npm run dev:all, Port 8788)?</p>
        <button type="button" onClick={() => void load(targetRoas)} className="rounded-full border px-4 py-1.5 text-[12px]" style={{ borderColor: "var(--os-border-soft)" }}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (!data) return null;

  const { account, analysis } = data;
  const t = analysis.totals;
  const maxChannelSpend = Math.max(...analysis.channels.map((c) => c.spend), 1);

  return (
    <div className="h-full overflow-y-auto p-5 md:p-6" style={{ background: "var(--bg-base, transparent)" }}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-[color:var(--text-primary)]">Cross-Channel-Performance {account.period}</h1>
          <p className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
            {account.client} · Vergleich mit {account.previousPeriod}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {account.isSampleData ? (
            <span className="rounded-full border border-amber-300/50 bg-amber-100/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-900">
              Beispieldaten
            </span>
          ) : null}
          <label className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] text-[color:var(--text-secondary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            Ziel-ROAS
            <select
              value={targetRoas}
              onChange={(e) => setTargetRoas(Number(e.target.value))}
              className="bg-transparent font-semibold text-[color:var(--text-primary)] outline-none"
            >
              {[2, 2.5, 3, 3.5, 4, 5].map((v) => (
                <option key={v} value={v}>{dec(v, 1)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void createDeck()}
            disabled={deckLoading}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-60"
            style={{ background: "var(--os-accent)" }}
            title="Erstellt aus diesem Report eine Präsentation in Slides"
          >
            <Presentation size={13} className={deckLoading ? "animate-pulse" : ""} />
            {deckLoading ? "Erstelle Präsentation…" : "Als Präsentation"}
          </button>
          <button
            type="button"
            onClick={() => void load(targetRoas)}
            className="grid h-7 w-7 place-items-center rounded-full border text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            style={{ borderColor: "var(--os-border-soft)" }}
            title="Neu laden"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {deckError ? <p className="mb-3 text-[12px] text-red-600">{deckError}</p> : null}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Spend" value={eur(t.spend)} sub={<>Vormonat {eur(t.prevSpend)}</>} />
        <Tile label="Umsatz" value={eur(t.revenue)} sub={<>Vormonat {eur(t.prevRevenue)}</>} />
        <Tile
          label="ROAS"
          value={dec(t.roas)}
          sub={<><Delta value={t.roasChangePct} /> · Ziel {dec(account.targetRoas, 1)}</>}
        />
        <Tile label="CPA" value={eur(t.cpa)} sub={<>{t.conversions.toLocaleString("de-DE")} Käufe</>} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        {/* Channels */}
        <section className="rounded-2xl border p-4 lg:col-span-3" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
          <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">
            <BarChart3 size={14} /> Kanäle
          </h2>
          <div className="space-y-3">
            {analysis.channels.map((c) => {
              const color = CHANNEL_COLORS[c.channel] ?? "var(--os-accent)";
              const belowTarget = c.roas < account.targetRoas;
              return (
                <div key={c.channel}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="font-medium text-[color:var(--text-primary)]">{c.channel}</span>
                    <span className="tabular-nums text-[color:var(--text-muted)]">
                      {eur(c.spend)} · {dec(c.shareOfSpendPct, 1)} % ·{" "}
                      <span className="font-semibold" style={{ color: belowTarget ? "#dc2626" : "#16a34a" }}>ROAS {dec(c.roas)}</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--os-border-faint)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(c.spend / maxChannelSpend) * 100}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Budget shift */}
        <section className="rounded-2xl border p-4 lg:col-span-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">Budget-Vorschlag</h2>
          {analysis.budgetShift ? (
            <div className="space-y-2 text-[12px] text-[color:var(--text-primary)]">
              <p className="text-[22px] font-semibold tabular-nums">{eur(analysis.budgetShift.amount)}</p>
              <p className="text-[color:var(--text-muted)]">umschichten von</p>
              <p className="font-medium">{analysis.budgetShift.from}</p>
              <ArrowRight size={14} className="text-[color:var(--text-muted)]" />
              <p className="font-medium">{analysis.budgetShift.to}</p>
              <p className="pt-1 text-[11px] text-[color:var(--text-muted)]">
                Grobe Schätzung: <span className="font-semibold text-[#16a34a]">+{eur(analysis.budgetShift.estimatedRevenueDelta)}</span> Umsatz,
                falls der ROAS stabil bleibt.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-[color:var(--text-muted)]">Keine Umschichtung nötig bei diesem Ziel-ROAS.</p>
          )}
        </section>
      </div>

      {/* Campaigns */}
      <section className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">Kampagnen</h2>
          <div className="flex gap-1 text-[11px]">
            {([["spend", "Spend"], ["roas", "ROAS"], ["cpa", "CPA"], ["roasChangePct", "Trend"]] as Array<[SortKey, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className="rounded-full px-2.5 py-0.5"
                style={{
                  background: sortKey === key ? "var(--os-accent)" : "transparent",
                  color: sortKey === key ? "white" : "var(--text-muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                <th className="pb-2 font-semibold">Kampagne</th>
                <th className="pb-2 text-right font-semibold">Spend</th>
                <th className="pb-2 text-right font-semibold">CTR</th>
                <th className="pb-2 text-right font-semibold">CVR</th>
                <th className="pb-2 text-right font-semibold">CPA</th>
                <th className="pb-2 text-right font-semibold">ROAS</th>
                <th className="pb-2 text-right font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={`${c.channel}-${c.campaign}`} className="border-t align-top" style={{ borderColor: "var(--os-border-faint)" }}>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CHANNEL_COLORS[c.channel] ?? "var(--os-accent)" }} />
                      <span className="font-medium text-[color:var(--text-primary)]">{c.campaign}</span>
                    </div>
                    <p className="ml-4 text-[10px] text-[color:var(--text-muted)]">{c.channel}{c.budgetLimited ? " · budgetlimitiert" : ""}</p>
                    {c.flags.length > 0 ? (
                      <div className="ml-4 mt-1 flex flex-wrap gap-1">
                        {c.flags.map((flag) => {
                          const positive = flag.includes("Skalierung");
                          return (
                            <span
                              key={flag}
                              className="rounded-md px-1.5 py-0.5 text-[10px]"
                              style={{
                                background: positive ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.08)",
                                color: positive ? "#15803d" : "#b91c1c",
                              }}
                            >
                              {flag}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 text-right tabular-nums">{eur(c.spend)}</td>
                  <td className="py-2 text-right tabular-nums">{dec(c.ctr)} %</td>
                  <td className="py-2 text-right tabular-nums">{dec(c.cvr)} %</td>
                  <td className="py-2 text-right tabular-nums">{eur(c.cpa)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums" style={{ color: c.roas < account.targetRoas ? "#dc2626" : "#16a34a" }}>
                    {dec(c.roas)}
                  </td>
                  <td className="py-2 text-right"><Delta value={c.roasChangePct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recommendations */}
      <section className="mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">
            <Sparkles size={14} /> Empfehlungen von Elly
          </h2>
          <button
            type="button"
            onClick={() => void generateRecs()}
            disabled={recsLoading}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
            style={{ background: "var(--os-accent)" }}
          >
            <Sparkles size={13} className={recsLoading ? "animate-pulse" : ""} />
            {recsLoading ? "Elly analysiert…" : recs ? "Neu generieren" : "Empfehlungen generieren"}
          </button>
        </div>
        {recsError ? <p className="text-[12px] text-red-600">{recsError}</p> : null}
        {recs ? (
          <div className="text-[12px] leading-relaxed text-[color:var(--text-primary)]">
            <ChatMarkdown text={recs.markdown} />
            <p className="mt-3 text-[10px] text-[color:var(--text-muted)]">
              {recs.source === "model" ? `Erstellt von Gemini (${recs.model ?? "Modell"})` : "Regelbasiert erstellt (Modell nicht erreichbar)"} ·
              Kennzahlen im Code berechnet, das Modell erfindet keine Zahlen.
            </p>
          </div>
        ) : !recsLoading ? (
          <p className="text-[12px] text-[color:var(--text-muted)]">
            Elly bewertet die Kennzahlen und schlägt drei konkrete Maßnahmen für das Account-Management vor.
          </p>
        ) : null}
      </section>
    </div>
  );
}
