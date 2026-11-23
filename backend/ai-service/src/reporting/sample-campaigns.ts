/**
 * DEMO DATA — fictional performance-marketing account for the Elyra reporting prototype.
 * Client: "Nordwind Outdoor" (fictional e-commerce shop). Period: October 2026 vs. September 2026.
 * The numbers are invented but internally consistent, and deliberately contain typical
 * patterns an account manager should spot (scaling candidates, creative fatigue,
 * weak landing pages, declining PMax performance).
 */

export type CampaignRow = {
  channel: "Google Ads" | "Meta" | "TikTok" | "Microsoft Ads";
  campaign: string;
  type: "brand" | "non-brand" | "shopping" | "pmax" | "prospecting" | "retargeting" | "awareness";
  spend: number;        // EUR
  impressions: number;
  clicks: number;
  conversions: number;  // purchases
  revenue: number;      // EUR
  prev: { spend: number; conversions: number; revenue: number }; // previous month
  budgetLimited?: boolean; // campaign hit its daily budget cap on most days
};

export const SAMPLE_ACCOUNT = {
  client: "Nordwind Outdoor (Beispielkunde, fiktiv)",
  period: "Oktober 2026",
  previousPeriod: "September 2026",
  currency: "EUR",
  targetRoas: 3.0,
  isSampleData: true,
} as const;

export const SAMPLE_CAMPAIGNS: CampaignRow[] = [
  { channel: "Google Ads", campaign: "Search – Brand", type: "brand",
    spend: 2400, impressions: 48000, clicks: 6200, conversions: 520, revenue: 29900,
    prev: { spend: 2300, conversions: 505, revenue: 28800 } },
  { channel: "Google Ads", campaign: "Search – Generic (Wanderschuhe, Zelte)", type: "non-brand",
    spend: 9800, impressions: 410000, clicks: 11500, conversions: 210, revenue: 18400,
    prev: { spend: 9200, conversions: 235, revenue: 20900 } },
  { channel: "Google Ads", campaign: "Shopping – Bestseller", type: "shopping",
    spend: 7200, impressions: 690000, clicks: 14800, conversions: 455, revenue: 39600,
    prev: { spend: 7100, conversions: 440, revenue: 38100 }, budgetLimited: true },
  { channel: "Google Ads", campaign: "Performance Max – Gesamtsortiment", type: "pmax",
    spend: 11500, impressions: 1250000, clicks: 16900, conversions: 395, revenue: 35700,
    prev: { spend: 10800, conversions: 470, revenue: 45400 } },
  { channel: "Meta", campaign: "Prospecting – Lookalike 3 %", type: "prospecting",
    spend: 8600, impressions: 1480000, clicks: 9600, conversions: 140, revenue: 12100,
    prev: { spend: 8200, conversions: 175, revenue: 15800 } },
  { channel: "Meta", campaign: "Retargeting – Warenkorbabbrecher", type: "retargeting",
    spend: 3100, impressions: 260000, clicks: 5900, conversions: 255, revenue: 21900,
    prev: { spend: 3000, conversions: 240, revenue: 20600 } },
  { channel: "Meta", campaign: "Advantage+ Shopping", type: "prospecting",
    spend: 6400, impressions: 980000, clicks: 13200, conversions: 300, revenue: 25800,
    prev: { spend: 5600, conversions: 240, revenue: 19900 }, budgetLimited: true },
  { channel: "TikTok", campaign: "Spark Ads – Creator Herbstkollektion", type: "awareness",
    spend: 4200, impressions: 2100000, clicks: 31500, conversions: 55, revenue: 4600,
    prev: { spend: 3500, conversions: 50, revenue: 4300 } },
  { channel: "Microsoft Ads", campaign: "Search – Brand & Generic", type: "non-brand",
    spend: 1300, impressions: 52000, clicks: 1900, conversions: 68, revenue: 6200,
    prev: { spend: 1250, conversions: 64, revenue: 5800 }, budgetLimited: true },
];
