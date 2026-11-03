/*
 * Vision 2035 Cloud Workspace OS runtime (v1).
 * Runs-first execution with strict policy gate, approvals, audit, and quotas.
 */
import { handleV1OsRequest } from "./cloudOsV2";

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type SessionLike = {
  session: { active_workspace_id: string | null };
  user: { id: string; email: string | null };
};

type CloudEnv = {
  ASSISTANT_DB: D1Database;
};

type JsonHeaders = Record<string, string>;

type PolicyConfig = {
  allow_tools: string[];
  http_request: {
    allowed_hosts: string[];
    allowed_methods: string[];
    require_approval_methods: string[];
    require_approval_hosts: string[];
    deny_private_ips: boolean;
    timeout_ms: number;
    max_response_bytes: number;
    redact_headers: string[];
  };
};

type QuotaConfig = {
  requests_per_day: number;
  tokens_per_day: number;
  cost_cents_per_day: number;
};

type UsageDaily = {
  requests_count: number;
  tokens_count: number;
  cost_cents: number;
};

type RunStatus =
  | "queued"
  | "running"
  | "needs_approval"
  | "succeeded"
  | "failed"
  | "canceled";

type ToolRequest = {
  tool: "http_request";
  request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

type CreateRunBody = {
  prompt: string;
  tool_call?: ToolRequest;
};

const DEFAULT_POLICY: PolicyConfig = {
  allow_tools: ["http_request"],
  http_request: {
    allowed_hosts: ["api.github.com"],
    allowed_methods: ["GET", "HEAD"],
    require_approval_methods: ["POST", "DELETE"],
    require_approval_hosts: [],
    deny_private_ips: true,
    timeout_ms: 10000,
    max_response_bytes: 262144,
    redact_headers: ["authorization", "cookie", "set-cookie"],
  },
};

const DEFAULT_QUOTA: QuotaConfig = {
  requests_per_day: 1000,
  tokens_per_day: 500000,
  cost_cents_per_day: 50000,
};

function nowMs(): number {
  return Date.now();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(data: unknown, status = 200, extra: JsonHeaders = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function correlationIdFromRunId(runId: string): string {
  return `corr-${runId}`;
}

function digestText(value: string): Promise<string> {
  const enc = new TextEncoder();
  return crypto.subtle.digest("SHA-256", enc.encode(value)).then((buffer) => {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  });
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^\[::1\]$/.test(host)) return true;
  if (/^fc/i.test(host) || /^fd/i.test(host)) return true;
  return false;
}

function normalizeMethod(value: string | undefined): string {
  return (value || "GET").trim().toUpperCase();
}

function estimateTokens(input: string): number {
  return Math.max(1, Math.ceil(input.length / 4));
}

function estimateCostCents(tokens: number): number {
  return Math.max(1, Math.ceil(tokens * 0.002));
}

async function ensureVisionWorkspaceMembership(db: D1Database, userId: string): Promise<string> {
  // Prefer ws-elyra-core (the Elli platform workspace), fall back to vision-2035 for legacy
  const platform = await db
    .prepare("SELECT id FROM workspaces WHERE slug = 'ws-elyra-core' OR slug = 'vision-2035' ORDER BY CASE slug WHEN 'ws-elyra-core' THEN 0 ELSE 1 END LIMIT 1")
    .first<{ id: string }>();

  const now = nowMs();
  const workspaceId = platform?.id ?? crypto.randomUUID();

  if (!platform) {
    await db
      .prepare(
        "INSERT INTO workspaces (id, slug, type, name, created_at, created_by_user_id, brand_json) VALUES (?1, 'ws-elyra-core', 'system_platform', 'Elyra Core', ?2, ?3, ?4)"
      )
      .bind(workspaceId, now, userId, '{"productName":"Elyra Core","assistantName":"Elli","workspaceLabel":"Elli","accentColor":"#6C9CFC","themeMode":"dark"}')
      .run();
  }

  const membership = await db
    .prepare("SELECT id FROM memberships WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1")
    .bind(workspaceId, userId)
    .first<{ id: string }>();

  if (!membership) {
    await db
      .prepare("INSERT INTO memberships (id, user_id, workspace_id, role, title, created_at) VALUES (?1, ?2, ?3, 'system_owner', 'Admin', ?4)")
      .bind(crypto.randomUUID(), userId, workspaceId, now)
      .run();
  }

  // Only set default workspace if user does not already have one
  await db
    .prepare("UPDATE users SET default_workspace_id = ?1 WHERE id = ?2 AND default_workspace_id IS NULL")
    .bind(workspaceId, userId)
    .run();

  return workspaceId;
}

async function audit(
  db: D1Database,
  input: {
    workspaceId: string;
    userId: string;
    action: string;
    domain: string;
    resourceId?: string | null;
    confirmationEventId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    )
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.userId,
      input.action,
      input.domain,
      input.resourceId ?? null,
      input.confirmationEventId ?? null,
      JSON.stringify(input.metadata ?? {}),
      nowMs()
    )
    .run();
}

async function loadPolicy(db: D1Database, workspaceId: string): Promise<PolicyConfig> {
  const row = await db
    .prepare("SELECT policy_json FROM workspace_policies WHERE workspace_id = ?1 LIMIT 1")
    .bind(workspaceId)
    .first<{ policy_json: string }>();
  return safeJsonParse(row?.policy_json ?? null, DEFAULT_POLICY);
}

async function loadQuota(db: D1Database, workspaceId: string): Promise<QuotaConfig> {
  const row = await db
    .prepare(
      "SELECT requests_per_day, tokens_per_day, cost_cents_per_day FROM workspace_quotas WHERE workspace_id = ?1 LIMIT 1"
    )
    .bind(workspaceId)
    .first<QuotaConfig>();
  return row ?? DEFAULT_QUOTA;
}

async function loadUsageDaily(db: D1Database, workspaceId: string, userId: string, day: string): Promise<UsageDaily> {
  const row = await db
    .prepare(
      "SELECT requests_count, tokens_count, cost_cents FROM usage_daily WHERE workspace_id = ?1 AND user_id = ?2 AND day_utc = ?3 LIMIT 1"
    )
    .bind(workspaceId, userId, day)
    .first<UsageDaily>();
  return row ?? { requests_count: 0, tokens_count: 0, cost_cents: 0 };
}

async function writeUsageDaily(
  db: D1Database,
  workspaceId: string,
  userId: string,
  day: string,
  usage: UsageDaily
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO usage_daily (id, workspace_id, user_id, day_utc, requests_count, tokens_count, cost_cents, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(workspace_id, user_id, day_utc) DO UPDATE SET requests_count = excluded.requests_count, tokens_count = excluded.tokens_count, cost_cents = excluded.cost_cents, updated_at = excluded.updated_at"
    )
    .bind(crypto.randomUUID(), workspaceId, userId, day, usage.requests_count, usage.tokens_count, usage.cost_cents, nowMs())
    .run();
}

function redactHeaders(headers: Record<string, string> | undefined, redactKeys: string[]): Record<string, string> {
  const source = headers ?? {};
  const redact = new Set(redactKeys.map((item) => item.toLowerCase()));
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, value]) => {
    out[key] = redact.has(key.toLowerCase()) ? "[REDACTED]" : value;
  });
  return out;
}

