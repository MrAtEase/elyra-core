import { z } from "zod";

const citationSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().min(1),
  published_at: z.string().datetime().nullable().optional(),
});

const baseToolMetaSchema = z.object({
  rate_limit_per_minute: z.number().int().positive(),
  cache_ttl_seconds: z.number().int().nonnegative(),
  requires_auth: z.boolean(),
  risk_level: z.enum(["read_only", "writes", "destructive"]),
});

export const webSearchInputSchema = z.object({
  query: z.string().min(2),
  locale: z.string().default("en-US"),
  max_results: z.number().int().min(1).max(20).default(8),
});
export const webSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      source: z.string(),
      snippet: z.string(),
    }),
  ),
});

export const webFetchInputSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().int().min(1000).max(20000).default(8000),
});
export const webFetchOutputSchema = z.object({
  url: z.string().url(),
  status: z.number().int(),
  content_type: z.string(),
  html: z.string(),
});

export const webExtractInputSchema = z.object({
  html: z.string(),
  mode: z.enum(["article", "bullets", "facts"]).default("article"),
});
export const webExtractOutputSchema = z.object({
  title: z.string().nullable(),
  text: z.string(),
  key_points: z.array(z.string()),
});

export const webSummarizeInputSchema = z.object({
  query: z.string(),
  extracted_docs: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullable(),
      text: z.string(),
    }),
  ),
  max_words: z.number().int().min(80).max(1200).default(320),
  include_citations: z.boolean().default(true),
});
export const webSummarizeOutputSchema = z.object({
  summary: z.string(),
  citations: z.array(citationSchema),
});

export const weatherForecastInputSchema = z.object({
  location: z.string().min(2),
  units: z.enum(["metric", "imperial"]).default("metric"),
  days: z.number().int().min(1).max(10).default(5),
});
export const weatherForecastOutputSchema = z.object({
  location: z.string(),
  forecast: z.array(
    z.object({
      date: z.string(),
      condition: z.string(),
      min: z.number(),
      max: z.number(),
      precipitation_probability: z.number().min(0).max(100),
    }),
  ),
});

export const translateTextInputSchema = z.object({
  text: z.string().min(1),
  source_lang: z.string().default("auto"),
  target_lang: z.string().min(2),
  preserve_format: z.boolean().default(true),
});
export const translateTextOutputSchema = z.object({
  source_lang: z.string(),
  target_lang: z.string(),
  original_text: z.string(),
  translated_text: z.string(),
});

export const googleDriveSearchInputSchema = z.object({
  query: z.string().min(1),
  folder_id: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const googleDriveCreateFolderInputSchema = z.object({
  name: z.string().min(1),
  parent_folder_id: z.string().nullable().optional(),
});
export const googleDriveUploadInputSchema = z.object({
  folder_id: z.string().nullable().optional(),
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  content_ref: z.string().min(1),
});
export const googleDriveMoveInputSchema = z.object({
  file_id: z.string().min(1),
  target_folder_id: z.string().min(1),
});

export const googleSlidesCreateInputSchema = z.object({
  title: z.string().min(1),
  folder_id: z.string().nullable().optional(),
});
export const googleSlidesBatchUpdateInputSchema = z.object({
  presentation_id: z.string().min(1),
  requests: z.array(z.record(z.string(), z.unknown())).min(1),
});
export const googleSlidesExportPdfInputSchema = z.object({
  presentation_id: z.string().min(1),
});

export const gmailSearchInputSchema = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(50).default(20),
});
export const gmailGetThreadInputSchema = z.object({
  thread_id: z.string().min(1),
});
export const gmailCreateDraftInputSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body_markdown: z.string().min(1),
  thread_id: z.string().nullable().optional(),
});
export const gmailSendInputSchema = z.object({
  draft_id: z.string().min(1),
});

export const calendarListInputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export const calendarCreateInputSchema = z.object({
  title: z.string().min(1),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  attendees: z.array(z.string().email()).default([]),
  description: z.string().nullable().optional(),
});
export const calendarFindFreeSlotsInputSchema = z.object({
  attendee_emails: z.array(z.string().email()).min(1),
  from: z.string().datetime(),
  to: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(240).default(30),
});

export const tasksCreateInputSchema = z.object({
  title: z.string().min(1),
  assignee: z.string().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).default("p2"),
});
export const tasksAssignInputSchema = z.object({
  task_id: z.string().min(1),
  assignee: z.string().min(1),
});
export const tasksDueInputSchema = z.object({
  task_id: z.string().min(1),
  due_at: z.string().datetime(),
});
export const tasksListInputSchema = z.object({
  status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
  assignee: z.string().nullable().optional(),
});

export const builderReadFileInputSchema = z.object({ path: z.string().min(1) });
export const builderSearchInFilesInputSchema = z.object({ query: z.string().min(1), glob: z.string().optional() });
export const builderApplyPatchInputSchema = z.object({ patch: z.string().min(1) });
export const builderWriteFileInputSchema = z.object({ path: z.string().min(1), content: z.string() });
export const builderCreateFileInputSchema = z.object({ path: z.string().min(1), content: z.string().optional() });

