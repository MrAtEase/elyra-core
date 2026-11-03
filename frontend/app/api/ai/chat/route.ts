import { NextResponse } from "next/server";
import { execFile, ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * POST /api/ai/chat
 *
 * Multi-provider Elli chat endpoint with full tool-call loop + vibe coding.
 *
 * Providers:
 *  - "gemini"        — Gemini 2.5 Flash via direct API key (default)
 *  - "claude_direct" — Claude via direct Anthropic API (ANTHROPIC_API_KEY)
 *  - "claude_vertex" — Claude via Google Vertex AI (gcloud ADC)
 *  - "openai"        — OpenAI GPT-4o via direct API key
 *
 * Built-in Gemini tools: google_search, code_execution
 * Function-calling tools (all providers): see ELLI_TOOL_DECLARATIONS below
 * Vibe coding tools: file_read, file_search, file_write, vibe_code
 *
 * Body: {
 *   message: string
 *   provider?: "gemini" | "claude_direct" | "claude_vertex" | "openai"
 *   workspaceName?: string
 *   repoUrl?: string            // for vibe coding — defaults to ELYRA_REPO_URL env
 *   history?: Array<{role: "user"|"model"|"assistant", text: string}>
 *   preferences?: { personalityTone?: string, autonomy?: number, fullAccessMode?: boolean }
 *   enableTools?: boolean          // default: true
 *   enableCodeExecution?: boolean  // default: true (Gemini only)
 *   enableSearch?: boolean         // default: true (Gemini only)
 *   enableVibeCode?: boolean       // default: true — enables builder/vibe-code tools
 * }
 * Response: { text: string, model: string, provider: string }
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAT_TIMEOUT_MS = 60_000;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type ProviderType = "gemini" | "claude_direct" | "claude_vertex" | "openai";

// ── Tool name mapping (Elli underscore names → execution dot names) ────────────

const TOOL_NAME_MAP: Record<string, string> = {
  // Web & utilities
  web_search: "web.search",
  web_fetch: "web.fetch",
  vertex_search: "__inline__", // handled inline in executeTool
  weather_get: "weather.getForecast",
  translate_text: "translate.text",
  // Calendar
  calendar_list_events: "calendar.list",
  calendar_create_event: "calendar.create",
  // Gmail
  gmail_search: "gmail.search",
  gmail_send_draft: "gmail.createDraft",
  // Tasks
  tasks_list: "tasks.list",
  tasks_create: "tasks.create",
  // Google Drive
  drive_search: "drive.search_files",
  drive_create_folder: "drive.create_folder",
  drive_upload: "drive.upload",
  drive_move: "drive.move",
  // Google Slides
  slides_create: "slides.create_presentation",
  slides_update: "slides.batch_update",
  slides_export_pdf: "slides.export_pdf",
};

// ── Elli Tool Declarations (exposed to all LLMs as function calling) ──────────

const ELLI_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "web_search",
    description: "Search the web for current information, news, prices, weather, or any live data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        max_results: { type: "integer", description: "Max results (1-10)", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "weather_get",
    description: "Get current weather and forecast for a city or location.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name or address" },
        units: { type: "string", enum: ["metric", "imperial"], default: "metric" },
      },
      required: ["location"],
    },
  },
  {
    name: "translate_text",
    description: "Translate text from one language to another.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate" },
        target_lang: { type: "string", description: "Target language code (e.g. de, en, fr, es)" },
        source_lang: { type: "string", description: "Source language code (auto = detect)", default: "auto" },
      },
      required: ["text", "target_lang"],
    },
  },
  {
    name: "calendar_list_events",
    description: "List upcoming calendar events for a date range.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date-time ISO 8601" },
        to: { type: "string", description: "End date-time ISO 8601" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "calendar_create_event",
    description: "Create a new calendar event.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start_at: { type: "string", description: "ISO 8601 datetime" },
        end_at: { type: "string", description: "ISO 8601 datetime" },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
        description: { type: "string" },
      },
      required: ["title", "start_at", "end_at"],
    },
  },
  {
    name: "gmail_search",
    description: "Search Gmail for emails matching a query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query (e.g. 'from:alice subject:invoice')" },
        max_results: { type: "integer", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_send_draft",
    description: "Create a Gmail draft email. User must confirm before sending.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (markdown supported)" },
        thread_id: { type: "string", description: "Thread ID for replies (optional)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "tasks_list",
    description: "List tasks with optional status filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "blocked", "done"] },
      },
    },
  },
  {
    name: "tasks_create",
    description: "Create a new task.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3"], default: "p2" },
        due_at: { type: "string", description: "ISO 8601 datetime (optional)" },
        assignee: { type: "string", description: "Assignee name or email (optional)" },
      },
      required: ["title"],
    },
  },
  // ── Google Drive ─────────────────────────────────────────────────────────
  {
    name: "drive_search",
    description: "Search Google Drive for files, documents, presentations, or spreadsheets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'marketing plan 2026', 'filename:budget.xlsx')" },
        max_results: { type: "integer", default: 10 },
        file_type: { type: "string", description: "Filter by type: 'presentation', 'spreadsheet', 'document', 'pdf', 'folder'", enum: ["presentation", "spreadsheet", "document", "pdf", "folder", "any"], default: "any" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_create_folder",
    description: "Create a new folder in Google Drive.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Folder name" },
        parent_folder_id: { type: "string", description: "Optional parent folder ID (defaults to root)" },
      },
      required: ["name"],
    },
  },
  // ── Google Slides ─────────────────────────────────────────────────────────
  {
    name: "slides_create",
    description: "Create a new Google Slides presentation. Use for marketing decks, pitch decks, reports, and any slide content. The AI can generate slides content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the presentation" },
        template_theme: { type: "string", description: "Theme style: 'professional', 'modern', 'minimal', 'dark'", enum: ["professional", "modern", "minimal", "dark"], default: "professional" },
      },
      required: ["title"],
    },
  },
  {
    name: "slides_update",
    description: "Add slides, text, images, and layouts to an existing Google Slides presentation. Use to build out presentation content after creating it.",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string", description: "Google Slides presentation ID" },
        requests: {
          type: "array",
          description: "Array of Google Slides API batch update requests",
          items: { type: "object" },
        },
      },
      required: ["presentation_id", "requests"],
    },
  },
  {
    name: "slides_export_pdf",
    description: "Export a Google Slides presentation to PDF.",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string", description: "Google Slides presentation ID" },
      },
      required: ["presentation_id"],
    },
  },
  // ── Vertex AI Search ─────────────────────────────────────────────────────
  {
    name: "vertex_search",
    description: "Search across indexed documents, Google Drive files, and workspace knowledge base using Vertex AI Search (AI-powered semantic search with LLM summaries).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query in natural language" },
        max_results: { type: "integer", default: 5, description: "Number of results (1-10)" },
      },
      required: ["query"],
    },
  },
  // ── Vibe Coding / Builder Tools ───────────────────────────────────────────
  {
    name: "file_read",
    description: "Read the content of a source file in the project. Use to understand existing code before making changes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path from project root (e.g. 'frontend/components/Button.tsx')",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "file_search",
    description: "Search for code patterns or text across all project files using ripgrep. Returns matching lines with file paths.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term or regex pattern" },
        glob: { type: "string", description: "File glob filter (e.g. '*.tsx', '**/*.ts'). Optional." },
        max_results: { type: "integer", description: "Max lines to return (default 40)", default: 40 },
      },
      required: ["query"],
    },
  },
  {
    name: "file_write",
    description: "Write or overwrite a file with new content. Use for creating new files or replacing small files entirely.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path from project root" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "vibe_code",
    description:
      "Run the AI vibe-coding pipeline: describe a code change in natural language and Elli will generate and apply a unified diff patch. Use for refactoring, adding features, fixing bugs across multiple files. Returns a summary of what was changed.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Natural language description of the code change to make (e.g. 'Add a loading spinner to the SubmitButton component')",
        },
        scope: {
          type: "string",
          description:
            "Folder scope within the project to limit search (e.g. 'frontend/components', 'frontend/app/os'). Optional — leave empty for full project.",
        },
        provider: {
          type: "string",
          description: "AI provider for code generation: 'gemini' (default), 'claude_direct', 'openai'",
          enum: ["gemini", "claude_direct", "openai"],
        },
      },
      required: ["task"],
    },
  },
];