type PolicyCheckResult =
  | { ok: true; approvalRequired: false }
  | { ok: true; approvalRequired: true }
  | { ok: false; code: string; message: string };

function checkHttpRequestPolicy(policy: PolicyConfig, req: ToolRequest["request"]): PolicyCheckResult {
  const parsed = (() => {
    try {
      return new URL(req.url);
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return { ok: false, code: "policy_denied", message: "Invalid URL" };
  }

  if (!policy.allow_tools.includes("http_request")) {
    return { ok: false, code: "policy_denied", message: "Tool not allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!policy.http_request.allowed_hosts.map((item) => item.toLowerCase()).includes(host)) {
    return { ok: false, code: "policy_denied", message: "Host not allowlisted" };
  }

  const method = normalizeMethod(req.method);
  if (!policy.http_request.allowed_methods.includes(method)) {
    return { ok: false, code: "policy_denied", message: "Method not allowed" };
  }

  if (policy.http_request.deny_private_ips && isPrivateHostname(host)) {
    return { ok: false, code: "policy_denied", message: "Private network access denied" };
  }

  const approvalRequired =
    policy.http_request.require_approval_methods.includes(method) ||
    policy.http_request.require_approval_hosts.map((item) => item.toLowerCase()).includes(host);

  return { ok: true, approvalRequired };
}

async function executeHttpRequest(
  policy: PolicyConfig,
  requestPayload: ToolRequest["request"]
): Promise<{
  status: "succeeded" | "failed";
  errorCode?: string;
  response?: {
    status: number;
    headers: Record<string, string>;
    body_preview: string;
    body_size: number;
  };
}> {
  const method = normalizeMethod(requestPayload.method);
  const timeoutMs = Math.max(1000, policy.http_request.timeout_ms);
  const maxBytes = Math.max(1024, policy.http_request.max_response_bytes);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(requestPayload.url, {
      method,
      headers: requestPayload.headers,
      body: requestPayload.body,
      signal: controller.signal,
    });

    const clone = response.clone();
    const buffer = await clone.arrayBuffer();
    const bodySize = buffer.byteLength;
    if (bodySize > maxBytes) {
      return { status: "failed", errorCode: "tool_response_too_large" };
    }

    const text = new TextDecoder().decode(buffer);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: "succeeded",
      response: {
        status: response.status,
        headers,
        body_preview: text.slice(0, 4000),
        body_size: bodySize,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "failed", errorCode: "tool_timeout" };
    }
    return { status: "failed", errorCode: "tool_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function setRunStatus(
  db: D1Database,
  runId: string,
  status: RunStatus,
  patch?: { errorCode?: string | null; errorMessage?: string | null; pendingConfirmationEventId?: string | null }
): Promise<void> {
  const finishedAt = status === "succeeded" || status === "failed" || status === "canceled" ? nowMs() : null;
  await db
    .prepare(
      "UPDATE runs SET status = ?1, error_code = COALESCE(?2, error_code), error_message = COALESCE(?3, error_message), pending_confirmation_event_id = ?4, finished_at = COALESCE(?5, finished_at), updated_at = ?6 WHERE id = ?7"
    )
    .bind(status, patch?.errorCode ?? null, patch?.errorMessage ?? null, patch?.pendingConfirmationEventId ?? null, finishedAt, nowMs(), runId)
    .run();
}

async function createRunStep(
  db: D1Database,
  input: {
    runId: string;
    workspaceId: string;
    stepType: "llm" | "tool" | "decision";
    status: string;
    summary: string;
    inputHash?: string | null;
    outputHash?: string | null;
    correlationId: string;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  const now = nowMs();
  await db
    .prepare(
      "INSERT INTO run_steps (id, run_id, workspace_id, step_type, status, summary, input_hash, output_hash, correlation_id, started_at, finished_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
    )
    .bind(
      id,
      input.runId,
      input.workspaceId,
      input.stepType,
      input.status,
      input.summary,
      input.inputHash ?? null,
      input.outputHash ?? null,
      input.correlationId,
      now,
      input.status === "running" || input.status === "waiting_approval" ? null : now,
      now
    )
    .run();
  return id;
}

async function updateStepStatus(db: D1Database, stepId: string, status: string, summary?: string): Promise<void> {
  await db
    .prepare("UPDATE run_steps SET status = ?1, summary = COALESCE(?2, summary), finished_at = ?3 WHERE id = ?4")
    .bind(status, summary ?? null, nowMs(), stepId)
    .run();
}

async function createToolCall(
  db: D1Database,
  input: {
    runId: string;
    runStepId: string;
    workspaceId: string;
    method: string;
    host: string;
    request: Record<string, unknown>;
    status: string;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  const now = nowMs();
  await db
    .prepare(
      "INSERT INTO tool_calls (id, run_id, run_step_id, workspace_id, tool_name, host, method, request_json, response_json, status, error_code, started_at, finished_at, created_at) VALUES (?1, ?2, ?3, ?4, 'http_request', ?5, ?6, ?7, NULL, ?8, NULL, ?9, NULL, ?10)"
    )
    .bind(id, input.runId, input.runStepId, input.workspaceId, input.host, input.method, JSON.stringify(input.request), input.status, now, now)
    .run();
  return id;
}

async function finalizeToolCall(
  db: D1Database,
  toolCallId: string,
  status: string,
  responseJson: Record<string, unknown> | null,
  errorCode?: string
): Promise<void> {
  await db
    .prepare("UPDATE tool_calls SET status = ?1, response_json = ?2, error_code = ?3, finished_at = ?4 WHERE id = ?5")
    .bind(status, responseJson ? JSON.stringify(responseJson) : null, errorCode ?? null, nowMs(), toolCallId)
    .run();
}

async function createApprovalEvent(
  db: D1Database,
  input: {
    workspaceId: string;
    userId: string;
    runId: string;
    stepId: string;
    toolCallId: string;
    method: string;
    host: string;
    request: Record<string, unknown>;
  }
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const now = nowMs();
  const proposal = {
    kind: "run_tool_call",
    run_id: input.runId,
    step_id: input.stepId,
    tool_call_id: input.toolCallId,
    method: input.method,
    host: input.host,
    request: input.request,
  };

  await db
    .prepare(
      "INSERT INTO confirmation_events (id, workspace_id, user_id, action_type, target, proposal_json, state, created_at, expires_at) VALUES (?1, ?2, ?3, 'execute', 'http_request', ?4, 'pending', ?5, ?6)"
    )
    .bind(id, input.workspaceId, input.userId, JSON.stringify(proposal), now, now + 24 * 60 * 60 * 1000)
    .run();

  return id;
}

async function runToolExecution(
  db: D1Database,
  input: {
    runId: string;
    stepId: string;
    toolCallId: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
    policy: PolicyConfig;
    requestPayload: ToolRequest["request"];
  }
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  await audit(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "tool_called",
    domain: "runs",
    resourceId: input.runId,
    metadata: { stepId: input.stepId, toolCallId: input.toolCallId, correlationId: input.correlationId },
  });

  const exec = await executeHttpRequest(input.policy, input.requestPayload);
  if (exec.status === "failed") {
    await finalizeToolCall(db, input.toolCallId, "failed", null, exec.errorCode ?? "tool_failed");
    await updateStepStatus(db, input.stepId, "failed", `Tool failed: ${exec.errorCode ?? "tool_failed"}`);
    await setRunStatus(db, input.runId, "failed", {
      errorCode: exec.errorCode ?? "tool_failed",
      errorMessage: "Tool execution failed",
      pendingConfirmationEventId: null,
    });
    await audit(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "step_failed",
      domain: "runs",
      resourceId: input.runId,
      metadata: {
        stepId: input.stepId,
        toolCallId: input.toolCallId,
        errorCode: exec.errorCode ?? "tool_failed",
        correlationId: input.correlationId,
      },
    });
    return { ok: false, code: exec.errorCode ?? "tool_failed", message: "Tool execution failed" };
  }

  await finalizeToolCall(db, input.toolCallId, "succeeded", exec.response ?? null);
  await updateStepStatus(db, input.stepId, "succeeded", "Tool call completed");
  await setRunStatus(db, input.runId, "succeeded", { pendingConfirmationEventId: null });

  await audit(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "step_finished",
    domain: "runs",
    resourceId: input.runId,
    metadata: {
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      outcome: "succeeded",
      correlationId: input.correlationId,
    },
  });

  return { ok: true };
}

async function handleCreateRun(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  let body: CreateRunBody;
  try {
    body = (await request.json()) as CreateRunBody;
  } catch {
    return json({ ok: false, error: "invalid_body", message: "JSON body required" }, 400);
  }

  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return json({ ok: false, error: "invalid_prompt", message: "prompt is required" }, 400);
  }

  const quota = await loadQuota(db, workspaceId);
  const day = todayUtc();
  const usage = await loadUsageDaily(db, workspaceId, resolved.user.id, day);

  const estimatedTokens = estimateTokens(prompt);
  const estimatedCost = estimateCostCents(estimatedTokens);

  if (usage.requests_count + 1 > quota.requests_per_day || usage.tokens_count + estimatedTokens > quota.tokens_per_day || usage.cost_cents + estimatedCost > quota.cost_cents_per_day) {
    const now = nowMs();
    const runId = crypto.randomUUID();
    const correlationId = correlationIdFromRunId(runId);

    await db
      .prepare(
        "INSERT INTO runs (id, workspace_id, user_id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'failed', 'quota_exceeded', 'Daily quota exceeded', ?6, ?6, NULL, NULL, 0, 0, ?6, ?6)"
      )
      .bind(runId, workspaceId, resolved.user.id, correlationId, prompt, now)
      .run();

    await audit(db, {
      workspaceId,
      userId: resolved.user.id,
      action: "quota_hit",
      domain: "runs",
      resourceId: runId,
      metadata: { correlationId, day },
    });

    return json({ ok: false, error: "quota_exceeded", run: { id: runId, status: "failed", error_code: "quota_exceeded", correlation_id: correlationId } }, 429);
  }

  usage.requests_count += 1;
  usage.tokens_count += estimatedTokens;
  usage.cost_cents += estimatedCost;
  await writeUsageDaily(db, workspaceId, resolved.user.id, day, usage);

  const runId = crypto.randomUUID();
  const correlationId = correlationIdFromRunId(runId);
  const now = nowMs();

  await db
    .prepare(
      "INSERT INTO runs (id, workspace_id, user_id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'running', NULL, NULL, ?6, NULL, NULL, NULL, ?7, ?8, ?6, ?6)"
    )
    .bind(runId, workspaceId, resolved.user.id, correlationId, prompt, now, estimatedTokens, estimatedCost)
    .run();

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "run_created",
    domain: "runs",
    resourceId: runId,
    metadata: { correlationId },
  });

  const promptHash = await digestText(prompt);
  const llmStepId = await createRunStep(db, {
    runId,
    workspaceId,
    stepType: "llm",
    status: "succeeded",
    summary: "Prompt accepted and execution context prepared",
    inputHash: promptHash,
    outputHash: await digestText("execution_context_ready"),
    correlationId,
  });

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "step_finished",
    domain: "runs",
    resourceId: runId,
    metadata: { stepId: llmStepId, stepType: "llm", correlationId },
  });

  const toolCall = body.tool_call;
  if (!toolCall) {
    await setRunStatus(db, runId, "succeeded");
    return json({ ok: true, run: { id: runId, status: "succeeded", correlation_id: correlationId } }, 201);
  }

  if (toolCall.tool !== "http_request") {
    await setRunStatus(db, runId, "failed", {
      errorCode: "policy_denied",
      errorMessage: "Tool denied",
      pendingConfirmationEventId: null,
    });
    await audit(db, {
      workspaceId,
      userId: resolved.user.id,
      action: "step_failed",
      domain: "runs",
      resourceId: runId,
      metadata: { errorCode: "policy_denied", message: "Unsupported tool", correlationId },
    });
    return json({ ok: false, error: "policy_denied", run: { id: runId, status: "failed", correlation_id: correlationId } }, 403);
  }

  const policy = await loadPolicy(db, workspaceId);
  const method = normalizeMethod(toolCall.request.method);
  const host = (() => {
    try {
      return new URL(toolCall.request.url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const check = checkHttpRequestPolicy(policy, toolCall.request);
  if (!check.ok) {
    const stepId = await createRunStep(db, {
      runId,
      workspaceId,
      stepType: "decision",
      status: "failed",
      summary: check.message,
      inputHash: await digestText(JSON.stringify(toolCall.request)),
      outputHash: await digestText(check.code),
      correlationId,
    });
    await setRunStatus(db, runId, "failed", {
      errorCode: check.code,
      errorMessage: check.message,
      pendingConfirmationEventId: null,
    });
    await audit(db, {
      workspaceId,
      userId: resolved.user.id,
      action: "step_failed",
      domain: "runs",
      resourceId: runId,
      metadata: { stepId, errorCode: check.code, message: check.message, correlationId },
    });
    return json({ ok: false, error: check.code, run: { id: runId, status: "failed", correlation_id: correlationId } }, 403);
  }

  const requestRecord = {
    url: toolCall.request.url,
    method,
    headers: redactHeaders(toolCall.request.headers, policy.http_request.redact_headers),
    body: toolCall.request.body ? "[REDACTED_OR_INLINE]" : null,
  };

  const stepId = await createRunStep(db, {
    runId,
    workspaceId,
    stepType: "tool",
    status: check.approvalRequired ? "waiting_approval" : "running",
    summary: check.approvalRequired ? "Awaiting approval" : "Executing http_request",
    inputHash: await digestText(JSON.stringify(requestRecord)),
    outputHash: null,
    correlationId,
  });

  const toolCallId = await createToolCall(db, {
    runId,
    runStepId: stepId,
    workspaceId,
    method,
    host,
    request: requestRecord,
    status: check.approvalRequired ? "pending_approval" : "running",
  });

  if (check.approvalRequired) {
    const decisionStepId = await createRunStep(db, {
      runId,
      workspaceId,
      stepType: "decision",
      status: "waiting_approval",
      summary: "Approval required by policy",
      inputHash: await digestText(`${method}:${host}`),
      outputHash: null,
      correlationId,
    });
    const approvalEventId = await createApprovalEvent(db, {
      workspaceId,
      userId: resolved.user.id,
      runId,
      stepId,
      toolCallId,
      method,
      host,
      request: requestRecord,
    });
    await setRunStatus(db, runId, "needs_approval", { pendingConfirmationEventId: approvalEventId });

    await audit(db, {
      workspaceId,
      userId: resolved.user.id,
      action: "approval_requested",
      domain: "runs",
      resourceId: runId,
      confirmationEventId: approvalEventId,
      metadata: { stepId, decisionStepId, toolCallId, method, host, correlationId },
    });

    return json(
      {
        ok: true,
        run: {
          id: runId,
          status: "needs_approval",
          correlation_id: correlationId,
          pending_approval_id: approvalEventId,
        },
      },
      201
    );
  }

  const exec = await runToolExecution(db, {
    runId,
    stepId,
    toolCallId,
    workspaceId,
    userId: resolved.user.id,
    correlationId,
    policy,
    requestPayload: toolCall.request,
  });

  if (!exec.ok) {
    return json({ ok: false, error: exec.code, run: { id: runId, status: "failed", correlation_id: correlationId } }, 502);
  }

  return json({ ok: true, run: { id: runId, status: "succeeded", correlation_id: correlationId } }, 201);
}

async function handleGetRun(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  const run = await db
    .prepare(
      "SELECT id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at FROM runs WHERE id = ?1 AND workspace_id = ?2 LIMIT 1"
    )
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();

  if (!run) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  const steps = await db
    .prepare(
      "SELECT id, step_type, status, summary, input_hash, output_hash, correlation_id, started_at, finished_at, created_at FROM run_steps WHERE run_id = ?1 ORDER BY created_at ASC"
    )
    .bind(runId)
    .all<Record<string, unknown>>();

  const toolCalls = await db
    .prepare(
      "SELECT id, run_step_id, tool_name, host, method, status, error_code, request_json, response_json, started_at, finished_at, created_at FROM tool_calls WHERE run_id = ?1 ORDER BY created_at ASC"
    )
    .bind(runId)
    .all<Record<string, unknown>>();

  return json({ ok: true, run, steps: steps.results ?? [], tool_calls: (toolCalls.results ?? []).map((entry: Record<string, unknown>) => ({
    ...entry,
    request_json: safeJsonParse(entry.request_json as string | null, null),
    response_json: safeJsonParse(entry.response_json as string | null, null),
  })) });
}

async function handleListRuns(env: CloudEnv, resolved: SessionLike, request: Request): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  const rows = await db
    .prepare(
      "SELECT id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at FROM runs WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2"
    )
    .bind(workspaceId, limit)
    .all<Record<string, unknown>>();

  return json({ ok: true, runs: rows.results ?? [] });
}

async function handleCancelRun(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  const existing = await db
    .prepare("SELECT id, status FROM runs WHERE id = ?1 AND workspace_id = ?2 LIMIT 1")
    .bind(runId, workspaceId)
    .first<{ id: string; status: string }>();

  if (!existing) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (existing.status === "succeeded" || existing.status === "failed" || existing.status === "canceled") {
    return json({ ok: true, run: { id: runId, status: existing.status } });
  }

  await db
    .prepare("UPDATE runs SET status = 'canceled', canceled_at = ?1, finished_at = ?1, updated_at = ?1 WHERE id = ?2")
    .bind(nowMs(), runId)
    .run();

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "run_canceled",
    domain: "runs",
    resourceId: runId,
    metadata: {},
  });

  return json({ ok: true, run: { id: runId, status: "canceled" } });
}