// ── Company Builder ──────────────────────────────────────────────────────────

export const companyBuilderBuildPlanInputSchema = z.object({
  /** Optional focus area to narrow the plan (e.g. "GTM strategy", "hiring plan") */
  focus: z.string().optional(),
}).strict();

export const companyBuilderCreateProcessInputSchema = z.object({
  /** Name / title of the business process to document */
  process_name: z.string().min(2),
  detail_level: z.enum(["brief", "detailed"]).default("detailed"),
}).strict();

export const companyBuilderCreateDocumentInputSchema = z.object({
  /** Type of business document to generate */
  document_type: z.enum(["contract", "business_plan", "pitch_deck", "ops_manual", "sop"]),
  title: z.string().min(2),
  /** Optional additional context, instructions, or data to include */
  context: z.string().optional(),
}).strict();

export const companyBuilderWeeklyReviewInputSchema = z.object({
  /** Time period to review, e.g. "this week", "last week", "2025-W12" */
  period: z.string().default("this week"),
  /** Optional focus areas to highlight in the review */
  focus_areas: z.array(z.string()).optional(),
}).strict();

export const plannerMustUseRules = [
  {
    id: "weather_intent_must_use_tool",
    when_intent_matches: ["weather", "forecast", "temperature", "rain"],
    required_tool: "weather.getForecast",
  },
  {
    id: "translate_intent_must_use_tool",
    when_intent_matches: ["translate", "übersetze", "translation"],
    required_tool: "translate.text",
  },
] as const;

export const toolCatalogMeta = {
  "web.search": { rate_limit_per_minute: 30, cache_ttl_seconds: 300, requires_auth: false, risk_level: "read_only" },
  "web.fetch": { rate_limit_per_minute: 40, cache_ttl_seconds: 900, requires_auth: false, risk_level: "read_only" },
  "web.extract": { rate_limit_per_minute: 60, cache_ttl_seconds: 900, requires_auth: false, risk_level: "read_only" },
  "web.summarize": { rate_limit_per_minute: 25, cache_ttl_seconds: 120, requires_auth: false, risk_level: "read_only" },
  "weather.getForecast": { rate_limit_per_minute: 30, cache_ttl_seconds: 600, requires_auth: false, risk_level: "read_only" },
  "translate.text": { rate_limit_per_minute: 45, cache_ttl_seconds: 600, requires_auth: false, risk_level: "read_only" },
  "drive.search": { rate_limit_per_minute: 25, cache_ttl_seconds: 120, requires_auth: true, risk_level: "read_only" },
  "drive.move": { rate_limit_per_minute: 20, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "drive.createFolder": { rate_limit_per_minute: 20, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "drive.upload": { rate_limit_per_minute: 20, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "slides.create": { rate_limit_per_minute: 15, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "slides.batchUpdate": { rate_limit_per_minute: 30, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "slides.exportPdf": { rate_limit_per_minute: 25, cache_ttl_seconds: 300, requires_auth: true, risk_level: "read_only" },
  "gmail.search": { rate_limit_per_minute: 25, cache_ttl_seconds: 120, requires_auth: true, risk_level: "read_only" },
  "gmail.getThread": { rate_limit_per_minute: 25, cache_ttl_seconds: 120, requires_auth: true, risk_level: "read_only" },
  "gmail.createDraft": { rate_limit_per_minute: 20, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "gmail.send": { rate_limit_per_minute: 15, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "calendar.list": { rate_limit_per_minute: 25, cache_ttl_seconds: 120, requires_auth: true, risk_level: "read_only" },
  "calendar.create": { rate_limit_per_minute: 20, cache_ttl_seconds: 0, requires_auth: true, risk_level: "writes" },
  "calendar.findFreeSlots": { rate_limit_per_minute: 20, cache_ttl_seconds: 60, requires_auth: true, risk_level: "read_only" },
  "tasks.create": { rate_limit_per_minute: 30, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
  "tasks.assign": { rate_limit_per_minute: 30, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
  "tasks.due": { rate_limit_per_minute: 30, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
  "tasks.list": { rate_limit_per_minute: 40, cache_ttl_seconds: 120, requires_auth: false, risk_level: "read_only" },
  "builder.readFile": { rate_limit_per_minute: 120, cache_ttl_seconds: 30, requires_auth: false, risk_level: "read_only" },
  "builder.searchInFiles": { rate_limit_per_minute: 80, cache_ttl_seconds: 15, requires_auth: false, risk_level: "read_only" },
  "builder.applyPatch": { rate_limit_per_minute: 50, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
  "builder.writeFile": { rate_limit_per_minute: 40, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
  "builder.createFile": { rate_limit_per_minute: 40, cache_ttl_seconds: 0, requires_auth: false, risk_level: "writes" },
} as const satisfies Record<string, z.infer<typeof baseToolMetaSchema>>;
