import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SAMPLE_ACCOUNT, SAMPLE_CAMPAIGNS } from "../reporting/sample-campaigns.js";
import { analyzeCampaigns } from "../reporting/analyze.js";
import { generateRecommendations } from "../reporting/recommend.js";
import { ValidationError } from "../lib/errors.js";

const targetSchema = z.coerce.number().min(0.5).max(20).optional();
const recommendBody = z.object({
  targetRoas: z.number().min(0.5).max(20).optional(),
  focus: z.string().max(500).optional(),
});

/** Reporting app API (prototype with sample data). */
export async function reportingRoutes(app: FastifyInstance) {
  app.get("/v1/reporting/analysis", async (request) => {
    const query = request.query as Record<string, unknown>;
    const parsed = targetSchema.safeParse(query["targetRoas"]);
    if (!parsed.success) throw new ValidationError("targetRoas must be between 0.5 and 20");
    const targetRoas = parsed.data ?? SAMPLE_ACCOUNT.targetRoas;
    return {
      account: { ...SAMPLE_ACCOUNT, targetRoas },
      analysis: analyzeCampaigns(SAMPLE_CAMPAIGNS, targetRoas),
    };
  });

  app.post("/v1/reporting/recommendations", async (request) => {
    const parsed = recommendBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const targetRoas = parsed.data.targetRoas ?? SAMPLE_ACCOUNT.targetRoas;
    const analysis = analyzeCampaigns(SAMPLE_CAMPAIGNS, targetRoas);
    return generateRecommendations(analysis, targetRoas, parsed.data.focus ?? "");
  });
}