async function handleApproveRun(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  const run = await db
    .prepare(
      "SELECT id, status, correlation_id, pending_confirmation_event_id FROM runs WHERE id = ?1 AND workspace_id = ?2 LIMIT 1"
    )
    .bind(runId, workspaceId)
    .first<{ id: string; status: string; correlation_id: string; pending_confirmation_event_id: string | null }>();

  if (!run) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (run.status !== "needs_approval" || !run.pending_confirmation_event_id) {
    return json({ ok: false, error: "invalid_state", message: "Run does not wait for approval" }, 409);
  }

  const event = await db
    .prepare(
      "SELECT id, state, proposal_json FROM confirmation_events WHERE id = ?1 AND workspace_id = ?2 LIMIT 1"
    )
    .bind(run.pending_confirmation_event_id, workspaceId)
    .first<{ id: string; state: string; proposal_json: string }>();

  if (!event) {
    return json({ ok: false, error: "approval_not_found" }, 404);
  }

  if (event.state !== "pending") {
    return json({ ok: false, error: "approval_already_resolved" }, 409);
  }

  const proposal = safeJsonParse<{
    run_id: string;
    step_id: string;
    tool_call_id: string;
    method: string;
    host: string;
    request: ToolRequest["request"];
  }>(event.proposal_json, {
    run_id: runId,
    step_id: "",
    tool_call_id: "",
    method: "GET",
    host: "",
    request: { url: "" },
  });

  if (!proposal.tool_call_id || !proposal.step_id) {
    return json({ ok: false, error: "approval_payload_invalid" }, 500);
  }

  await db
    .prepare("UPDATE confirmation_events SET state = 'confirmed', confirmed_at = ?1 WHERE id = ?2")
    .bind(nowMs(), event.id)
    .run();

  await db
    .prepare("UPDATE tool_calls SET status = 'running', started_at = ?1 WHERE id = ?2")
    .bind(nowMs(), proposal.tool_call_id)
    .run();

  await db
    .prepare("UPDATE run_steps SET status = 'running', summary = 'Approval granted, executing tool' WHERE id = ?1")
    .bind(proposal.step_id)
    .run();

  await setRunStatus(db, runId, "running", { pendingConfirmationEventId: null });

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "approval_granted",
    domain: "runs",
    resourceId: runId,
    confirmationEventId: event.id,
    metadata: { stepId: proposal.step_id, toolCallId: proposal.tool_call_id, correlationId: run.correlation_id },
  });

  const policy = await loadPolicy(db, workspaceId);
  const execution = await runToolExecution(db, {
    runId,
    stepId: proposal.step_id,
    toolCallId: proposal.tool_call_id,
    workspaceId,
    userId: resolved.user.id,
    correlationId: run.correlation_id,
    policy,
    requestPayload: proposal.request,
  });

  if (!execution.ok) {
    return json({ ok: false, error: execution.code, run: { id: runId, status: "failed" } }, 502);
  }

  return json({ ok: true, run: { id: runId, status: "succeeded" } });
}

