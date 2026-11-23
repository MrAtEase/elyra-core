import { randomUUID } from "crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import type { AppManifest, ToolRegistryItem, UiBootstrapContract } from "@/lib/orb-os/contracts/types";
import { requiresApproval, resolveApprovalMode, type PolicyContext } from "@/lib/orb-os/policy/model";
import { defaultUiCardHintForType, type ArtifactType, type ArtifactUiCardHint } from "@/lib/orb-os/artifacts/schema";
import {
  googleDriveCreateFolderInputSchema,
  googleDriveMoveInputSchema,
  googleDriveSearchInputSchema,
  googleDriveUploadInputSchema,
  googleSlidesBatchUpdateInputSchema,
  googleSlidesCreateInputSchema,
  googleSlidesExportPdfInputSchema,
  translateTextInputSchema,
  weatherForecastInputSchema,
  webExtractInputSchema,
  webFetchInputSchema,
  webSearchInputSchema,
  webSummarizeInputSchema,
  companyBuilderBuildPlanInputSchema,
  companyBuilderCreateProcessInputSchema,
  companyBuilderCreateDocumentInputSchema,
  companyBuilderWeeklyReviewInputSchema,
} from "@/lib/orb-os/tools/schemas";
import { runRunnableToolAdapter, RunnableToolError } from "@/lib/orb-os/tools/runnableAdapters";
import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_PRESENTATIONS_SCOPE,
  hasRequiredScopes,
} from "@/lib/google/scopes";
import { ensureGoogleAccessToken } from "@/lib/google/tokenStore";
import { createDriveFolder, moveDriveFile, searchDriveFiles, uploadDriveFile } from "@/lib/google/drive";
import { batchUpdateSlides, createSlidesPresentation, exportSlidesPdf } from "@/lib/google/slides";
import { listGmailMessages, sendGmailMessage } from "@/lib/google/gmail";
import { isWorkerBackboneMode } from "@/lib/orb-os/runtime/workerProxy";
import { dispatchPluginTool } from "@/lib/orb-os/plugins/runtime";
import { assertDataPlaneWrite } from "@/lib/orb-os/cqrs/ownership";

export const executeToolRequestSchema = z.object({
  workspace_id: z.string().min(1),
  run_id: z.string().min(1),
  tool_name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(6).max(160),
  approval_granted: z.boolean().optional(),
});

export type ExecuteToolRequest = z.infer<typeof executeToolRequestSchema>;

export type ToolExecutionErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_SCOPE_MISSING"
  | "TOOL_NOT_REGISTERED"
  | "TOOL_DISABLED"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "RUN_NOT_FOUND"
  | "INVALID_ARGS"
  | "TOOL_ADAPTER_MISSING"
  | "TOOL_TIMEOUT"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_RATE_LIMITED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "DB_WRITE_FAILED"
  | "INTERNAL_ERROR";

export class ToolExecutionError extends Error {
  readonly code: ToolExecutionErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: {
    code: ToolExecutionErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(input.message);
    this.code = input.code;
    this.status = input.status ?? 500;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

type ToolExecutionArtifact = {
  type: ArtifactType;
  title: string;
  path?: string | null;
  metadata?: Record<string, unknown>;
  link_url?: string | null;
};

type ToolAdapterResult = {
  output: Record<string, unknown>;
  artifacts?: ToolExecutionArtifact[];
  ui_card_hint?: string;
};

type ToolAdapterContext = {
  workspaceId: string;
  runId: string;
  toolName: string;
  args: Record<string, unknown>;
  signal: AbortSignal;
};

type ToolAdapterDefinition = {
  inputSchema: z.ZodType<Record<string, unknown>>;
  timeoutMs: number;
  maxRetries: number;
  execute: (ctx: ToolAdapterContext) => Promise<ToolAdapterResult>;
};

type ExecuteToolSuccess = {
  ok: true;
  status: "succeeded";
  tool_call_id: string;
  idempotent_replay: boolean;
  result: Record<string, unknown>;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    path: string | null;
    metadata: Record<string, unknown>;
  }>;
  ui_card_hint: string | null;
  retries: number;
  latency_ms: number;
};

type ExecuteToolWaiting = {
  ok: true;
  status: "waiting_for_auth" | "waiting_for_approval";
  tool_call_id: string;
  error_code: ToolExecutionErrorCode;
  reason: string;
  ui_card_hint: string;
};

export type ExecuteToolResult = ExecuteToolSuccess | ExecuteToolWaiting;

type CachedToolCall = {
  id: string;
  status: string;
  response_json: Record<string, unknown> | null;
  error: string | null;
};

function ensureRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildPolicyContext(manifest: AppManifest | undefined): PolicyContext {
  if (!manifest) return {};
  const tags = new Set(manifest.risk_tags);
  return {
    external_data: tags.has("external_data"),
    pii: tags.has("pii"),
  };
}

function backoffMs(attempt: number): number {
  return Math.min(2500, 250 * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeToolName(toolName: string): string {
  if (toolName === "weather.get_forecast") return "weather.getForecast";
  if (toolName === "google_drive.list") return "drive.search_files";
  if (toolName === "google_slides.update") return "slides.batch_update";
  if (toolName === "drive.search") return "drive.search_files";
  if (toolName === "drive.createFolder") return "drive.create_folder";
  if (toolName === "slides.create") return "slides.create_presentation";
  if (toolName === "slides.batchUpdate") return "slides.batch_update";
  if (toolName === "slides.exportPdf") return "slides.export_pdf";
  if (toolName === "google_calendar.create_event") return "calendar.create";
  if (toolName === "google_calendar.list_events") return "calendar.list";
  return toolName;
}

async function withTimeout<T>(timeoutMs: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ToolExecutionError({
        code: "TOOL_TIMEOUT",
        message: `Tool execution exceeded timeout (${timeoutMs}ms)`,
        status: 504,
        retryable: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ToolExecutionError) return error.retryable;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

async function executeWithRetries(input: {
  adapter: ToolAdapterDefinition;
  workspaceId: string;
  runId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<{ result: ToolAdapterResult; retries: number }> {
  let attempt = 0;
  let lastError: unknown;
  const maxAttempts = Math.max(1, input.adapter.maxRetries + 1);

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await withTimeout(input.adapter.timeoutMs, async (signal) => {
        return input.adapter.execute({
          workspaceId: input.workspaceId,
          runId: input.runId,
          toolName: input.toolName,
          args: input.args,
          signal,
        });
      });
      return { result, retries: attempt - 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableError(error)) break;
      await sleep(backoffMs(attempt));
    }
  }

  if (lastError instanceof ToolExecutionError) throw lastError;
  throw new ToolExecutionError({
    code: "TOOL_EXECUTION_FAILED",
    message: lastError instanceof Error ? lastError.message : "Tool adapter failed",
    status: 502,
    retryable: false,
    details: lastError,
  });
}

const webSearchSummarizeInputSchema = z.object({
  query: z.string().min(2),
  max_results: z.number().int().min(1).max(12).default(5),
});

const googleMailDraftInputSchema = z.object({
  subject: z.string().min(1).default("Draft from Elyra"),
  to: z.array(z.string().email()).default([]),
  body: z.string().optional(),
  instruction: z.string().optional(),
});

const gmailSearchToolInputSchema = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(50).default(20),
});

const gmailSendDirectInputSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  thread_id: z.string().optional(),
});

const calendarListToolInputSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  max_results: z.number().int().min(1).max(50).optional(),
});

