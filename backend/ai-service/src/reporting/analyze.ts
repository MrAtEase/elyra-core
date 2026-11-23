/**
 * Pure, deterministic KPI analysis for the reporting prototype.
 * All numbers come from code — the LLM only writes recommendations on top of them.
 */
import type { CampaignRow } from "./sample-campaigns.js";

export type CampaignKpis = {
  channel: string;
  campaign: string;
  type: CampaignRow["type"];
  spend: number;
  revenue: number;
  conversions: number;
  ctr: number;      // %
  cvr: number;      // %
  cpc: number;      // EUR
  cpa: number;      // EUR
  roas: number;
  prevRoas: number;
  roasChangePct: number; // vs previous month
  spendChangePct: number;
  budgetLimited: boolean;
  flags: string[];
};

export type ChannelKpis = {
  channel: string;
  spend: number;
  revenue: number;
  conversions: number;
  roas: number;
  cpa: number;
  shareOfSpendPct: number;
};

export type BudgetShift = {
  from: string;
  to: string;
  amount: number;
  estimatedRevenueDelta: number; // rough, assumes ROAS stays constant at the margin
};

export type AnalysisResult = {
  totals: { spend: number; revenue: number; conversions: number; roas: number; cpa: number;
            prevSpend: number; prevRevenue: number; prevRoas: number; roasChangePct: number };
  channels: ChannelKpis[];
  campaigns: CampaignKpis[];
  budgetShift: BudgetShift | null;
};

