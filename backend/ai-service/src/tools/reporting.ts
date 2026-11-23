import { registerTool } from "./registry.js";
import { SAMPLE_ACCOUNT, SAMPLE_CAMPAIGNS } from "../reporting/sample-campaigns.js";
import { analyzeCampaigns, formatOverview } from "../reporting/analyze.js";
import { generateRecommendations } from "../reporting/recommend.js";

/**
 * reporting.analyze — cross-channel performance report (PROTOTYPE, sample data).
 * 1) KPIs, trends and flags are computed deterministically in code.
 * 2) The model writes strategic recommendations based only on those numbers.
 */
registerTool("reporting.analyze", async (input) => {
  const targetRoas =
    typeof input["targetRoas"] === "number" && input["targetRoas"] > 0 ? input["targetRoas"] : SAMPLE_ACCOUNT.targetRoas;
  const focus = typeof input["focus"] === "string" ? input["focus"].slice(0, 500) : "";

  const result = analyzeCampaigns(SAMPLE_CAMPAIGNS, targetRoas);
  const overview = formatOverview(result, { ...SAMPLE_ACCOUNT, targetRoas });
  const { markdown } = await generateRecommendations(result, targetRoas, focus);

  const text = `${overview}\n\n${markdown}\n\n*Prototyp mit Beispieldaten – Kennzahlen im Code berechnet, Empfehlungen von Gemini. Details in der App „Reporting“.*`;
  return { text, analysis: result };
});
