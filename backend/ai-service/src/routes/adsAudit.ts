import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  readSearchTerms,
  readHours,
  runAudit,
  renderMarkdown,
  exportApprovedForAdsEditor,
  type Proposal,
} from "../ads-audit/analyze.js";
import { summarizeAudit } from "../ads-audit/summarize.js";
import { DEMO_ACCOUNT, DEMO_HOURS_CSV, DEMO_SEARCH_TERMS_CSV } from "../ads-audit/demo-data.js";
import { ValidationError } from "../lib/errors.js";

const MAX_CSV = 5_000_000; // ~5 MB je Datei

const analyzeBody = z.object({
  searchTermsCsv: z.string().min(1).max(MAX_CSV),
  hoursCsv: z.string().max(MAX_CSV).optional(),
  account: z.string().max(120).optional(),
  protectedTokens: z.array(z.string().max(60)).max(100).optional(),
});

const summaryBody = analyzeBody;

const exportBody = z.object({
  proposals: z
    .array(
      z.object({
        id: z.string().max(20),
        type: z.enum(["negative_keyword_phrase", "negative_keyword_exact", "review_term", "review_hours"]),
        status: z.enum(["pending", "approved", "rejected"]),
        payload: z.record(z.union([z.string(), z.number(), z.array(z.string())])),
        rationale: z.string().max(2000),
        affectedCost: z.number(),
      }),
    )
    .max(5000),
});

function analyze(input: z.infer<typeof analyzeBody>) {
  try {
    const terms = readSearchTerms(input.searchTermsCsv);
    if (terms.length === 0) throw new Error("Die Datei enthält keine Suchbegriffe.");
    const hours = input.hoursCsv ? readHours(input.hoursCsv) : [];
    return { terms: terms.length, hours, report: runAudit(terms, hours, { protectedTokens: input.protectedTokens ?? [] }) };
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
}

/** Ads-Audit-App: Suchbegriff-Analyse mit Vorschlägen, die erst nach menschlicher Freigabe exportiert werden. */
export async function adsAuditRoutes(app: FastifyInstance) {
  app.get("/v1/ads-audit/demo", async () => ({
    account: DEMO_ACCOUNT,
    searchTermsCsv: DEMO_SEARCH_TERMS_CSV,
    hoursCsv: DEMO_HOURS_CSV,
    isSampleData: true,
  }));

  app.post("/v1/ads-audit/analyze", async (request) => {
    const parsed = analyzeBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const { terms, hours, report } = analyze(parsed.data);
    const account = parsed.data.account ?? "Google-Ads-Konto";
    return { account, termCount: terms, hours, report, markdown: renderMarkdown(report, account) };
  });

  app.post("/v1/ads-audit/summary", async (request) => {
    const parsed = summaryBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const { report } = analyze(parsed.data);
    return summarizeAudit(report, parsed.data.account ?? "Google-Ads-Konto");
  });

  app.post("/v1/ads-audit/export", async (request) => {
    const parsed = exportBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    const proposals = parsed.data.proposals as Proposal[];
    const approved = proposals.filter((p) => p.status === "approved").length;
    return { csv: exportApprovedForAdsEditor(proposals), approved };
  });
}