const calendarCreateToolInputSchema = z.object({
  title: z.string().min(1),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional(),
});

const slidesPublishInputSchema = z.object({
  title: z.string().min(1),
  slides: z.array(z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
  })).min(1),
});

const googleCalendarCreateInputSchema = z.object({
  title: z.string().min(1),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  description: z.string().optional(),
});

function requiredGoogleScopesForTool(toolName: string): string[] {
  const normalized = normalizeToolName(toolName);
  if (normalized === "drive.search_files") return [GOOGLE_DRIVE_READONLY_SCOPE];
  if (normalized === "drive.create_folder") return [GOOGLE_DRIVE_FILE_SCOPE];
  if (normalized === "drive.upload") return [GOOGLE_DRIVE_FILE_SCOPE];
  if (normalized === "drive.move") return [GOOGLE_DRIVE_FILE_SCOPE];
  if (normalized === "slides.create_presentation") return [GOOGLE_PRESENTATIONS_SCOPE];
  if (normalized === "slides.batch_update") return [GOOGLE_PRESENTATIONS_SCOPE];
  if (normalized === "slides.export_pdf") return [GOOGLE_DRIVE_READONLY_SCOPE];
  if (normalized === "slides.publish") return [GOOGLE_PRESENTATIONS_SCOPE];
  if (normalized === "gmail.search") return [GOOGLE_GMAIL_READONLY_SCOPE];
  if (normalized === "gmail.send") return [GOOGLE_GMAIL_SEND_SCOPE];
  if (normalized === "calendar.list") return [GOOGLE_CALENDAR_READONLY_SCOPE];
  if (normalized === "calendar.create") return [GOOGLE_CALENDAR_EVENTS_SCOPE];
  return [];
}

async function getWorkspaceGoogleAccessToken(workspaceId: string, toolName: string): Promise<string> {
  const requiredScopes = requiredGoogleScopesForTool(toolName);
  const token = await ensureGoogleAccessToken({
    workspaceId,
    requiredScopes,
  });
  return token.accessToken;
}

async function executeWeatherTool(args: Record<string, unknown>): Promise<ToolAdapterResult> {
  const parsed = weatherForecastInputSchema.parse(args);
  const now = new Date();
  const forecast = Array.from({ length: parsed.days }).map((_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() + index);
    const base = parsed.units === "imperial" ? 68 : 20;
    return {
      date: date.toISOString().slice(0, 10),
      condition: index % 3 === 0 ? "Clear" : index % 3 === 1 ? "Cloudy" : "Rain",
      min: base - 4 + index,
      max: base + 3 + index,
      precipitation_probability: Math.min(90, 20 + index * 8),
    };
  });
  return {
    output: {
      location: parsed.location,
      units: parsed.units,
      forecast,
    },
    artifacts: [
      {
        type: "weather_forecast",
        title: `Forecast: ${parsed.location}`,
        metadata: { location: parsed.location, days: parsed.days },
      },
    ],
    ui_card_hint: "card.weather_forecast",
  };
}

// ── Company Builder helpers ───────────────────────────────────────────────────

type WorkspaceBrainData = {
  workspaceName: string;
  kind: string;
  profile: Record<string, unknown>;
};