async function handleListApprovals(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);
  const rows = await db
    .prepare(
      "SELECT id, user_id, action_type, target, proposal_json, state, created_at, expires_at, confirmed_at FROM confirmation_events WHERE workspace_id = ?1 AND state = 'pending' ORDER BY created_at DESC"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    approvals: (rows.results ?? []).map((entry: Record<string, unknown>) => ({
      ...entry,
      proposal_json: safeJsonParse(entry.proposal_json as string | null, null),
    })),
  });
}

async function handleListAudit(env: CloudEnv, resolved: SessionLike, request: Request): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);
  const url = new URL(request.url);
  const user = url.searchParams.get("user");
  const tool = url.searchParams.get("tool");
  const outcome = url.searchParams.get("outcome");
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") || "100")));

  let query = "SELECT id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at FROM audit_log WHERE workspace_id = ?1";
  const bindValues: Array<string | number | null> = [workspaceId];

  if (user) {
    query += " AND user_id = ?" + (bindValues.length + 1);
    bindValues.push(user);
  }

  if (tool) {
    query += " AND metadata_json LIKE ?" + (bindValues.length + 1);
    bindValues.push(`%${tool}%`);
  }

  if (outcome) {
    query += " AND metadata_json LIKE ?" + (bindValues.length + 1);
    bindValues.push(`%${outcome}%`);
  }

  query += " ORDER BY created_at DESC LIMIT ?" + (bindValues.length + 1);
  bindValues.push(limit);

  const rows = await db.prepare(query).bind(...bindValues).all<Record<string, unknown>>();

  return json({
    ok: true,
    audit: (rows.results ?? []).map((entry: Record<string, unknown>) => ({
      ...entry,
      metadata_json: safeJsonParse(entry.metadata_json as string | null, null),
    })),
  });
}

