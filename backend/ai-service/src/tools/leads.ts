import { registerTool } from "./registry.js";
import { INDUSTRIES, REGIONS } from "../leads/sample-leads.js";
import { searchLeads } from "../routes/leads.js";

/**
 * leads.find — finds and scores B2B leads (PROTOTYPE, fictional sample data).
 * Scoring is deterministic; drafts are created in the "Leads" app with human approval.
 */
registerTool("leads.find", async (input) => {
  const prompt = String(input["prompt"] ?? input["query"] ?? "").toLowerCase();
  const industry =
    (typeof input["industry"] === "string" && input["industry"]) ||
    INDUSTRIES.find((i) => prompt.includes(i.toLowerCase().slice(0, 6))) ||
    (prompt.includes("zahn") ? "Zahnarztpraxis" : prompt.includes("elektr") ? "Elektrobetrieb" : prompt.includes("physio") ? "Physiotherapie" : undefined);
  const region =
    (typeof input["region"] === "string" && input["region"]) ||
    REGIONS.find((r) => prompt.includes(r.toLowerCase())) ||
    undefined;

  const leads = searchLeads({ industry, region }).slice(0, 8);
  if (!leads.length) {
    return { text: "Keine passenden Leads in den Beispieldaten gefunden. Probier eine andere Branche oder Region (Stuttgart, München, Hamburg)." };
  }
  const rows = leads
    .map((l, i) => `${i + 1}. **${l.company}** – ${l.city} · Score **${l.score}** (${l.tier})  \n   ${l.reasons.slice(0, 2).join(" · ")}  \n   Ansatz: ${l.opportunities[0] ?? "–"}`)
    .join("\n");
  const text =
    `### Leads${industry ? ` · ${industry}` : ""}${region ? ` · Region ${region}` : ""}\n\n${rows}\n\n` +
    `*Prototyp mit fiktiven Beispieldaten – Scoring regelbasiert im Code. Mail-Entwürfe und Freigabe in der App „Leads“ (Marketing Tools).*`;
  return { text, leads };
});