async function fetchWorkspaceBrain(workspaceId: string): Promise<WorkspaceBrainData> {
  const supabase = getSupabaseAdminClient();

  const { data: ws } = await supabase
    .from("workspaces")
    .select("name,kind")
    .eq("id", workspaceId)
    .maybeSingle();

  const { data: identity } = await supabase
    .from("workspace_identity")
    .select("profile_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const profile = (identity?.profile_json as Record<string, unknown> | null) ?? {};

  return {
    workspaceName: (ws?.name as string | undefined) ?? "your company",
    kind: (ws?.kind as string | undefined) ?? "company",
    profile,
  };
}

async function callGeminiForTool(prompt: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
      signal,
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Try to parse JSON if the model returned a JSON block; otherwise wrap as plain text.
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

// ── Tool adapters ─────────────────────────────────────────────────────────────

const toolAdapters: Record<string, ToolAdapterDefinition> = {
  "web.search": {
    inputSchema: webSearchInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 10_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "web.search",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "research_report",
            title: `Web Search: ${String((args.query as string | undefined) ?? "query")}`,
            metadata: output,
          },
        ],
        ui_card_hint: "card.research_report",
      };
    },
  },
  "web.fetch": {
    inputSchema: webFetchInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "web.fetch",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "research_report",
            title: "Web Fetch Result",
            metadata: {
              url: output.url,
              status: output.status,
            },
          },
        ],
        ui_card_hint: "card.research_report",
      };
    },
  },
  "web.extract": {
    inputSchema: webExtractInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "web.extract",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "research_report",
            title: String((output.title as string | null | undefined) ?? "Extracted Content"),
            metadata: output,
          },
        ],
        ui_card_hint: "card.research_report",
      };
    },
  },
  "web.summarize": {
    inputSchema: webSummarizeInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 10_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "web.summarize",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "research_report",
            title: `Summary: ${String((args.query as string | undefined) ?? "research")}`,
            metadata: output,
          },
        ],
        ui_card_hint: "card.research_report",
      };
    },
  },
  "translate.text": {
    inputSchema: translateTextInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 8_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "translate.text",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "translation_result",
            title: `Translation (${String((output.target_lang as string | undefined) ?? "target")})`,
            metadata: output,
          },
        ],
        ui_card_hint: "card.translation_result",
      };
    },
  },
  "weather.getForecast": {
    inputSchema: weatherForecastInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 10_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args, signal }) => {
      const output = await runRunnableToolAdapter({
        workspaceId,
        toolName: "weather.getForecast",
        args,
        signal,
      });
      return {
        output,
        artifacts: [
          {
            type: "weather_forecast",
            title: `Forecast: ${String((output.location as string | undefined) ?? "location")}`,
            metadata: output,
          },
        ],
        ui_card_hint: "card.weather_forecast",
      };
    },
  },
  "web.search_and_summarize": {
    inputSchema: webSearchSummarizeInputSchema,
    timeoutMs: 9_000,
    maxRetries: 1,
    execute: async ({ args }) => {
      const parsed = webSearchSummarizeInputSchema.parse(args);
      const citations = Array.from({ length: parsed.max_results }).map((_, index) => ({
        title: `Result ${index + 1} for ${parsed.query}`,
        url: `https://example.com/search/${encodeURIComponent(parsed.query)}/${index + 1}`,
        snippet: `Synthetic source snippet ${index + 1} for ${parsed.query}`,
      }));
      return {
        output: {
          summary: `Summary for \"${parsed.query}\" based on ${citations.length} sources.`,
          citations,
        },
        artifacts: [
          {
            type: "research_report",
            title: `Research: ${parsed.query}`,
            metadata: { citations_count: citations.length, query: parsed.query },
          },
        ],
        ui_card_hint: "card.research_report",
      };
    },
  },
  "google_mail.draft_reply": {
    inputSchema: googleMailDraftInputSchema,
    timeoutMs: 8_000,
    maxRetries: 0,
    execute: async ({ args }) => {
      const parsed = googleMailDraftInputSchema.parse(args);
      const body = parsed.body ?? parsed.instruction ?? "Draft generated by Elyra.";
      return {
        output: {
          draft_id: `draft_${randomUUID().slice(0, 12)}`,
          subject: parsed.subject,
          to: parsed.to,
          body,
        },
        artifacts: [],
        ui_card_hint: "gmail_draft",
      };
    },
  },
  "google_calendar.create_event": {
    inputSchema: googleCalendarCreateInputSchema,
    timeoutMs: 8_000,
    maxRetries: 0,
    execute: async ({ args }) => {
      const parsed = googleCalendarCreateInputSchema.parse(args);
      const startAt = parsed.start_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const endAt = parsed.end_at ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      return {
        output: {
          event_id: `evt_${randomUUID().slice(0, 12)}`,
          title: parsed.title,
          start_at: startAt,
          end_at: endAt,
          description: parsed.description ?? null,
        },
        artifacts: [],
        ui_card_hint: "calendar_event",
      };
    },
  },
  "drive.search_files": {
    inputSchema: googleDriveSearchInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 10_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleDriveSearchInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "drive.search_files");
      const files = await searchDriveFiles({
        accessToken,
        query: parsed.query,
        folderId: parsed.folder_id ?? null,
        limit: parsed.limit,
      });
      const first = files[0];
      return {
        output: {
          files: files.map((file) => ({
            id: file.id,
            name: file.name,
            mime_type: file.mimeType,
            web_view_link: file.webViewLink,
            parents: file.parents,
          })),
          total: files.length,
        },
        artifacts: first
          ? [{
            type: "drive_file",
            title: first.name,
            link_url: first.webViewLink,
            metadata: { file_id: first.id, mime_type: first.mimeType, parents: first.parents },
          }]
          : [],
        ui_card_hint: "card.drive_file",
      };
    },
  },
  "drive.create_folder": {
    inputSchema: googleDriveCreateFolderInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 10_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleDriveCreateFolderInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "drive.create_folder");
      const folder = await createDriveFolder({
        accessToken,
        name: parsed.name,
        parentFolderId: parsed.parent_folder_id ?? null,
      });
      return {
        output: {
          folder_id: folder.id,
          name: folder.name,
          web_view_link: folder.webViewLink,
          parents: folder.parents,
        },
        artifacts: [{
          type: "drive_file",
          title: folder.name,
          link_url: folder.webViewLink,
          metadata: { file_id: folder.id, mime_type: folder.mimeType, parents: folder.parents, kind: "folder" },
        }],
        ui_card_hint: "card.drive_file",
      };
    },
  },
  "drive.upload": {
    inputSchema: googleDriveUploadInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 14_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleDriveUploadInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "drive.upload");
      const file = await uploadDriveFile({
        accessToken,
        folderId: parsed.folder_id ?? null,
        fileName: parsed.file_name,
        mimeType: parsed.mime_type,
        contentRef: parsed.content_ref,
      });
      return {
        output: {
          file_id: file.id,
          name: file.name,
          mime_type: file.mimeType,
          web_view_link: file.webViewLink,
          parents: file.parents,
        },
        artifacts: [{
          type: "drive_file",
          title: file.name,
          link_url: file.webViewLink,
          metadata: { file_id: file.id, mime_type: file.mimeType, parents: file.parents, source: "upload" },
        }],
        ui_card_hint: "card.drive_file",
      };
    },
  },
  "drive.move": {
    inputSchema: googleDriveMoveInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleDriveMoveInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "drive.move");
      const moved = await moveDriveFile({
        accessToken,
        fileId: parsed.file_id,
        targetFolderId: parsed.target_folder_id,
      });
      return {
        output: {
          file_id: moved.id,
          name: moved.name,
          web_view_link: moved.webViewLink,
          parents: moved.parents,
        },
        artifacts: [{
          type: "drive_file",
          title: moved.name,
          link_url: moved.webViewLink,
          metadata: { file_id: moved.id, mime_type: moved.mimeType, parents: moved.parents, action: "move" },
        }],
        ui_card_hint: "card.drive_file",
      };
    },
  },
  "slides.create_presentation": {
    inputSchema: googleSlidesCreateInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleSlidesCreateInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "slides.create_presentation");
      const created = await createSlidesPresentation({
        accessToken,
        title: parsed.title,
      });
      return {
        output: {
          presentation_id: created.presentationId,
          title: created.title,
          open_url: created.openUrl,
        },
        artifacts: [{
          type: "slides_deck_link",
          title: created.title,
          link_url: created.openUrl,
          metadata: { presentation_id: created.presentationId },
        }],
        ui_card_hint: "card.slides_deck_link",
      };
    },
  },
  "slides.batch_update": {
    inputSchema: googleSlidesBatchUpdateInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleSlidesBatchUpdateInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "slides.batch_update");
      const updated = await batchUpdateSlides({
        accessToken,
        presentationId: parsed.presentation_id,
        requests: parsed.requests,
      });
      return {
        output: {
          presentation_id: updated.presentationId,
          open_url: updated.openUrl,
          applied_requests: parsed.requests.length,
          replies_count: updated.replies.length,
        },
        artifacts: [{
          type: "slides_deck_link",
          title: `Updated deck ${updated.presentationId}`,
          link_url: updated.openUrl,
          metadata: { presentation_id: updated.presentationId, replies_count: updated.replies.length },
        }],
        ui_card_hint: "card.slides_deck_link",
      };
    },
  },
  "slides.export_pdf": {
    inputSchema: googleSlidesExportPdfInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 15_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = googleSlidesExportPdfInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "slides.export_pdf");
      const pdf = await exportSlidesPdf({
        accessToken,
        presentationId: parsed.presentation_id,
      });
      return {
        output: {
          presentation_id: pdf.presentationId,
          file_name: pdf.fileName,
          bytes: pdf.bytes,
          export_url: pdf.exportUrl,
          open_url: pdf.openUrl,
        },
        artifacts: [{
          type: "drive_file",
          title: pdf.fileName,
          link_url: pdf.exportUrl,
          metadata: {
            presentation_id: pdf.presentationId,
            mime_type: "application/pdf",
            bytes: pdf.bytes,
            source: "slides.export_pdf",
          },
        }],
        ui_card_hint: "card.drive_file",
      };
    },
  },
  "slides.publish": {
    inputSchema: slidesPublishInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 20_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = slidesPublishInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "slides.publish");
      const created = await createSlidesPresentation({ accessToken, title: parsed.title });
      const requests: Array<Record<string, unknown>> = [];
      if (created.firstSlideId) {
        requests.push({ deleteObject: { objectId: created.firstSlideId } });
      }
      parsed.slides.forEach((slide, index) => {
        const slideId = `slide_${index + 1}`;
        const titleId = `slide_${index + 1}_title`;
        const bodyId = `slide_${index + 1}_body`;
        const bodyLines = Array.isArray(slide.bullets) && slide.bullets.length > 0
          ? slide.bullets.map((b) => `• ${b}`)
          : [slide.body ?? ""];
        const bodyText = bodyLines.filter(Boolean).join("\n");
        requests.push({ createSlide: { objectId: slideId, insertionIndex: index, slideLayoutReference: { predefinedLayout: "BLANK" } } });
        requests.push({ createShape: { objectId: titleId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 600, unit: "PT" }, height: { magnitude: 70, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 36, unit: "PT" } } } });
        requests.push({ insertText: { objectId: titleId, insertionIndex: 0, text: slide.title.trim() } });
        requests.push({ updateTextStyle: { objectId: titleId, style: { bold: true, fontSize: { magnitude: index === 0 ? 28 : 24, unit: "PT" } }, textRange: { type: "ALL" }, fields: "bold,fontSize" } });
        if (bodyText) {
          requests.push({ createShape: { objectId: bodyId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 600, unit: "PT" }, height: { magnitude: 300, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: 44, translateY: index === 0 ? 150 : 128, unit: "PT" } } } });
          requests.push({ insertText: { objectId: bodyId, insertionIndex: 0, text: bodyText } });
          requests.push({ updateTextStyle: { objectId: bodyId, style: { fontSize: { magnitude: 16, unit: "PT" } }, textRange: { type: "ALL" }, fields: "fontSize" } });
        }
      });
      const updated = await batchUpdateSlides({ accessToken, presentationId: created.presentationId, requests });
      return {
        output: { presentation_id: updated.presentationId, url: updated.openUrl, slide_count: parsed.slides.length },
        artifacts: [{ type: "slides_deck_link", title: parsed.title, link_url: updated.openUrl, metadata: { presentation_id: updated.presentationId, slide_count: parsed.slides.length } }],
        ui_card_hint: "card.slides_deck_link",
      };
    },
  },
  "gmail.search": {
    inputSchema: gmailSearchToolInputSchema,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = gmailSearchToolInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "gmail.search");
      const messages = await listGmailMessages({ accessToken, q: parsed.query, limit: parsed.max_results });
      return {
        output: { messages, total: messages.length },
        artifacts: [],
        ui_card_hint: "card.gmail_list",
      };
    },
  },
  "gmail.send": {
    inputSchema: gmailSendDirectInputSchema,
    timeoutMs: 12_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args }) => {
      const parsed = gmailSendDirectInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "gmail.send");
      const sendArgs: Parameters<typeof sendGmailMessage>[0] = {
        accessToken,
        to: parsed.to,
        subject: parsed.subject,
        body: parsed.body,
      };
      if (parsed.cc) sendArgs.cc = parsed.cc;
      if (parsed.thread_id) sendArgs.replyToThreadId = parsed.thread_id;
      const sent = await sendGmailMessage(sendArgs);
      return {
        output: { message_id: sent.messageId, thread_id: sent.threadId, text: `Email sent to ${parsed.to}` },
        artifacts: [],
        ui_card_hint: "card.generic",
      };
    },
  },
  "calendar.list": {
    inputSchema: calendarListToolInputSchema,
    timeoutMs: 12_000,
    maxRetries: 1,
    execute: async ({ workspaceId, args }) => {
      const parsed = calendarListToolInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "calendar.list");
      const now = new Date();
      const timeMin = parsed.from ?? now.toISOString();
      const timeMax = parsed.to ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const maxResults = parsed.max_results ?? 20;
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
      const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const events = (data.items ?? []).map((e) => ({
        id: e.id,
        title: e.summary,
        start: (e.start as Record<string, unknown> | undefined)?.dateTime ?? (e.start as Record<string, unknown> | undefined)?.date,
        end: (e.end as Record<string, unknown> | undefined)?.dateTime ?? (e.end as Record<string, unknown> | undefined)?.date,
        location: e.location ?? null,
        description: e.description ?? null,
        link: e.htmlLink ?? null,
      }));
      return {
        output: { events, total: events.length },
        artifacts: [],
        ui_card_hint: "card.calendar_events",
      };
    },
  },
  "calendar.create": {
    inputSchema: calendarCreateToolInputSchema,
    timeoutMs: 12_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args }) => {
      const parsed = calendarCreateToolInputSchema.parse(args);
      const accessToken = await getWorkspaceGoogleAccessToken(workspaceId, "calendar.create");
      const body: Record<string, unknown> = {
        summary: parsed.title,
        start: { dateTime: parsed.start_at, timeZone: "UTC" },
        end: { dateTime: parsed.end_at, timeZone: "UTC" },
      };
      if (parsed.description) body.description = parsed.description;
      if (parsed.attendees && parsed.attendees.length > 0) {
        body.attendees = parsed.attendees.map((email) => ({ email }));
      }
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Calendar create failed: ${res.status}`);
      const event = (await res.json()) as Record<string, unknown>;
      return {
        output: {
          event_id: event.id,
          title: event.summary,
          start: (event.start as Record<string, unknown> | undefined)?.dateTime,
          end: (event.end as Record<string, unknown> | undefined)?.dateTime,
          link: event.htmlLink ?? null,
        },
        artifacts: [],
        ui_card_hint: "card.calendar_event",
      };
    },
  },

  // ── Company Builder ─────────────────────────────────────────────────────────

  "company_builder.build_plan": {
    inputSchema: companyBuilderBuildPlanInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 45_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args, signal }) => {
      const parsed = companyBuilderBuildPlanInputSchema.parse(args);
      const brain = await fetchWorkspaceBrain(workspaceId);
      const focusLine = parsed.focus ? `\nFocus specifically on: ${parsed.focus}` : "";
      const prompt = `You are an expert business strategist. Create a detailed operational build plan for "${brain.workspaceName}" (a ${brain.kind} workspace).${focusLine}

Workspace context:
${JSON.stringify(brain.profile, null, 2)}

Respond with a JSON object with these keys:
- "title": string — plan title
- "summary": string — 2-3 sentence executive summary
- "phases": array of { "phase": string, "duration": string, "goals": string[], "key_actions": string[] }
- "milestones": array of { "milestone": string, "target_date": string, "success_criteria": string }
- "risks": array of { "risk": string, "mitigation": string }
- "next_steps": string[] — top 3 immediate actions

Return ONLY the JSON object, no markdown fences.`;

      const result = await callGeminiForTool(prompt, signal);
      return {
        output: result,
        artifacts: [
          {
            type: "document" as const,
            title: (result.title as string | undefined) ?? `Build Plan — ${brain.workspaceName}`,
            metadata: result,
          },
        ],
        ui_card_hint: "card.build_plan",
      };
    },
  },

  "company_builder.create_process": {
    inputSchema: companyBuilderCreateProcessInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 40_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args, signal }) => {
      const parsed = companyBuilderCreateProcessInputSchema.parse(args);
      const brain = await fetchWorkspaceBrain(workspaceId);
      const detailInstruction =
        parsed.detail_level === "brief"
          ? "Keep it concise — 5-7 steps maximum."
          : "Be thorough — include substeps, decision points, and edge cases.";

      const prompt = `You are an expert business process designer. Create a structured process document for "${parsed.process_name}" at "${brain.workspaceName}" (a ${brain.kind}).

${detailInstruction}

Workspace context:
${JSON.stringify(brain.profile, null, 2)}

Respond with a JSON object with these keys:
- "title": string
- "purpose": string — one sentence explaining why this process exists
- "owner": string — role responsible for this process
- "steps": array of { "step_number": number, "title": string, "description": string, "responsible": string, "checklist": string[] }
- "inputs": string[] — what's needed to start this process
- "outputs": string[] — what this process produces
- "kpis": string[] — how to measure success

Return ONLY the JSON object, no markdown fences.`;

      const result = await callGeminiForTool(prompt, signal);
      return {
        output: result,
        artifacts: [
          {
            type: "document" as const,
            title: (result.title as string | undefined) ?? parsed.process_name,
            metadata: result,
          },
        ],
        ui_card_hint: "card.process_doc",
      };
    },
  },

  "company_builder.create_document": {
    inputSchema: companyBuilderCreateDocumentInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 45_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args, signal }) => {
      const parsed = companyBuilderCreateDocumentInputSchema.parse(args);
      const brain = await fetchWorkspaceBrain(workspaceId);
      const contextLine = parsed.context ? `\nAdditional context: ${parsed.context}` : "";

      const docTypeInstructions: Record<string, string> = {
        contract: "Create a professional service/employment contract with standard clauses.",
        business_plan:
          "Create a comprehensive business plan with executive summary, market analysis, operations, and financials.",
        pitch_deck: "Create a 10-slide pitch deck outline with titles, key points, and speaker notes per slide.",
        ops_manual: "Create an operations manual covering team structure, processes, tools, and escalation paths.",
        sop: "Create a Standard Operating Procedure with objectives, scope, responsibilities, and step-by-step instructions.",
      };

      const prompt = `You are an expert business writer. ${docTypeInstructions[parsed.document_type] ?? "Create a professional business document."}

Company: "${brain.workspaceName}" (${brain.kind})
Document title: "${parsed.title}"${contextLine}

Company context:
${JSON.stringify(brain.profile, null, 2)}

Respond with a JSON object with these keys:
- "title": string
- "document_type": string
- "sections": array of { "heading": string, "content": string }
- "summary": string — brief description of the document

Return ONLY the JSON object, no markdown fences.`;

      const result = await callGeminiForTool(prompt, signal);
      return {
        output: result,
        artifacts: [
          {
            type: "document" as const,
            title: (result.title as string | undefined) ?? parsed.title,
            metadata: result,
          },
        ],
        ui_card_hint: "card.business_document",
      };
    },
  },

  "company_builder.weekly_review": {
    inputSchema: companyBuilderWeeklyReviewInputSchema as z.ZodType<Record<string, unknown>>,
    timeoutMs: 40_000,
    maxRetries: 0,
    execute: async ({ workspaceId, args, signal }) => {
      const parsed = companyBuilderWeeklyReviewInputSchema.parse(args);
      const brain = await fetchWorkspaceBrain(workspaceId);
      const focusLine =
        parsed.focus_areas && parsed.focus_areas.length > 0
          ? `\nFocus areas: ${parsed.focus_areas.join(", ")}`
          : "";

      const prompt = `You are an experienced COO helping "${brain.workspaceName}" (a ${brain.kind}) run an effective weekly review.

Period: ${parsed.period}${focusLine}

Company context:
${JSON.stringify(brain.profile, null, 2)}

Generate a structured weekly review with a JSON object containing:
- "period": string
- "summary": string — 2-sentence overall assessment
- "achievements": string[] — key wins from this period
- "challenges": string[] — blockers or issues encountered
- "metrics_review": array of { "metric": string, "status": "on_track" | "at_risk" | "off_track", "notes": string }
- "top_priorities": array of { "priority": string, "owner": string, "deadline": string } — top 3 for next period
- "decisions_needed": string[] — items requiring a decision from leadership
- "action_items": array of { "action": string, "owner": string, "due": string }

Return ONLY the JSON object, no markdown fences.`;

      const result = await callGeminiForTool(prompt, signal);
      return {
        output: result,
        artifacts: [
          {
            type: "document" as const,
            title: `Weekly Review — ${parsed.period}`,
            metadata: result,
          },
        ],
        ui_card_hint: "card.weekly_review",
      };
    },
  },
};

function getAdapter(toolName: string): ToolAdapterDefinition | null {
  const normalized = normalizeToolName(toolName);
  const staticAdapter = toolAdapters[toolName] ?? toolAdapters[normalized] ?? null;
  if (staticAdapter) return staticAdapter;

  if (normalized.startsWith("plugin.")) {
    return {
      inputSchema: z.record(z.string(), z.unknown()),
      timeoutMs: 12_000,
      maxRetries: 0,
      execute: async ({ workspaceId, args }) => {
        const result = await dispatchPluginTool({
          workspaceId,
          toolName: normalized,
          args,
        });
        return {
          output: result.output,
          artifacts: [],
          ui_card_hint: "card.generic",
        };
      },
    };
  }

  return null;
}

function getToolDefinition(contract: UiBootstrapContract, toolName: string): {
  tool: ToolRegistryItem;
  manifest: AppManifest | undefined;
} {
  const tool = contract.tool_registry.find((entry) => entry.tool_name === toolName);
  if (!tool) {
    throw new ToolExecutionError({
      code: "TOOL_NOT_REGISTERED",
      message: `Tool '${toolName}' is not registered for this workspace`,
      status: 404,
    });
  }

  if (tool.status === "disabled") {
    throw new ToolExecutionError({
      code: "TOOL_DISABLED",
      message: `Tool '${toolName}' is disabled`,
      status: 409,
    });
  }

  if (tool.status === "policy_blocked") {
    throw new ToolExecutionError({
      code: "POLICY_BLOCKED",
      message: `Tool '${toolName}' is blocked by policy`,
      status: 403,
    });
  }

  return {
    tool,
    manifest: contract.app_manifest.find((entry) => entry.app_id === tool.app_id),
  };
}

function enforceIntegrationAuth(manifest: AppManifest | undefined, contract: UiBootstrapContract) {
  if (!manifest) return;

  for (const requirement of manifest.auth_requirements) {
    if (requirement.mode !== "required") continue;
    const integration = contract.integration_status.find(
      (entry) => entry.integration_id === requirement.integration_id,
    );

    if (!integration || integration.state !== "connected") {
      throw new ToolExecutionError({
        code: "AUTH_REQUIRED",
        message: `Integration '${requirement.integration_id}' is not connected`,
        status: 409,
      });
    }

    const scopeCheck = hasRequiredScopes(integration.scopes, requirement.required_scopes);
    if (!scopeCheck.ok) {
      throw new ToolExecutionError({
        code: "AUTH_SCOPE_MISSING",
        message: `Missing scopes for '${requirement.integration_id}': ${scopeCheck.missing.join(", ")}`,
        status: 409,
        details: { integration_id: requirement.integration_id, missing_scopes: scopeCheck.missing },
      });
    }
  }
}

function enforceToolScopeRequirements(toolName: string, contract: UiBootstrapContract): void {
  const requiredScopes = requiredGoogleScopesForTool(toolName);
  if (requiredScopes.length === 0) return;
  const google = contract.integration_status.find((entry) => entry.integration_id === "google_oauth");
  if (!google || google.state !== "connected") {
    throw new ToolExecutionError({
      code: "AUTH_REQUIRED",
      message: "Integration 'google_oauth' is not connected",
      status: 409,
    });
  }
  const scopeCheck = hasRequiredScopes(google.scopes, requiredScopes);
  if (!scopeCheck.ok) {
    throw new ToolExecutionError({
      code: "AUTH_SCOPE_MISSING",
      message: `Missing tool scope(s): ${scopeCheck.missing.join(", ")}`,
      status: 409,
      details: { integration_id: "google_oauth", missing_scopes: scopeCheck.missing, tool_name: toolName },
    });
  }
}

async function ensureRunExists(workspaceId: string, runId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const orchestrationRun = await supabase
    .from("orchestration_runs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();

  if (orchestrationRun.data?.id) return;

  const run = await supabase
    .from("runs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();

  if (run.data?.id) return;

  throw new ToolExecutionError({
    code: "RUN_NOT_FOUND",
    message: `Run '${runId}' not found in workspace`,
    status: 404,
  });
}

async function findIdempotentToolCall(input: {
  workspaceId: string;
  runId: string;
  toolName: string;
  idempotencyKey: string;
}): Promise<CachedToolCall | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("tool_calls")
    .select("id,status,request_json,input_json,response_json,output_json,error,error_message")
    .eq("workspace_id", input.workspaceId)
    .eq("run_id", input.runId)
    .eq("tool_name", input.toolName)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    throw new ToolExecutionError({
      code: "DB_WRITE_FAILED",
      message: `Failed to read tool_calls for idempotency: ${error.message}`,
      status: 500,
      retryable: true,
    });
  }

  for (const row of data ?? []) {
    const request = ensureRecord(row.request_json ?? row.input_json);
    const meta = ensureRecord(request._meta);
    if (meta.idempotency_key !== input.idempotencyKey) continue;

    return {
      id: String(row.id),
      status: String(row.status ?? ""),
      response_json: ensureRecord(row.response_json ?? row.output_json),
      error: typeof row.error === "string" ? row.error : typeof row.error_message === "string" ? row.error_message : null,
    };
  }

  return null;
}

async function insertToolCall(input: {
  id: string;
  workspaceId: string;
  runId: string;
  toolName: string;
  status: string;
  requestJson: Record<string, unknown>;
  responseJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  assertDataPlaneWrite("tool_calls");
  const nowIso = new Date().toISOString();

  const supabaseShape = {
    id: input.id,
    run_id: input.runId,
    run_step_id: null,
    workspace_id: input.workspaceId,
    tool_name: input.toolName,
    request_json: input.requestJson,
    response_json: input.responseJson ?? null,
    status: input.status,
    error: input.errorMessage ?? null,
    started_at: input.startedAt ?? nowIso,
    finished_at: input.finishedAt ?? null,
    created_at: nowIso,
  };

  let { error } = await supabase.from("tool_calls").insert(supabaseShape);
  if (!error) return;

  const workerShape = {
    id: input.id,
    run_id: input.runId,
    run_step_id: null,
    workspace_id: input.workspaceId,
    tool_name: input.toolName,
    input_json: input.requestJson,
    output_json: input.responseJson ?? null,
    status: input.status,
    error_code: input.errorMessage ? "execution_error" : null,
    error_message: input.errorMessage ?? null,
    started_at: input.startedAt ? Date.parse(input.startedAt) : Date.now(),
    finished_at: input.finishedAt ? Date.parse(input.finishedAt) : null,
    created_at: Date.now(),
    idempotency_key: String(ensureRecord(input.requestJson._meta).idempotency_key ?? ""),
    retry_count: 0,
    max_retries: 2,
    latency_ms: null,
    cost_cents: 0,
    token_count: 0,
  };

  ({ error } = await supabase.from("tool_calls").insert(workerShape));
  if (error) {
    throw new ToolExecutionError({
      code: "DB_WRITE_FAILED",
      message: `Failed to insert tool_call: ${error.message}`,
      status: 500,
      retryable: true,
    });
  }
}

async function updateToolCall(input: {
  id: string;
  status: string;
  responseJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  finishedAt?: string;
  latencyMs?: number;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  assertDataPlaneWrite("tool_calls");
  const finishedAt = input.finishedAt ?? new Date().toISOString();

  const supabaseUpdate = {
    status: input.status,
    response_json: input.responseJson ?? null,
    error: input.errorMessage ?? null,
    finished_at: finishedAt,
  };

  let { error } = await supabase.from("tool_calls").update(supabaseUpdate).eq("id", input.id);
  if (!error) return;

  const workerUpdate = {
    status: input.status,
    output_json: input.responseJson ?? null,
    error_code: input.errorMessage ? "execution_error" : null,
    error_message: input.errorMessage ?? null,
    finished_at: Date.parse(finishedAt),
    latency_ms: input.latencyMs ?? null,
  };

  ({ error } = await supabase.from("tool_calls").update(workerUpdate).eq("id", input.id));
  if (error) {
    throw new ToolExecutionError({
      code: "DB_WRITE_FAILED",
      message: `Failed to update tool_call: ${error.message}`,
      status: 500,
      retryable: true,
    });
  }
}

async function writeArtifacts(input: {
  workspaceId: string;
  runId: string;
  toolCallId: string;
  uiCardHint: string | null;
  artifacts: ToolExecutionArtifact[];
}): Promise<Array<{ id: string; kind: string; title: string; path: string | null; metadata: Record<string, unknown> }>> {
  const supabase = getSupabaseAdminClient();
  assertDataPlaneWrite("artifacts");
  assertDataPlaneWrite("os_tool_artifacts");
  const nowIso = new Date().toISOString();

  const results: Array<{ id: string; kind: string; title: string; path: string | null; metadata: Record<string, unknown> }> = [];

  for (const artifact of input.artifacts) {
    const id = randomUUID();
    const uiCardHint = String(input.uiCardHint ?? defaultUiCardHintForType(artifact.type)) as ArtifactUiCardHint;
    const metadata = {
      ...(artifact.metadata ?? {}),
      tool_call_id: input.toolCallId,
      ui_card_hint: uiCardHint,
    };
    const path = artifact.path ?? null;

    const supabaseShape = {
      id,
      workspace_id: input.workspaceId,
      run_id: input.runId,
      kind: artifact.type,
      title: artifact.title,
      path,
      latest_version: 1,
      meta_json: metadata,
      updated_at: nowIso,
    };

    let { error } = await supabase.from("artifacts").insert(supabaseShape);

    if (error) {
      const workerShape = {
        id,
        run_id: input.runId,
        workspace_id: input.workspaceId,
        type: artifact.type,
        ref: path,
        metadata_json: metadata,
        created_at: Date.now(),
      };
      ({ error } = await supabase.from("artifacts").insert(workerShape));
    }

    if (error) {
      throw new ToolExecutionError({
        code: "DB_WRITE_FAILED",
        message: `Failed to write artifact: ${error.message}`,
        status: 500,
        retryable: true,
      });
    }

    const { error: toolArtifactError } = await supabase.from("os_tool_artifacts").insert({
      workspace_id: input.workspaceId,
      run_id: input.runId,
      tool_call_id: input.toolCallId,
      artifact_type: artifact.type,
      title: artifact.title,
      ui_card_hint: uiCardHint,
      link_url: artifact.link_url ?? path,
      payload_json: metadata,
      metadata_json: metadata,
    });
    if (toolArtifactError && process.env.NODE_ENV !== "production") {
      console.warn("[tool-execution] os_tool_artifacts insert failed", toolArtifactError.message);
    }

    results.push({
      id,
      kind: artifact.type,
      title: artifact.title,
      path,
      metadata,
    });
  }

  return results;
}

function buildUiCardHint(input: {
  adapterHint: string | null;
  toolName: string;
  hasArtifacts: boolean;
}): string | null {
  if (input.adapterHint) return input.adapterHint;
  if (input.hasArtifacts) return "card.generic";
  if (input.toolName.startsWith("google_")) return "google_action";
  if (input.toolName.startsWith("weather")) return "card.weather_forecast";
  if (input.toolName.startsWith("translate")) return "card.translation_result";
  if (input.toolName.startsWith("web.")) return "card.research_report";
  return null;
}

function shouldRequireApproval(tool: ToolRegistryItem, manifest: AppManifest | undefined): { required: boolean; reason: string } {
  const policy = resolveApprovalMode(tool.risk_level, buildPolicyContext(manifest));
  const required = Boolean(tool.requires_approval) || requiresApproval(policy.mode);
  return {
    required,
    reason: required ? policy.reason : "Policy allows automatic execution",
  };
}

function toExecutionError(error: unknown): ToolExecutionError {
  if (error instanceof ToolExecutionError) return error;
  if (error instanceof RunnableToolError) {
    return new ToolExecutionError({
      code: error.code,
      message: error.safeMessage,
      status: error.status,
      retryable: error.retryable,
      details: error.details,
    });
  }
  return new ToolExecutionError({
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unexpected execution failure",
    status: 500,
    retryable: false,
    details: error,
  });
}

export async function executeToolCall(input: ExecuteToolRequest): Promise<ExecuteToolResult> {
  if (isWorkerBackboneMode()) {
    throw new ToolExecutionError({
      code: "INTERNAL_ERROR",
      message: "Local tool execution is disabled in SSOT mode.",
      status: 410,
      retryable: false,
    });
  }
  const startedAt = Date.now();
  const workspaceId = input.workspace_id;
  const runId = input.run_id;
  const requestedToolName = input.tool_name;
  const toolName = normalizeToolName(requestedToolName);

  await ensureRunExists(workspaceId, runId);

  const contract = await buildBootstrapContractFromDb(workspaceId, { seedIfMissing: true });
  const { tool, manifest } = getToolDefinition(contract, toolName);

  const cached = await findIdempotentToolCall({
    workspaceId,
    runId,
    toolName,
    idempotencyKey: input.idempotency_key,
  });

  if (cached) {
    if (cached.status === "running" || cached.status === "pending") {
      throw new ToolExecutionError({
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "An execution with this idempotency key is already in progress",
        status: 409,
      });
    }

    if (cached.status === "completed") {
      return {
        ok: true,
        status: "succeeded",
        tool_call_id: cached.id,
        idempotent_replay: true,
        result: cached.response_json ?? {},
        artifacts: [],
        ui_card_hint: buildUiCardHint({ adapterHint: null, toolName: requestedToolName, hasArtifacts: false }),
        retries: 0,
        latency_ms: 0,
      };
    }
  }

  const adapter = getAdapter(toolName);
  if (!adapter) {
    throw new ToolExecutionError({
      code: "TOOL_ADAPTER_MISSING",
      message: `No adapter implemented for tool '${requestedToolName}'`,
      status: 501,
    });
  }

  enforceIntegrationAuth(manifest, contract);
  enforceToolScopeRequirements(toolName, contract);

  const parsedArgs = adapter.inputSchema.safeParse(input.args);
  if (!parsedArgs.success) {
    throw new ToolExecutionError({
      code: "INVALID_ARGS",
      message: "Tool arguments failed schema validation",
      status: 400,
      details: parsedArgs.error.flatten(),
    });
  }

  const approval = shouldRequireApproval(tool, manifest);
  const toolCallId = randomUUID();
  const requestPayload = {
    args: parsedArgs.data,
    _meta: {
      idempotency_key: input.idempotency_key,
      requested_at: new Date().toISOString(),
    },
  };

  if (approval.required && !input.approval_granted) {
    await insertToolCall({
      id: toolCallId,
      workspaceId,
      runId,
      toolName,
      status: "pending",
      requestJson: requestPayload,
      errorMessage: "approval_required",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    return {
      ok: true,
      status: "waiting_for_approval",
      tool_call_id: toolCallId,
      error_code: "APPROVAL_REQUIRED",
      reason: approval.reason,
      ui_card_hint: "approval_required",
    };
  }

  await insertToolCall({
    id: toolCallId,
    workspaceId,
    runId,
    toolName,
    status: "running",
    requestJson: requestPayload,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  try {
    const execution = await executeWithRetries({
      adapter,
      workspaceId,
      runId,
      toolName,
      args: parsedArgs.data,
    });

    const writtenArtifacts = await writeArtifacts({
      workspaceId,
      runId,
      toolCallId,
      uiCardHint: execution.result.ui_card_hint ?? null,
      artifacts: execution.result.artifacts ?? [],
    });

    const output = execution.result.output;
    const latencyMs = Date.now() - startedAt;

    await updateToolCall({
      id: toolCallId,
      status: "completed",
      responseJson: output,
      latencyMs,
    });

    return {
      ok: true,
      status: "succeeded",
      tool_call_id: toolCallId,
      idempotent_replay: false,
      result: output,
      artifacts: writtenArtifacts,
      ui_card_hint: buildUiCardHint({
        adapterHint: execution.result.ui_card_hint ?? null,
        toolName: requestedToolName,
        hasArtifacts: writtenArtifacts.length > 0,
      }),
      retries: execution.retries,
      latency_ms: latencyMs,
    };
  } catch (error) {
    const executionError = toExecutionError(error);
    const failedAt = new Date().toISOString();

    await updateToolCall({
      id: toolCallId,
      status: "failed",
      responseJson: {
        error_code: executionError.code,
        details: ensureRecord(executionError.details),
      },
      errorMessage: executionError.message,
      finishedAt: failedAt,
      latencyMs: Date.now() - startedAt,
    });

    throw executionError;
  }
}

export function mapExecutionErrorToResponse(error: ToolExecutionError): {
  status: number;
  body: Record<string, unknown>;
} {
  if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_SCOPE_MISSING") {
    return {
      status: 409,
      body: {
        ok: true,
        status: "waiting_for_auth",
        error_code: error.code,
        reason: error.message,
        ui_card_hint: "needs_auth",
        retryable: false,
        details: error.details ?? null,
      },
    };
  }

  return {
    status: error.status,
    body: {
      ok: false,
      error_code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details ?? null,
    },
  };
}
