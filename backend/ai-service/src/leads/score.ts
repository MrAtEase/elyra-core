import type { SampleLead } from "./sample-leads.js";

export type LeadScore = {
  score: number; // 0–100, potential for online-marketing services
  tier: "A" | "B" | "C";
  reasons: string[];
  opportunities: string[];
};

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Deterministic lead scoring: "How likely does this company need (and can afford)
 * online-marketing help?" No model involved – every point is explainable.
 */
export function scoreLead(lead: SampleLead): LeadScore {
  let score = 0;
  const reasons: string[] = [];
  const opportunities: string[] = [];

  // Demand signal: customers like them, but they don't advertise
  if ((lead.googleRating ?? 0) >= 4.5 && lead.googleReviews >= 50) {
    score += 25;
    reasons.push(`Starke Reputation (${lead.googleRating?.toFixed(1)} ★, ${lead.googleReviews} Bewertungen)`);
  } else if ((lead.googleRating ?? 0) >= 4.2) {
    score += 12;
    reasons.push(`Gute Bewertungen (${lead.googleRating?.toFixed(1)} ★)`);
  }

  if (!lead.runsGoogleAds) {
    score += 20;
    reasons.push("Keine Google-Suchwerbung aktiv");
    opportunities.push("Google Ads / lokale Suchkampagne");
  }
  if (!lead.runsSocialAds) {
    score += 8;
    opportunities.push("Social-Ads für Reichweite / Recruiting");
  }

  if (!lead.website) {
    score += 10;
    reasons.push("Keine Website");
    opportunities.push("Website / Landingpage");
  } else {
    if (!lead.websiteMobile) {
      score += 12;
      reasons.push("Website nicht mobiloptimiert");
      opportunities.push("Mobile Landingpage");
    }
    if (lead.websiteLastUpdate && CURRENT_YEAR - lead.websiteLastUpdate >= 5) {
      score += 8;
      reasons.push(`Website seit ${lead.websiteLastUpdate} kaum aktualisiert`);
    }
  }

  if (!lead.onlineBooking && ["Zahnarztpraxis", "Physiotherapie", "Fitnessstudio", "Autohaus"].includes(lead.industry)) {
    score += 10;
    reasons.push("Keine Online-Terminbuchung");
    opportunities.push("Online-Terminbuchung / Lead-Formular");
  }

  // Ability to pay
  if (lead.employees >= 10) {
    score += 12;
    reasons.push(`${lead.employees} Mitarbeitende – Budget wahrscheinlich`);
  } else if (lead.employees >= 5) {
    score += 6;
  } else {
    reasons.push("Sehr kleiner Betrieb – Budget fraglich");
  }

  // Already well digitised → lower need
  if (lead.runsGoogleAds && lead.runsSocialAds) {
    score -= 15;
    reasons.push("Bereits in Search und Social aktiv – eher Wechselkunde");
  }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 65 ? "A" : score >= 40 ? "B" : "C";
  return { score, tier, reasons, opportunities };
}