async function handleGetUsage(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);
  const day = todayUtc();
  const quota = await loadQuota(db, workspaceId);
  const usage = await loadUsageDaily(db, workspaceId, resolved.user.id, day);
  return json({
    ok: true,
    day_utc: day,
    usage,
    quota,
    remaining: {
      requests: Math.max(0, quota.requests_per_day - usage.requests_count),
      tokens: Math.max(0, quota.tokens_per_day - usage.tokens_count),
      cost_cents: Math.max(0, quota.cost_cents_per_day - usage.cost_cents),
    },
  });
}

async function handleGetWindowLayout(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  const row = await db
    .prepare("SELECT layout_json, updated_at FROM window_layouts WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1")
    .bind(workspaceId, resolved.user.id)
    .first<{ layout_json: string; updated_at: number }>();

  return json({ ok: true, workspace_id: workspaceId, layout: safeJsonParse(row?.layout_json ?? null, null), updated_at: row?.updated_at ?? null });
}

async function handlePutWindowLayout(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await ensureVisionWorkspaceMembership(db, resolved.user.id);

  let body: { layout?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  if (body.layout === undefined) {
    return json({ ok: false, error: "invalid_layout", message: "layout is required" }, 400);
  }

  const updatedAt = nowMs();
  await db
    .prepare(
      "INSERT INTO window_layouts (id, workspace_id, user_id, layout_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(workspace_id, user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at"
    )
    .bind(crypto.randomUUID(), workspaceId, resolved.user.id, JSON.stringify(body.layout), updatedAt)
    .run();

  return json({ ok: true, workspace_id: workspaceId, updated_at: updatedAt });
}

export async function handleV1Request(request: Request, env: CloudEnv, resolved: SessionLike | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/")) {
    return null;
  }

  const v2Response = await handleV1OsRequest(request, env, resolved);
  if (v2Response) {
    return v2Response;
  }

  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated" }, 401);
  }

  if (url.pathname === "/v1/runs" && request.method === "POST") {
    return handleCreateRun(request, env, resolved);
  }

  if (url.pathname === "/v1/runs" && request.method === "GET") {
    return handleListRuns(env, resolved, request);
  }

  const runMatch = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]+)$/);
  if (runMatch && request.method === "GET") {
    return handleGetRun(env, resolved, runMatch[1]);
  }

  const cancelMatch = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]+)\/cancel$/);
  if (cancelMatch && request.method === "POST") {
    return handleCancelRun(env, resolved, cancelMatch[1]);
  }

  const approveMatch = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]+)\/approve$/);
  if (approveMatch && request.method === "POST") {
    return handleApproveRun(env, resolved, approveMatch[1]);
  }

  if (url.pathname === "/v1/approvals" && request.method === "GET") {
    return handleListApprovals(env, resolved);
  }

  if (url.pathname === "/v1/audit" && request.method === "GET") {
    return handleListAudit(env, resolved, request);
  }

  if (url.pathname === "/v1/usage" && request.method === "GET") {
    return handleGetUsage(env, resolved);
  }

  return json({ ok: false, error: "not_found" }, 404);
}

export async function ensureVisionWorkspaceForUser(db: D1Database, userId: string): Promise<string> {
  return ensureVisionWorkspaceMembership(db, userId);
}