const round = (value: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const de = (n: number, d = 1) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (a: number, b: number) => (b === 0 ? 0 : round(((a - b) / b) * 100, 1));
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function analyzeCampaigns(rows: CampaignRow[], targetRoas: number): AnalysisResult {
  const campaigns: CampaignKpis[] = rows.map((row) => {
    const roas = safeDiv(row.revenue, row.spend);
    const prevRoas = safeDiv(row.prev.revenue, row.prev.spend);
    const ctr = safeDiv(row.clicks, row.impressions) * 100;
    const cvr = safeDiv(row.conversions, row.clicks) * 100;
    const roasChangePct = pct(roas, prevRoas);
    const flags: string[] = [];

    const isAwareness = row.type === "awareness";
    if (isAwareness) flags.push("Awareness-Kampagne: ROAS nur bedingt aussagekräftig, eher Reichweite/assistierte Conversions bewerten");
    else if (roas < targetRoas * 0.7) flags.push(`ROAS deutlich unter Ziel (${de(targetRoas)})`);
    else if (roas < targetRoas) flags.push(`ROAS knapp unter Ziel (${de(targetRoas)})`);
    if (roasChangePct <= -15) flags.push(`ROAS-Abwärtstrend (${de(roasChangePct)} % ggü. Vormonat)`);
    if (roas >= targetRoas * 1.5 && row.budgetLimited) flags.push("profitabel und budgetlimitiert → Skalierungskandidat");
    if (row.type !== "brand" && ctr < 0.8) flags.push(`niedrige CTR (${de(ctr, 2)} %) → Creative-Müdigkeit/Targeting prüfen`);
    if (ctr >= 1.4 && cvr < 1) flags.push(`viele Klicks, wenig Käufe (CVR ${de(cvr, 2)} %) → Landingpage/Angebot prüfen`);

    return {
      channel: row.channel,
      campaign: row.campaign,
      type: row.type,
      spend: row.spend,
      revenue: row.revenue,
      conversions: row.conversions,
      ctr: round(ctr, 2),
      cvr: round(cvr, 2),
      cpc: round(safeDiv(row.spend, row.clicks)),
      cpa: round(safeDiv(row.spend, row.conversions)),
      roas: round(roas),
      prevRoas: round(prevRoas),
      roasChangePct,
      spendChangePct: pct(row.spend, row.prev.spend),
      budgetLimited: Boolean(row.budgetLimited),
      flags,
    };
  });

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
  const prevSpend = rows.reduce((s, r) => s + r.prev.spend, 0);
  const prevRevenue = rows.reduce((s, r) => s + r.prev.revenue, 0);

  const channelNames = [...new Set(rows.map((r) => r.channel))];
  const channels: ChannelKpis[] = channelNames
    .map((channel) => {
      const subset = rows.filter((r) => r.channel === channel);
      const spend = subset.reduce((s, r) => s + r.spend, 0);
      const revenue = subset.reduce((s, r) => s + r.revenue, 0);
      const conversions = subset.reduce((s, r) => s + r.conversions, 0);
      return {
        channel,
        spend,
        revenue,
        conversions,
        roas: round(safeDiv(revenue, spend)),
        cpa: round(safeDiv(spend, conversions)),
        shareOfSpendPct: round(safeDiv(spend, totalSpend) * 100, 1),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // Budget shift: 20 % from the weakest non-brand campaign below target to the best
  // budget-limited campaign. Rough estimate — assumes marginal ROAS equals average ROAS,
  // which is optimistic for the receiving campaign.
  const donors = campaigns.filter((c) => c.type !== "brand" && c.type !== "awareness" && c.roas < targetRoas).sort((a, b) => a.roas - b.roas);
  const receivers = campaigns.filter((c) => c.budgetLimited && c.roas >= targetRoas * 1.5).sort((a, b) => b.roas - a.roas);
  let budgetShift: BudgetShift | null = null;
  const donor = donors[0];
  const receiver = receivers[0];
  if (donor && receiver) {
    const amount = Math.round((donor.spend * 0.2) / 100) * 100;
    budgetShift = {
      from: `${donor.channel} – ${donor.campaign}`,
      to: `${receiver.channel} – ${receiver.campaign}`,
      amount,
      estimatedRevenueDelta: Math.round(amount * (receiver.roas - donor.roas)),
    };
  }

  const totalRoas = safeDiv(totalRevenue, totalSpend);
  const prevTotalRoas = safeDiv(prevRevenue, prevSpend);
  return {
    totals: {
      spend: totalSpend,
      revenue: totalRevenue,
      conversions: totalConversions,
      roas: round(totalRoas),
      cpa: round(safeDiv(totalSpend, totalConversions)),
      prevSpend,
      prevRevenue,
      prevRoas: round(prevTotalRoas),
      roasChangePct: pct(totalRoas, prevTotalRoas),
    },
    channels,
    campaigns,
    budgetShift,
  };
}

const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const num = (n: number, d = 2) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number) => `${n > 0 ? "+" : ""}${num(n, 1)} %`;

/** Deterministic Markdown overview (exact numbers, no LLM involved). */
export function formatOverview(
  result: AnalysisResult,
  meta: { client: string; period: string; previousPeriod: string; targetRoas: number },
): string {
  const t = result.totals;
  const lines: string[] = [];
  lines.push(`## Performance-Report ${meta.period}`);
  lines.push(`*${meta.client} · Beispieldaten · Ziel-ROAS ${num(meta.targetRoas, 1)}*`);
  lines.push("");
  lines.push(`**Gesamt:** ${eur(t.spend)} Spend · ${eur(t.revenue)} Umsatz · ${t.conversions} Käufe · ROAS ${num(t.roas)} (${signed(t.roasChangePct)} ggü. ${meta.previousPeriod}) · CPA ${eur(t.cpa)}`);
  lines.push("");
  lines.push("### Kanäle");
  for (const c of result.channels) {
    lines.push(`- **${c.channel}:** ${eur(c.spend)} (${num(c.shareOfSpendPct, 1)} % des Budgets) · ROAS ${num(c.roas)} · CPA ${eur(c.cpa)}`);
  }
  const flagged = result.campaigns.filter((c) => c.flags.length > 0);
  if (flagged.length > 0) {
    lines.push("");
    lines.push("### Auffälligkeiten");
    for (const c of flagged) {
      lines.push(`- **${c.channel} – ${c.campaign}** (ROAS ${num(c.roas)}, CPA ${eur(c.cpa)}): ${c.flags.join("; ")}`);
    }
  }
  return lines.join("\n");
}

/** Rule-based fallback recommendations, used when the model is unavailable. */
export function fallbackRecommendations(result: AnalysisResult): string {
  const items: string[] = [];
  if (result.budgetShift) {
    const s = result.budgetShift;
    items.push(`**Budget umschichten:** ${eur(s.amount)} von „${s.from}“ zu „${s.to}“ (grobe Schätzung: ${eur(s.estimatedRevenueDelta)} Mehrumsatz, falls der ROAS stabil bleibt).`);
  }
  const declining = result.campaigns.filter((c) => c.roasChangePct <= -15);
  if (declining.length) items.push(`**Abwärtstrends analysieren:** ${declining.map((c) => c.campaign).join(", ")}.`);
  const lowCtr = result.campaigns.filter((c) => c.flags.some((f) => f.includes("CTR")));
  if (lowCtr.length) items.push(`**Creatives erneuern:** ${lowCtr.map((c) => c.campaign).join(", ")}.`);
  return ["### Handlungsempfehlungen", ...items.map((item, i) => `${i + 1}. ${item}`)].join("\n");
}
