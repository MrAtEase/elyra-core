import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INDUSTRIES, REGIONS, SAMPLE_LEADS } from "../leads/sample-leads.js";
import { scoreLead } from "../leads/score.js";
import { draftOutreach, DEFAULT_SENDER } from "../leads/outreach.js";
import { ValidationError } from "../lib/errors.js";

const searchSchema = z.object({
  industry: z.string().max(60).optional(),
  region: z.string().max(60).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
});

const draftBody = z.object({
  leadId: z.string().max(10),
  sender: z
    .object({ name: z.string().max(80), company: z.string().max(80), offer: z.string().max(200) })
    .partial()
    .optional(),
});

export function searchLeads(params: { industry?: string; region?: string; minScore?: number }) {
  const industry = params.industry && params.industry !== "alle" ? params.industry : undefined;
  const region = params.region && params.region !== "alle" ? params.region : undefined;
  return SAMPLE_LEADS.filter((l) => (!industry || l.industry === industry) && (!region || l.region === region))
    .map((lead) => ({ ...lead, ...scoreLead(lead) }))
    .filter((l) => l.score >= (params.minScore ?? 0))
    .sort((a, b) => b.score - a.score);
}

/** Lead finder API (prototype with fictional sample data). */
export async function leadRoutes(app: FastifyInstance) {
  app.get("/v1/leads/search", async (request) => {
    const parsed = searchSchema.safeParse(request.query ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const leads = searchLeads(parsed.data);
    return {
      sampleData: true,
      industries: INDUSTRIES,
      regions: REGIONS,
      leads,
      summary: {
        total: leads.length,
        tierA: leads.filter((l) => l.tier === "A").length,
        tierB: leads.filter((l) => l.tier === "B").length,
        tierC: leads.filter((l) => l.tier === "C").length,
      },
    };
  });

  app.post("/v1/leads/draft", async (request) => {
    const parsed = draftBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const lead = SAMPLE_LEADS.find((l) => l.id === parsed.data.leadId);
    if (!lead) throw new ValidationError("Unknown leadId");
    const sender = { ...DEFAULT_SENDER, ...(parsed.data.sender ?? {}) };
    return { leadId: lead.id, ...(await draftOutreach(lead, scoreLead(lead), sender)) };
  });
}