// ── Vibe coding tool executor (inline, does not use /api/os/tools/execute) ─────

const VIBE_REPO_ROOT = process.env.ELYRA_REPO_ROOT ?? path.resolve(process.cwd(), "..");

/** Guard: path must stay within VIBE_REPO_ROOT */
function safeResolvePath(relPath: string): string | null {
  const resolved = path.resolve(VIBE_REPO_ROOT, relPath);
  if (!resolved.startsWith(VIBE_REPO_ROOT + path.sep) && resolved !== VIBE_REPO_ROOT) {
    return null; // path traversal attempt
  }
  return resolved;
}

async function vibeToolFileRead(args: Record<string, unknown>): Promise<string> {
  const relPath = typeof args.path === "string" ? args.path : null;
  if (!relPath) return "Error: path is required";
  const abs = safeResolvePath(relPath);
  if (!abs) return "Error: path traversal not allowed";
  try {
    const content = await fs.readFile(abs, "utf-8");
    const lines = content.split("\n");
    if (lines.length > 300) {
      return lines.slice(0, 300).join("\n") + `\n\n... (truncated — ${lines.length} total lines)`;
    }
    return content;
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function vibeToolFileSearch(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query : null;
  if (!query) return "Error: query is required";
  const glob = typeof args.glob === "string" ? args.glob : undefined;
  const maxResults = typeof args.max_results === "number" ? args.max_results : 40;

  return new Promise<string>((resolve) => {
    const rgArgs = [
      "--line-number",
      "--no-heading",
      "--max-count", String(maxResults),
      ...(glob ? ["--glob", glob] : []),
      query,
      VIBE_REPO_ROOT,
    ];

    execFile("rg", rgArgs, { timeout: 10_000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        // Try grep fallback
        const grepArgs = ["-r", "-n", "--include", glob ?? "*", query, VIBE_REPO_ROOT];
        execFile("grep", grepArgs, { timeout: 10_000, maxBuffer: 512 * 1024 }, (err2, stdout2) => {
          const lines = (stdout2 || "").split("\n").filter(Boolean).slice(0, maxResults);
          resolve(lines.length > 0 ? lines.join("\n") : "(No matches found)");
        });
        return;
      }
      const lines = stdout.split("\n").filter(Boolean).slice(0, maxResults);
      resolve(lines.length > 0 ? lines.join("\n") : "(No matches found)");
    });
  });
}

async function vibeToolFileWrite(args: Record<string, unknown>): Promise<string> {
  const relPath = typeof args.path === "string" ? args.path : null;
  const content = typeof args.content === "string" ? args.content : null;
  if (!relPath || content === null) return "Error: path and content are required";
  const abs = safeResolvePath(relPath);
  if (!abs) return "Error: path traversal not allowed";
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    return `✓ Written ${content.split("\n").length} lines to ${relPath}`;
  } catch (err) {
    return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function vibeToolVibeCode(
  args: Record<string, unknown>,
  context: { origin: string; repoUrl: string }
): Promise<string> {
  const task = typeof args.task === "string" ? args.task : null;
  if (!task) return "Error: task is required";
  const scope = typeof args.scope === "string" ? args.scope : "";
  const provider = typeof args.provider === "string" ? args.provider : "gemini";

  try {
    const resp = await fetch(`${context.origin}/api/os/code/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
      },
      body: JSON.stringify({
        prompt: task,
        repoUrl: context.repoUrl,
        folderPath: scope || "",
        stage: "dev",
        role: "frontend",
        provider,
        agentRole: "frontend",
        selectedFiles: [],
        autonomy: 0.7,
        returnDiffOnly: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      return `Vibe code failed: ${err.error ?? `HTTP ${resp.status}`}`;
    }

    const result = await resp.json() as {
      ok?: boolean;
      summary?: string;
      diff?: string;
      error?: string;
      filesChanged?: string[];
      linesAdded?: number;
      linesRemoved?: number;
    };

    if (!result.ok && result.error) {
      return `Vibe code error: ${result.error}`;
    }

    const parts: string[] = [];
    if (result.summary) parts.push(result.summary);
    if (result.filesChanged?.length) {
      parts.push(`Files changed: ${result.filesChanged.join(", ")}`);
    }
    if (result.linesAdded !== undefined) {
      parts.push(`+${result.linesAdded} / -${result.linesRemoved ?? 0} lines`);
    }
    if (parts.length === 0 && result.diff) {
      parts.push(`Patch applied:\n\`\`\`diff\n${result.diff.slice(0, 1000)}\n\`\`\``);
    }
    return parts.join("\n") || "✓ Code changes applied successfully";
  } catch (err) {
    return `Vibe code error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Vertex AI Search (Discovery Engine) ──────────────────────────────────────

async function vertexSearch(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query : null;
  if (!query) return "Error: query is required";
  const maxResults = typeof args.max_results === "number" ? args.max_results : 5;

  const projectId = process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "elyra-core-dev-app";
  const engineId = process.env.VERTEX_SEARCH_ENGINE_ID ?? "elyra-search-engine";
  const dataStoreId = process.env.VERTEX_SEARCH_DATA_STORE_ID ?? "elyra-drive-search";

  try {
    const token = await getAdcToken();
    const url = `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/global/collections/default_collection/engines/${engineId}/servingConfigs/default_search:search`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": projectId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        pageSize: maxResults,
        queryExpansionSpec: { condition: "AUTO" },
        spellCorrectionSpec: { mode: "AUTO" },
        contentSearchSpec: {
          summarySpec: {
            summaryResultCount: maxResults,
            includeCitations: true,
            ignoreAdversarialQuery: true,
            modelSpec: { version: "gemini-1.5-flash" },
          },
          snippetSpec: { returnSnippet: true },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const err = await resp.json() as { error?: { message?: string } };
      return `Vertex Search error: ${err.error?.message ?? `HTTP ${resp.status}`}`;
    }

    const data = await resp.json() as {
      results?: Array<{ document?: { derivedStructData?: { title?: string; link?: string; snippets?: Array<{ snippet?: string }> } } }>;
      summary?: { summaryText?: string };
    };

    const summary = data.summary?.summaryText;
    const results = (data.results ?? []).slice(0, maxResults).map((r) => {
      const d = r.document?.derivedStructData ?? {};
      const title = d.title ?? "Untitled";
      const link = d.link ?? "";
      const snippet = d.snippets?.[0]?.snippet ?? "";
      return `• ${title}${link ? ` (${link})` : ""}: ${snippet}`;
    });

    const parts: string[] = [];
    if (summary) parts.push(`Summary: ${summary}`);
    if (results.length > 0) parts.push(`Results:\n${results.join("\n")}`);
    return parts.join("\n\n") || "(No results found)";
  } catch (err) {
    return `Vertex Search error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Tool execution (routes to /api/os/tools/execute or inline for vibe tools) ──

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { origin: string; repoUrl: string }
): Promise<string> {
  // Inline vibe coding tools (bypass /api/os/tools/execute)
  if (name === "file_read") return vibeToolFileRead(args);
  if (name === "file_search") return vibeToolFileSearch(args);
  if (name === "file_write") return vibeToolFileWrite(args);
  if (name === "vibe_code") return vibeToolVibeCode(args, context);

  // Inline Vertex AI Search
  if (name === "vertex_search") return vertexSearch(args);

  // Map Elli tool names to execution tool names
  const executionName = TOOL_NAME_MAP[name] ?? name;

  try {
    const resp = await fetch(`${context.origin}/api/os/tools/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
      body: JSON.stringify({
        workspace_id: "elli-chat",
        run_id: `chat-${Date.now()}`,
        tool_name: executionName,
        args,
        idempotency_key: `chat-tool-${name}-${Date.now()}`,
        approval_granted: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await resp.json() as Record<string, unknown>;
    if (result.error || result.error_code) {
      return `Tool ${name} error: ${result.error ?? result.error_code}`;
    }
    return JSON.stringify(result.result ?? result, null, 2).slice(0, 2000);
  } catch (err) {
    return `Tool ${name} unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

let _adcTokenCache: { value: string; expiresAt: number } | null = null;

type GoogleCreds = {
  type?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

async function exchangeServiceAccountJwt(creds: GoogleCreds): Promise<string | null> {
  if (!creds.client_email || !creds.private_key) return null;
  const tokenUrl = creds.token_uri ?? "https://oauth2.googleapis.com/token";
  const { createSign } = await import("node:crypto");
  const now2 = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claimsB64 = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUrl,
    exp: now2 + 3600,
    iat: now2,
  })).toString("base64url");
  const unsigned = `${header}.${claimsB64}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const sig = sign.sign(creds.private_key, "base64url");
  const jwt = `${unsigned}.${sig}`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    cache: "no-store",
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function tokenFromCreds(creds: GoogleCreds, now: number): Promise<string | null> {
  if (creds.type === "service_account") {
    const token = await exchangeServiceAccountJwt(creds);
    if (token) {
      _adcTokenCache = { value: token, expiresAt: now + 3500 * 1000 };
      return token;
    }
  }
  if (creds.type === "authorized_user" && creds.client_id && creds.client_secret && creds.refresh_token) {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token, grant_type: "refresh_token" }).toString(),
      cache: "no-store",
    });
    if (resp.ok) {
      const data = (await resp.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        _adcTokenCache = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
        return data.access_token;
      }
    }
  }
  return null;
}

async function getAdcToken(): Promise<string> {
  const now = Date.now();
  if (_adcTokenCache && now < _adcTokenCache.expiresAt - 90_000) return _adcTokenCache.value;

  // 1. Try inline JSON from env (works on Vercel / any serverless environment)
  const inlineJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    process.env.VERTEX_SERVICE_ACCOUNT_JSON ??
    "";
  if (inlineJson.trim().startsWith("{")) {
    try {
      const creds = JSON.parse(inlineJson) as GoogleCreds;
      const token = await tokenFromCreds(creds, now);
      if (token) return token;
    } catch { /* fall through */ }
  }

  // 2. Try credentials file (local dev / GCE)
  const credsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    `${process.env.HOME ?? ""}/.config/gcloud/application_default_credentials.json`;
  try {
    const raw = await fs.readFile(credsPath, "utf-8");
    const creds = JSON.parse(raw) as GoogleCreds;
    const token = await tokenFromCreds(creds, now);
    if (token) return token;
  } catch { /* fall through */ }

  // 3. Fallback: gcloud CLI (local dev only)
  return new Promise((resolve, reject) => {
    execFile("gcloud", ["auth", "print-access-token"], { timeout: 10_000 }, (err: ExecFileException | null, stdout: string) => {
      if (err) return reject(new Error(`gcloud: ${err.message}`));
      const token = stdout.trim();
      if (!token) return reject(new Error("gcloud returned empty token"));
      _adcTokenCache = { value: token, expiresAt: now + 55 * 60 * 1000 };
      resolve(token);
    });
  });
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  workspaceName: string | undefined;
  personalityTone: string;
  autonomyLevel: number;
  fullAccessMode: boolean;
  enableTools: boolean;
  enableVibeCode: boolean;
}): string {
  const tone =
    opts.personalityTone === "pragmatic"
      ? "Pragmatisch, präzise, senior-engineer-artig. Keine Floskeln."
      : opts.personalityTone === "friendly"
        ? "Freundlich, direkt, kollaborativ. Kurz und klar."
        : "Professionell, klar, handlungsorientiert.";

  const autonomy =
    opts.autonomyLevel < 25
      ? "Konservativ: frage bei Aktionen aktiv nach."
      : opts.autonomyLevel < 50
        ? "Geführt: schlage Schritte vor, bestätige Änderungen."
        : opts.autonomyLevel < 75
          ? "Proaktiv: führe Routinen ohne Rückfrage aus."
          : "Autonom: plan und führe selbstständig aus, frage nur bei High-Risk.";

  const toolHint = opts.enableTools
    ? "Nutze Tools aktiv: web_search für aktuelle Daten, calendar/gmail/tasks für Aktionen, slides_create für Präsentationen und Marketing-Decks, drive_search für Dokumente suchen, vibe_code für Code-Änderungen."
    : "";

  const vibeCodeHint = opts.enableVibeCode
    ? "Vibe-Coding: nutze file_read/file_search um Code zu verstehen, vibe_code um Änderungen anzuwenden. Lies zuerst relevante Dateien, dann wende Änderungen an."
    : "";

  return [
    `Du bist Elli, die intelligente KI-Assistentin im Elyra OS${opts.workspaceName ? ` (Workspace: ${opts.workspaceName})` : ""}.`,
    "Antworte auf Deutsch wenn der User Deutsch schreibt, sonst auf Englisch.",
    "Kurze, direkte Antworten — keine unnötigen Einleitungen.",
    `Ton: ${tone}`,
    `Autonomie: ${autonomy}`,
    toolHint,
    vibeCodeHint,
    opts.fullAccessMode
      ? "Full Access: nutze Tools maximal. Melde riskante Aktionen (Deploy, Billing) vor Ausführung."
      : "",
  ].filter(Boolean).join(" ");
}

// ── Gemini provider ───────────────────────────────────────────────────────────

async function callGeminiChat(opts: {
  system: string;
  contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }>;
  apiKey: string;
  enableSearch: boolean;
  enableCodeExecution: boolean;
  enableTools: boolean;
  enableVibeCode: boolean;
  origin: string;
  repoUrl: string;
}): Promise<string> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${opts.apiKey}`;

  // Build active tool declarations
  const activeDecls = opts.enableVibeCode
    ? ELLI_TOOL_DECLARATIONS
    : ELLI_TOOL_DECLARATIONS.filter((t) => !["file_read", "file_search", "file_write", "vibe_code"].includes(t.name));

  // Gemini constraint: built-in tools (google_search, code_execution) cannot be combined
  // with custom functionDeclarations in the same request. Must choose one mode:
  //   A) Custom tools mode  → functionDeclarations only (web_search is a declared function)
  //   B) Built-in tools mode → google_search + code_execution (no function declarations)
  const tools: Record<string, unknown>[] = [];
  if (opts.enableTools) {
    // Mode A: functionDeclarations only — web_search is already a declared tool
    tools.push({
      functionDeclarations: activeDecls.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    });
  } else {
    // Mode B: built-in tools only
    if (opts.enableSearch) tools.push({ google_search: {} });
    if (opts.enableCodeExecution) tools.push({ code_execution: {} });
  }

  const body = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: opts.contents,
    ...(tools.length > 0 ? { tools } : {}),
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  };

  // Agentic loop: handle function calls
  let currentContents = [...opts.contents];
  for (let iteration = 0; iteration < 5; iteration++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, contents: currentContents }), signal: controller.signal });
    } finally { clearTimeout(timer); }

    const data = await resp.json() as {
      candidates?: Array<{
        content?: { parts?: Array<Record<string, unknown>>; role?: string };
        finishReason?: string;
      }>;
      error?: { message?: string };
    };

    if (!resp.ok || data.error) throw new Error(data.error?.message ?? `Gemini HTTP ${resp.status}`);

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const finishReason = candidate?.finishReason ?? "";

    // Collect text parts
    const textParts = parts.filter((p) => typeof p.text === "string" && (p.text as string).trim());
    const functionCalls = parts.filter((p) => p.functionCall && typeof p.functionCall === "object");

    if (functionCalls.length === 0) {
      // No tool calls — extract and return text
      if (textParts.length > 0) {
        return textParts.map((p) => p.text as string).join("").trim();
      }
      // Handle finishReason = MAX_TOKENS with only thinking tokens
      if (finishReason === "MAX_TOKENS" || finishReason === "OTHER") {
        return "(Antwort zu lang abgeschnitten — bitte Frage präzisieren)";
      }
      return "(Keine Antwort erhalten)";
    }

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      functionCalls.map(async (call) => {
        const fc = call.functionCall as { name: string; args?: Record<string, unknown> };
        const result = await executeTool(fc.name, fc.args ?? {}, { origin: opts.origin, repoUrl: opts.repoUrl });
        return { functionResponse: { name: fc.name, response: { output: result } } };
      })
    );

    // Append model turn + tool results to conversation
    currentContents = [
      ...currentContents,
      { role: "model", parts: [...textParts, ...functionCalls] },
      { role: "user" as const, parts: toolResults },
    ];
  }

  return "(Tool-Loop limit erreicht)";
}

// ── Claude provider (Direct + Vertex) ────────────────────────────────────────

type ClaudeMessage = { role: "user" | "assistant"; content: string | Array<Record<string, unknown>> };

async function callClaudeChat(opts: {
  system: string;
  messages: ClaudeMessage[];
  enableTools: boolean;
  enableVibeCode: boolean;
  provider: "claude_direct" | "claude_vertex";
  origin: string;
  repoUrl: string;
}): Promise<string> {
  let url: string;
  let authHeader: Record<string, string>;

  if (opts.provider === "claude_direct") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    url = ANTHROPIC_API;
    authHeader = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  } else {
    const projectId = process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error("VERTEX_PROJECT_ID not configured");
    const location = process.env.VERTEX_LOCATION ?? "global";
    const model = process.env.VERTEX_CLAUDE_MODEL ?? "claude-sonnet-4-6";
    const token = await getAdcToken();
    url =
      location === "global"
        ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/anthropic/models/${model}:rawPredict`
        : `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/anthropic/models/${model}:rawPredict`;
    authHeader = { Authorization: `Bearer ${token}` };
  }

  // Build active tool declarations
  const activeDecls = opts.enableVibeCode
    ? ELLI_TOOL_DECLARATIONS
    : ELLI_TOOL_DECLARATIONS.filter((t) => !["file_read", "file_search", "file_write", "vibe_code"].includes(t.name));

  const claudeTools = opts.enableTools
    ? activeDecls.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    : undefined;

  const model =
    opts.provider === "claude_direct"
      ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250908")
      : (process.env.VERTEX_CLAUDE_MODEL ?? "claude-sonnet-4-6");

  const baseBody: Record<string, unknown> = {
    system: opts.system,
    max_tokens: 2048,
    temperature: 0.7,
    ...(claudeTools ? { tools: claudeTools } : {}),
  };

  if (opts.provider === "claude_vertex") {
    (baseBody as Record<string, unknown>).anthropic_version = "vertex-2023-10-16";
  } else {
    (baseBody as Record<string, unknown>).model = model;
  }

  let messages = [...opts.messages];

  // Agentic tool loop
  for (let iteration = 0; iteration < 5; iteration++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ...baseBody, messages }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }

    if (resp.status === 429 && iteration < 2) {
      await new Promise<void>((r) => setTimeout(r, 20_000));
      continue;
    }

    const data = await resp.json() as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      error?: { message?: string };
      stop_reason?: string;
    };

    if (!resp.ok || data.error) throw new Error(data.error?.message ?? `Claude HTTP ${resp.status}`);

    const content = data.content ?? [];
    const textBlocks = content.filter((b) => b.type === "text" && b.text?.trim());
    const toolBlocks = content.filter((b) => b.type === "tool_use");

    if (toolBlocks.length === 0) {
      return textBlocks.map((b) => b.text ?? "").join("").trim() || "(Keine Antwort)";
    }

    // Execute tools
    const toolResults = await Promise.all(
      toolBlocks.map(async (tb) => {
        const result = await executeTool(tb.name ?? "", tb.input ?? {}, { origin: opts.origin, repoUrl: opts.repoUrl });
        return { type: "tool_result", tool_use_id: tb.id ?? "", content: result };
      })
    );

    messages = [
      ...messages,
      { role: "assistant", content },
      { role: "user", content: toolResults },
    ];
  }

  return "(Tool-Loop limit erreicht)";
}

// ── OpenAI provider ───────────────────────────────────────────────────────────

async function callOpenAIChat(opts: {
  system: string;
  messages: Array<{ role: string; content: string }>;
  enableTools: boolean;
  enableVibeCode: boolean;
  origin: string;
  repoUrl: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

  // Build active tool declarations
  const activeDecls = opts.enableVibeCode
    ? ELLI_TOOL_DECLARATIONS
    : ELLI_TOOL_DECLARATIONS.filter((t) => !["file_read", "file_search", "file_write", "vibe_code"].includes(t.name));

  const openAiTools = opts.enableTools
    ? activeDecls.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
    : undefined;

  let messages = [{ role: "system", content: opts.system }, ...opts.messages];

  for (let iteration = 0; iteration < 5; iteration++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(OPENAI_CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, ...(openAiTools ? { tools: openAiTools, tool_choice: "auto" } : {}), temperature: 0.7, max_tokens: 2048 }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }

    const data = await resp.json() as {
      choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>;
      error?: { message?: string };
    };

    if (!resp.ok || data.error) throw new Error(data.error?.message ?? `OpenAI HTTP ${resp.status}`);

    const msg = data.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return (msg?.content ?? "").trim() || "(Keine Antwort)";
    }

    // Execute tool calls
    const toolMessages: Array<{ role: string; tool_call_id: string; content: string }> = await Promise.all(
      toolCalls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* ignore */ }
        const result = await executeTool(tc.function.name, args, { origin: opts.origin, repoUrl: opts.repoUrl });
        return { role: "tool", tool_call_id: tc.id, content: result };
      })
    );

    messages = [
      ...messages,
      { role: "assistant", content: msg?.content ?? null, tool_calls: toolCalls } as Record<string, unknown>,
      ...toolMessages,
    ] as typeof messages;
  }

  return "(Tool-Loop limit erreicht)";
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: {
    message?: string;
    provider?: string;
    workspaceName?: string;
    repoUrl?: string;
    history?: Array<{ role: string; text: string }>;
    preferences?: Record<string, unknown>;
    enableTools?: boolean;
    enableCodeExecution?: boolean;
    enableSearch?: boolean;
    enableVibeCode?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, workspaceName, history, preferences } = body;
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Resolve provider
  const rawProvider = (body.provider ?? "gemini").toLowerCase();
  const provider: ProviderType =
    rawProvider === "claude_direct" || rawProvider === "claude" ? "claude_direct"
    : rawProvider === "claude_vertex" ? "claude_vertex"
    : rawProvider === "openai" ? "openai"
    : "gemini";

  // Check provider is configured
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
  }
  if ((provider === "claude_direct") && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured. Add it to .env.local (console.anthropic.com)" }, { status: 503 });
  }
  if (provider === "claude_vertex" && !process.env.VERTEX_PROJECT_ID) {
    return NextResponse.json({ error: "VERTEX_PROJECT_ID not configured" }, { status: 503 });
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
  }

  // Preferences
  const personalityTone = typeof preferences?.personalityTone === "string" ? preferences.personalityTone : "professional";
  const autonomyLevel = typeof preferences?.autonomy === "number" ? Math.max(0, Math.min(100, preferences.autonomy)) : 45;
  const fullAccessMode = preferences?.fullAccessMode === true;
  const enableTools = body.enableTools !== false;
  const enableSearch = body.enableSearch !== false;
  const enableCodeExecution = body.enableCodeExecution !== false;
  const enableVibeCode = body.enableVibeCode !== false;

  // Repo URL for vibe coding
  const repoUrl = body.repoUrl ?? process.env.ELYRA_REPO_URL ?? "local://elyra-core";

  const system = buildSystemPrompt({ workspaceName, personalityTone, autonomyLevel, fullAccessMode, enableTools, enableVibeCode });

  // Derive request origin for tool execution
  const origin = req.headers.get("origin") ?? req.headers.get("x-forwarded-host") ?? "http://localhost:3000";

  try {
    let text = "";
    let modelLabel = "";

    if (provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY!;
      const geminiHistory = (history ?? [])
        .filter((h) => h.role === "user" || h.role === "model")
        .map((h) => ({ role: h.role as "user" | "model", parts: [{ text: h.text }] }));
      geminiHistory.push({ role: "user", parts: [{ text: message }] });

      text = await callGeminiChat({ system, contents: geminiHistory, apiKey, enableSearch, enableCodeExecution, enableTools, enableVibeCode, origin, repoUrl });
      modelLabel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    } else if (provider === "claude_direct" || provider === "claude_vertex") {
      const claudeHistory: ClaudeMessage[] = (history ?? [])
        .filter((h) => h.role === "user" || h.role === "assistant" || h.role === "model")
        .map((h) => ({ role: (h.role === "model" ? "assistant" : h.role) as "user" | "assistant", content: h.text }));
      claudeHistory.push({ role: "user", content: message });

      text = await callClaudeChat({ system, messages: claudeHistory, enableTools, enableVibeCode, provider, origin, repoUrl });
      modelLabel = provider === "claude_direct"
        ? (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250908")
        : (process.env.VERTEX_CLAUDE_MODEL ?? "claude-sonnet-4-6");
    } else {
      // OpenAI
      const oaiHistory = (history ?? [])
        .filter((h) => h.role === "user" || h.role === "assistant" || h.role === "model")
        .map((h) => ({ role: h.role === "model" ? "assistant" : h.role, content: h.text }));
      oaiHistory.push({ role: "user", content: message });

      text = await callOpenAIChat({ system, messages: oaiHistory, enableTools, enableVibeCode, origin, repoUrl });
      modelLabel = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";
    }

    return NextResponse.json({ text, model: modelLabel, provider });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[/api/ai/chat] ${provider} error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
