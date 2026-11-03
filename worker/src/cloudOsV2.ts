/*
 * Vision 2035 Cloud Workspace OS runtime (v2).
 * Implements Phase 1-4 orchestration primitives:
 * - Persistent runs + queue worker + retries/idempotency/cancel/resume
 * - Tool registry + permissions + approvals + budgets
 * - Memory + graph + eval harness
 * - Delegation + federation + goals
 */

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

type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type CloudEnv = {
  ASSISTANT_DB: D1Database;
  ASSISTANT_KV?: KVNamespace;
  ASSISTANT_OS_MAINTENANCE_MODE?: string;
  ASSISTANT_OS_WORKER_ENABLED?: string;
  ASSISTANT_OS_PROXY_SECRET?: string;
  ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE?: string;
  INTERNAL_API_SECRET?: string;
  /** URL of the Next.js app — used for token bridge calls (e.g. http://localhost:3000 in dev) */
  APP_ORIGIN?: string;
  /** Shared secret for internal server-to-server token bridge requests */
  ELYRA_INTERNAL_SECRET?: string;
};

type RunStatus =
  | "queued"
  | "ready"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

type QueueStatus = "queued" | "leased" | "done" | "dead_letter";

type RiskLevel = "read_only" | "writes" | "destructive";

type ToolDefinition = {
  name: string;
  description: string;
  input_schema_json: string;
  output_schema_json: string;
  risk_level: RiskLevel;
  version: string;
  is_enabled: number;
};

type ToolPermission = {
  allowed: number;
  requires_approval: number;
};

type OsPlanNode = {
  id: string;
  type: "tool" | "decision" | "checkpoint";
  tool_name?: string;
  input?: Record<string, unknown>;
  depends_on?: string[];
  condition?: Record<string, unknown>;
  max_retries?: number;
};

type OsPlanEdge = {
  from: string;
  to: string;
  type: "depends" | "conditional";
  condition?: Record<string, unknown>;
};

type OsPlan = {
  version: number;
  nodes: OsPlanNode[];
  edges: OsPlanEdge[];
};

function nowMs(): number {
  return Date.now();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function shouldVerifyProxySignature(env: CloudEnv): boolean {
  return (env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE || "").trim() === "1" || Boolean(resolveProxySecret(env));
}

function resolveProxySecret(env: CloudEnv): string {
  return (env.ASSISTANT_OS_PROXY_SECRET || env.INTERNAL_API_SECRET || "").trim();
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function signProxyPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64(new Uint8Array(signature));
}

async function verifyProxySignature(request: Request, env: CloudEnv): Promise<Response | null> {
  if (!shouldVerifyProxySignature(env)) return null;

  const secret = resolveProxySecret(env);
  if (!secret) {
    return json({ ok: false, error: "proxy_signing_misconfigured" }, 503);
  }

  const tsHeader = request.headers.get("x-elyra-proxy-ts");
  const nonce = request.headers.get("x-elyra-proxy-nonce");
  const signature = request.headers.get("x-elyra-proxy-signature");

  if (!tsHeader || !nonce || !signature) {
    return json({ ok: false, error: "invalid_proxy_signature", message: "Missing proxy signature headers." }, 401);
  }

  const timestamp = Number(tsHeader);
  if (!Number.isFinite(timestamp)) {
    return json({ ok: false, error: "invalid_proxy_signature", message: "Invalid proxy timestamp." }, 401);
  }

  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) {
    return json({ ok: false, error: "invalid_proxy_signature", message: "Proxy signature expired." }, 401);
  }

  const bodyString =
    request.method === "POST" || request.method === "PUT" || request.method === "PATCH"
      ? await request.clone().text()
      : "";
  const bodyHash = await sha256(bodyString);
  const url = new URL(request.url);
  const canonicalPath = `${url.pathname}${url.search}`;
  const canonical = `${normalizeMethod(request.method)}\n${canonicalPath}\n${tsHeader}\n${nonce}\n${bodyHash}`;
  const expected = await signProxyPayload(secret, canonical);

  if (!safeEqual(expected, signature)) {
    return json({ ok: false, error: "invalid_proxy_signature", message: "Proxy signature mismatch." }, 401);
  }

  return null;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const arr = new Uint8Array(digest);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeMethod(method: string | undefined): string {
  return (method || "GET").trim().toUpperCase();
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1") return true;
  return false;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function estimateCostCents(tokens: number): number {
  return Math.max(1, Math.ceil(tokens * 0.002));
}

function buildFallbackPlan(intentText: string): OsPlan {
  return {
    version: 1,
    edges: [{ from: "n1", to: "n2", type: "depends" }],
    nodes: [
      {
        id: "n1",
        type: "tool",
        tool_name: "artifact_create",
        input: {
          type: "intent",
          ref: null,
          metadata: { intent_text: intentText, source: "fallback_planner" },
        },
      },
      {
        id: "n2",
        type: "tool",
        tool_name: "memory_write",
        input: {
          type: "summary",
          content: `Intent observed: ${intentText}`,
          confidence: 0.55,
        },
      },
    ],
  };
}

function buildPlanFromBody(body: Record<string, unknown>): OsPlan {
  const candidate = safeJsonParse<OsPlan>(
    typeof body.plan_json === "string" ? body.plan_json : null,
    { version: 1, nodes: [], edges: [] }
  );

  if (candidate.nodes.length > 0) {
    return {
      version: Number(candidate.version || 1),
      nodes: candidate.nodes.map((node) => ({
        ...node,
        id: String(node.id),
        type: node.type,
        tool_name: node.tool_name,
        input: node.input || {},
        depends_on: Array.isArray(node.depends_on) ? node.depends_on.map(String) : [],
      })),
      edges: Array.isArray(candidate.edges) ? candidate.edges : [],
    };
  }

  const nodes = Array.isArray(body.nodes) ? (body.nodes as Record<string, unknown>[]) : [];
  if (nodes.length === 0) {
    return buildFallbackPlan(String(body.intent_text || ""));
  }

  const normalizedNodes = nodes.map((node, index): OsPlanNode => ({
    id: String(node.id || `n${index + 1}`),
    type: (node.type as OsPlanNode["type"]) || "tool",
    tool_name: typeof node.tool_name === "string" ? node.tool_name : undefined,
    input: (node.input as Record<string, unknown>) || {},
    depends_on: Array.isArray(node.depends_on) ? node.depends_on.map((v) => String(v)) : [],
    condition: typeof node.condition === "object" && node.condition ? (node.condition as Record<string, unknown>) : undefined,
    max_retries: typeof node.max_retries === "number" ? node.max_retries : 3,
  }));

  const edges = normalizedNodes.flatMap((node) =>
    (node.depends_on || []).map((dependency): OsPlanEdge => ({ from: dependency, to: node.id, type: "depends" }))
  );

  return {
    version: 1,
    nodes: normalizedNodes,
    edges,
  };
}

async function getActiveWorkspaceId(db: D1Database, resolved: SessionLike): Promise<string | null> {
  const fromSession = resolved.session.active_workspace_id;
  if (fromSession) {
    const membership = await db
      .prepare("SELECT workspace_id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1")
      .bind(resolved.user.id, fromSession)
      .first<{ workspace_id: string }>();
    if (membership?.workspace_id) return membership.workspace_id;
  }

  const firstMembership = await db
    .prepare("SELECT workspace_id FROM memberships WHERE user_id = ?1 ORDER BY created_at ASC LIMIT 1")
    .bind(resolved.user.id)
    .first<{ workspace_id: string }>();

  return firstMembership?.workspace_id || null;
}

async function getMembershipRole(db: D1Database, workspaceId: string, userId: string): Promise<string> {
  const row = await db
    .prepare("SELECT role FROM memberships WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1")
    .bind(workspaceId, userId)
    .first<{ role: string }>();
  return row?.role || "viewer";
}

async function audit(
  db: D1Database,
  input: {
    workspaceId: string;
    userId: string;
    action: string;
    domain: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)"
    )
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.userId,
      input.action,
      input.domain,
      input.resourceId || null,
      JSON.stringify(input.metadata || {}),
      nowMs()
    )
    .run();
}

async function persistGraph(db: D1Database, workspaceId: string, runId: string, plan: OsPlan): Promise<void> {
  const ts = nowMs();
  for (const node of plan.nodes) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO run_graph_nodes (id, run_id, workspace_id, node_key, node_type, tool_name, status, input_json, output_artifact_id, condition_json, depends_on_json, started_at, finished_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL, ?8, ?9, NULL, NULL, ?10, ?10)"
      )
      .bind(
        crypto.randomUUID(),
        runId,
        workspaceId,
        node.id,
        node.type,
        node.tool_name || null,
        JSON.stringify(node.input || {}),
        node.condition ? JSON.stringify(node.condition) : null,
        JSON.stringify(node.depends_on || []),
        ts
      )
      .run();
  }

  for (const edge of plan.edges) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO run_graph_edges (id, run_id, workspace_id, from_node_key, to_node_key, edge_type, condition_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
      )
      .bind(
        crypto.randomUUID(),
        runId,
        workspaceId,
        edge.from,
        edge.to,
        edge.type,
        edge.condition ? JSON.stringify(edge.condition) : null,
        ts
      )
      .run();
  }
}

async function enqueueRun(db: D1Database, runId: string, workspaceId: string, userId: string): Promise<void> {
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO orchestration_queue (id, run_id, workspace_id, user_id, status, available_at, lease_until, worker_id, priority, attempt_count, max_attempts, last_error_code, last_error_message, created_at, updated_at) VALUES (COALESCE((SELECT id FROM orchestration_queue WHERE run_id = ?1), lower(hex(randomblob(16)))), ?1, ?2, ?3, 'queued', ?4, NULL, NULL, 100, COALESCE((SELECT attempt_count FROM orchestration_queue WHERE run_id = ?1), 0), 10, NULL, NULL, COALESCE((SELECT created_at FROM orchestration_queue WHERE run_id = ?1), ?4), ?4) ON CONFLICT(run_id) DO UPDATE SET status = 'queued', available_at = excluded.available_at, lease_until = NULL, worker_id = NULL, updated_at = excluded.updated_at"
    )
    .bind(runId, workspaceId, userId, ts)
    .run();
}

async function upsertRunNodeStatus(
  db: D1Database,
  runId: string,
  nodeKey: string,
  status: string,
  patch?: { outputArtifactId?: string | null }
): Promise<void> {
  await db
    .prepare(
      "UPDATE run_graph_nodes SET status = ?1, output_artifact_id = COALESCE(?2, output_artifact_id), finished_at = CASE WHEN ?1 IN ('succeeded','failed','cancelled') THEN ?3 ELSE finished_at END, updated_at = ?3 WHERE run_id = ?4 AND node_key = ?5"
    )
    .bind(status, patch?.outputArtifactId ?? null, nowMs(), runId, nodeKey)
    .run();
}

async function getRunById(db: D1Database, runId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  return db
    .prepare(
      "SELECT id, workspace_id, user_id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at, intent_text, plan_json, current_step, run_version, plan_version, policy_version, retry_count, max_retries, canceled_by_user_id, resume_count, claim_token, claim_expires_at, parent_run_id, goal_id, replay_of_run_id FROM runs WHERE id = ?1 AND workspace_id = ?2 LIMIT 1"
    )
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
}

async function loadTool(db: D1Database, toolName: string): Promise<ToolDefinition | null> {
  return db
    .prepare(
      "SELECT name, description, input_schema_json, output_schema_json, risk_level, version, is_enabled FROM tools WHERE name = ?1 LIMIT 1"
    )
    .bind(toolName)
    .first<ToolDefinition>();
}

async function getToolPermission(db: D1Database, workspaceId: string, role: string, toolName: string): Promise<ToolPermission> {
  const row = await db
    .prepare(
      "SELECT allowed, requires_approval FROM tool_permissions WHERE workspace_id = ?1 AND role = ?2 AND tool_name = ?3 LIMIT 1"
    )
    .bind(workspaceId, role, toolName)
    .first<ToolPermission>();

  return row || { allowed: 0, requires_approval: 1 };
}

function validateSchemaMinimal(schemaJson: string, payload: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  const schema = safeJsonParse<{ required?: string[]; properties?: Record<string, { type?: string }> }>(schemaJson, {});
  for (const field of schema.required || []) {
    if (!(field in payload)) {
      return { ok: false, message: `Missing required field: ${field}` };
    }
  }

  const properties = schema.properties || {};
  for (const [key, descriptor] of Object.entries(properties)) {
    if (!(key in payload) || descriptor.type === undefined) continue;
    const value = payload[key];
    const expected = descriptor.type;

    if (expected === "string" && typeof value !== "string") {
      return { ok: false, message: `Field ${key} must be string` };
    }
    if (expected === "number" && typeof value !== "number") {
      return { ok: false, message: `Field ${key} must be number` };
    }
    if (expected === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      return { ok: false, message: `Field ${key} must be object` };
    }
  }

  return { ok: true };
}

async function createRunStep(
  db: D1Database,
  input: {
    runId: string;
    workspaceId: string;
    nodeId: string;
    stepType: string;
    status: string;
    summary: string;
    correlationId: string;
    inputPayload: Record<string, unknown>;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  const ts = nowMs();
  const inputHash = await sha256(JSON.stringify(input.inputPayload));
  const idem = await sha256(`${input.runId}:${input.nodeId}:${input.stepType}:${inputHash}`);

  await db
    .prepare(
      "INSERT INTO run_steps (id, run_id, workspace_id, step_type, status, summary, input_hash, output_hash, correlation_id, started_at, finished_at, created_at, node_id, step_version, retry_count, max_retries, error_code, error_message, idempotency_key, depends_on_json, checkpoint_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, NULL, ?9, ?10, 1, 0, 3, NULL, NULL, ?11, NULL, NULL)"
    )
    .bind(
      id,
      input.runId,
      input.workspaceId,
      input.stepType,
      input.status,
      input.summary,
      inputHash,
      input.correlationId,
      ts,
      input.nodeId,
      idem
    )
    .run();

  return id;
}

async function updateRunStep(
  db: D1Database,
  stepId: string,
  input: { status: string; summary?: string; output?: Record<string, unknown>; errorCode?: string; errorMessage?: string }
): Promise<void> {
  const outputHash = input.output ? await sha256(JSON.stringify(input.output)) : null;
  await db
    .prepare(
      "UPDATE run_steps SET status = ?1, summary = COALESCE(?2, summary), output_hash = COALESCE(?3, output_hash), error_code = COALESCE(?4, error_code), error_message = COALESCE(?5, error_message), finished_at = ?6 WHERE id = ?7"
    )
    .bind(input.status, input.summary || null, outputHash, input.errorCode || null, input.errorMessage || null, nowMs(), stepId)
    .run();
}

async function createToolCall(
  db: D1Database,
  input: {
    runId: string;
    workspaceId: string;
    stepId: string;
    nodeId: string;
    toolName: string;
    toolVersion: string;
    endpointId: string | null;
    payload: Record<string, unknown>;
    runRetryCount: number;
  }
): Promise<{ id: string; idempotencyKey: string }> {
  const id = crypto.randomUUID();
  const ts = nowMs();
  const idempotencyKey = await sha256(`${input.runId}:${input.nodeId}:${JSON.stringify(input.payload)}:${input.runRetryCount}`);

  await db
    .prepare(
      "INSERT INTO tool_calls (id, run_id, run_step_id, workspace_id, tool_name, host, method, request_json, response_json, status, error_code, started_at, finished_at, created_at, step_id, input_json, output_json, idempotency_key, retry_count, max_retries, latency_ms, cost_cents, token_count, error_message, tool_version, endpoint_id, approval_id, started_by_worker_id) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, NULL, 'proposed', NULL, ?7, NULL, ?7, ?3, ?6, NULL, ?8, 0, 3, NULL, 0, 0, NULL, ?9, ?10, NULL, NULL)"
    )
    .bind(id, input.runId, input.stepId, input.workspaceId, input.toolName, JSON.stringify(input.payload), ts, idempotencyKey, input.toolVersion, input.endpointId)
    .run();

  return { id, idempotencyKey };
}

async function finalizeToolCall(
  db: D1Database,
  input: {
    toolCallId: string;
    status: string;
    output: Record<string, unknown> | null;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
    tokenCount?: number;
    costCents?: number;
    approvalId?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      "UPDATE tool_calls SET status = ?1, output_json = ?2, response_json = ?2, error_code = ?3, error_message = ?4, latency_ms = ?5, token_count = COALESCE(?6, token_count), cost_cents = COALESCE(?7, cost_cents), approval_id = COALESCE(?8, approval_id), finished_at = ?9 WHERE id = ?10"
    )
    .bind(
      input.status,
      input.output ? JSON.stringify(input.output) : null,
      input.errorCode || null,
      input.errorMessage || null,
      input.latencyMs ?? null,
      input.tokenCount ?? null,
      input.costCents ?? null,
      input.approvalId ?? null,
      nowMs(),
      input.toolCallId
    )
    .run();
}

async function updateRunTotals(db: D1Database, runId: string, tokens: number, costCents: number): Promise<void> {
  await db
    .prepare(
      "UPDATE runs SET total_tokens = total_tokens + ?1, total_cost_cents = total_cost_cents + ?2, updated_at = ?3 WHERE id = ?4"
    )
    .bind(tokens, costCents, nowMs(), runId)
    .run();
}

async function addUsageLedger(
  db: D1Database,
  input: {
    workspaceId: string;
    userId: string;
    runId: string;
    toolCallId: string;
    tokens: number;
    costCents: number;
    category: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO usage_ledger (id, workspace_id, user_id, run_id, tool_call_id, tokens, cost_cents, provider, category, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'internal', ?8, ?9, ?10)"
    )
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.userId,
      input.runId,
      input.toolCallId,
      input.tokens,
      input.costCents,
      input.category,
      JSON.stringify(input.metadata || {}),
      nowMs()
    )
    .run();
}

async function loadWorkspaceBudget(db: D1Database, workspaceId: string): Promise<{ hard: number; soft: number; hardTokens: number; softTokens: number }> {
  const row = await db
    .prepare(
      "SELECT hard_limit_cents_per_day, soft_limit_cents_per_day, hard_limit_tokens_per_day, soft_limit_tokens_per_day FROM workspace_budgets WHERE workspace_id = ?1 LIMIT 1"
    )
    .bind(workspaceId)
    .first<{
      hard_limit_cents_per_day: number;
      soft_limit_cents_per_day: number;
      hard_limit_tokens_per_day: number;
      soft_limit_tokens_per_day: number;
    }>();

  if (!row) {
    return { hard: 50000, soft: 40000, hardTokens: 500000, softTokens: 400000 };
  }

  return {
    hard: row.hard_limit_cents_per_day,
    soft: row.soft_limit_cents_per_day,
    hardTokens: row.hard_limit_tokens_per_day,
    softTokens: row.soft_limit_tokens_per_day,
  };
}

async function loadUsageToday(db: D1Database, workspaceId: string): Promise<{ cost: number; tokens: number }> {
  const start = new Date(`${todayUtc()}T00:00:00.000Z`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(cost_cents),0) AS cost, COALESCE(SUM(tokens),0) AS tokens FROM usage_ledger WHERE workspace_id = ?1 AND created_at >= ?2 AND created_at < ?3"
    )
    .bind(workspaceId, start, end)
    .first<{ cost: number; tokens: number }>();

  return { cost: Number(row?.cost || 0), tokens: Number(row?.tokens || 0) };
}

async function checkBudget(
  db: D1Database,
  workspaceId: string,
  deltaTokens: number,
  deltaCostCents: number
): Promise<{ ok: true; softExceeded: boolean } | { ok: false; code: string; message: string }> {
  const budget = await loadWorkspaceBudget(db, workspaceId);
  const usage = await loadUsageToday(db, workspaceId);

  if (usage.cost + deltaCostCents > budget.hard || usage.tokens + deltaTokens > budget.hardTokens) {
    return { ok: false, code: "budget_hard_limit", message: "Hard budget exceeded" };
  }

  const softExceeded = usage.cost + deltaCostCents > budget.soft || usage.tokens + deltaTokens > budget.softTokens;
  return { ok: true, softExceeded };
}

async function loadHttpPolicy(db: D1Database, workspaceId: string): Promise<{
  allowedHosts: string[];
  allowedMethods: string[];
  denyPrivateIps: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
}> {
  const row = await db
    .prepare("SELECT policy_json FROM workspace_policies WHERE workspace_id = ?1 LIMIT 1")
    .bind(workspaceId)
    .first<{ policy_json: string }>();

  const parsed = safeJsonParse<{
    http_request?: {
      allowed_hosts?: string[];
      allowed_methods?: string[];
      deny_private_ips?: boolean;
      timeout_ms?: number;
      max_response_bytes?: number;
    };
  }>(row?.policy_json, {});

  const http = parsed.http_request || {};
  return {
    allowedHosts: (http.allowed_hosts || ["api.github.com"]).map((v) => v.toLowerCase()),
    allowedMethods: (http.allowed_methods || ["GET", "HEAD"]).map((v) => v.toUpperCase()),
    denyPrivateIps: http.deny_private_ips !== false,
    timeoutMs: Math.max(1000, http.timeout_ms || 10000),
    maxResponseBytes: Math.max(1024, http.max_response_bytes || 262144),
  };
}

async function executeTool(
  db: D1Database,
  input: {
    workspaceId: string;
    runId: string;
    userId: string;
    toolName: string;
    payload: Record<string, unknown>;
  }
): Promise<{ ok: true; output: Record<string, unknown>; tokens: number; costCents: number } | { ok: false; code: string; message: string }> {
  if (input.toolName === "memory_read") {
    const query = typeof input.payload.query === "string" ? input.payload.query.toLowerCase() : "";
    const type = typeof input.payload.type === "string" ? input.payload.type : null;
    const limit = Math.min(50, Math.max(1, Number(input.payload.limit || 10)));

    let sql = "SELECT id, type, content, confidence, ttl, source_run_id, created_at, updated_at FROM memories WHERE workspace_id = ?1";
    const bind: Array<string | number> = [input.workspaceId];

    if (type) {
      sql += " AND type = ?2";
      bind.push(type);
    }

    if (query) {
      const idx = bind.length + 1;
      sql += ` AND lower(content) LIKE ?${idx}`;
      bind.push(`%${query}%`);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?${bind.length + 1}`;
    bind.push(limit);

    const rows = await db.prepare(sql).bind(...bind).all<Record<string, unknown>>();
    const output = { memories: rows.results || [] };
    const tokens = estimateTokens(JSON.stringify(output));
    return { ok: true, output, tokens, costCents: estimateCostCents(tokens) };
  }

  if (input.toolName === "memory_write") {
    const type = String(input.payload.type || "note");
    const content = String(input.payload.content || "").trim();
    if (!content) {
      return { ok: false, code: "invalid_payload", message: "memory_write.content is required" };
    }

    const confidence = typeof input.payload.confidence === "number" ? input.payload.confidence : 0.5;
    const ttl = typeof input.payload.ttl === "number" ? Math.floor(input.payload.ttl) : null;
    const ts = nowMs();

    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO memories (id, workspace_id, type, content, embedding_json, source_run_id, confidence, ttl, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?8)"
      )
      .bind(id, input.workspaceId, type, content, input.runId, confidence, ttl, ts)
      .run();

    const output = { memory_id: id, created_at: ts };
    const tokens = estimateTokens(content);
    return { ok: true, output, tokens, costCents: estimateCostCents(tokens) };
  }

  if (input.toolName === "artifact_create") {
    const type = String(input.payload.type || "output");
    const ref = typeof input.payload.ref === "string" ? input.payload.ref : null;
    const metadata = typeof input.payload.metadata === "object" && input.payload.metadata
      ? (input.payload.metadata as Record<string, unknown>)
      : {};

    const id = crypto.randomUUID();
    const ts = nowMs();
    await db
      .prepare(
        "INSERT INTO artifacts (id, run_id, workspace_id, type, ref, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      )
      .bind(id, input.runId, input.workspaceId, type, ref, JSON.stringify(metadata), ts)
      .run();

    const output = { artifact_id: id, type, ref, created_at: ts };
    const tokens = estimateTokens(JSON.stringify(metadata));
    return { ok: true, output, tokens, costCents: estimateCostCents(tokens) };
  }

  if (input.toolName === "http_request") {
    const url = String(input.payload.url || "").trim();
    if (!url) return { ok: false, code: "invalid_payload", message: "http_request.url is required" };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, code: "invalid_url", message: "Invalid URL" };
    }

    const method = normalizeMethod(typeof input.payload.method === "string" ? input.payload.method : undefined);
    const policy = await loadHttpPolicy(db, input.workspaceId);

    if (!policy.allowedHosts.includes(parsed.hostname.toLowerCase())) {
      return { ok: false, code: "policy_denied", message: "Host not allowlisted" };
    }
    if (!policy.allowedMethods.includes(method)) {
      return { ok: false, code: "policy_denied", message: "Method not allowlisted" };
    }
    if (policy.denyPrivateIps && isPrivateHostname(parsed.hostname)) {
      return { ok: false, code: "policy_denied", message: "Private hostname denied" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    const startedAt = nowMs();

    try {
      const response = await fetch(url, {
        method,
        headers: typeof input.payload.headers === "object" && input.payload.headers
          ? (input.payload.headers as Record<string, string>)
          : undefined,
        body: typeof input.payload.body === "string" ? input.payload.body : undefined,
        signal: controller.signal,
      });

      const buf = await response.arrayBuffer();
      if (buf.byteLength > policy.maxResponseBytes) {
        return { ok: false, code: "response_too_large", message: "Response exceeds max_response_bytes" };
      }

      const body = new TextDecoder().decode(buf);
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });

      const latency = Math.max(1, nowMs() - startedAt);
      const output = {
        status: response.status,
        headers,
        body_preview: body.slice(0, 8000),
        body_size: buf.byteLength,
        latency_ms: latency,
      };

      const tokens = estimateTokens(body);
      return { ok: true, output, tokens, costCents: estimateCostCents(tokens) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, code: "tool_timeout", message: "HTTP request timed out" };
      }
      return { ok: false, code: "tool_failed", message: "HTTP request failed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, code: "tool_not_implemented", message: `No handler for tool ${input.toolName}` };
}

async function ensureDelegationIfNeeded(
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
  actingAsUserId: string | null,
  toolName: string
): Promise<{ ok: true; effectiveUserId: string } | { ok: false; code: string; message: string }> {
  if (!actingAsUserId || actingAsUserId === actorUserId) {
    return { ok: true, effectiveUserId: actorUserId };
  }

  const now = nowMs();
  const row = await db
    .prepare(
      "SELECT id, tools_json FROM delegations WHERE workspace_id = ?1 AND grantor_user_id = ?2 AND grantee_user_id = ?3 AND status = 'active' AND valid_from <= ?4 AND valid_until >= ?4 LIMIT 1"
    )
    .bind(workspaceId, actingAsUserId, actorUserId, now)
    .first<{ id: string; tools_json: string }>();

  if (!row) {
    return { ok: false, code: "delegation_missing", message: "No active delegation for acting_as user" };
  }

  const tools = safeJsonParse<string[]>(row.tools_json, []);
  if (!tools.includes(toolName) && !tools.includes("*")) {
    return { ok: false, code: "delegation_denied", message: `Delegation does not allow ${toolName}` };
  }

  return { ok: true, effectiveUserId: actingAsUserId };
}

async function requestApproval(
  db: D1Database,
  input: {
    workspaceId: string;
    runId: string;
    toolCallId: string;
    requestedByUserId: string;
    reason: string;
    metadata: Record<string, unknown>;
  }
): Promise<string> {
  const ts = nowMs();
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO approvals (id, workspace_id, run_id, tool_call_id, requested_by_user_id, approved_by_user_id, status, reason, metadata_json, created_at, updated_at, approved_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'pending', ?6, ?7, ?8, ?8, NULL)"
    )
    .bind(id, input.workspaceId, input.runId, input.toolCallId, input.requestedByUserId, input.reason, JSON.stringify(input.metadata), ts)
    .run();
  return id;
}

async function getApprovalForToolCall(db: D1Database, toolCallId: string): Promise<{ id: string; status: string } | null> {
  return db
    .prepare("SELECT id, status FROM approvals WHERE tool_call_id = ?1 LIMIT 1")
    .bind(toolCallId)
    .first<{ id: string; status: string }>();
}

async function updateRunStatus(
  db: D1Database,
  runId: string,
  status: RunStatus,
  patch?: { errorCode?: string | null; errorMessage?: string | null; currentStep?: string | null }
): Promise<void> {
  const finishedAt = status === "succeeded" || status === "failed" || status === "cancelled" ? nowMs() : null;

  await db
    .prepare(
      "UPDATE runs SET status = ?1, error_code = COALESCE(?2, error_code), error_message = COALESCE(?3, error_message), current_step = COALESCE(?4, current_step), finished_at = COALESCE(?5, finished_at), updated_at = ?6 WHERE id = ?7"
    )
    .bind(status, patch?.errorCode ?? null, patch?.errorMessage ?? null, patch?.currentStep ?? null, finishedAt, nowMs(), runId)
    .run();
}

async function markQueue(
  db: D1Database,
  runId: string,
  status: QueueStatus,
  patch?: { availableAt?: number; attemptCountInc?: boolean; lastErrorCode?: string | null; lastErrorMessage?: string | null }
): Promise<void> {
  const row = await db
    .prepare("SELECT attempt_count FROM orchestration_queue WHERE run_id = ?1 LIMIT 1")
    .bind(runId)
    .first<{ attempt_count: number }>();

  const nextAttempt = (row?.attempt_count || 0) + (patch?.attemptCountInc ? 1 : 0);

  await db
    .prepare(
      "UPDATE orchestration_queue SET status = ?1, available_at = COALESCE(?2, available_at), lease_until = NULL, worker_id = NULL, attempt_count = ?3, last_error_code = ?4, last_error_message = ?5, updated_at = ?6 WHERE run_id = ?7"
    )
    .bind(status, patch?.availableAt ?? null, nextAttempt, patch?.lastErrorCode ?? null, patch?.lastErrorMessage ?? null, nowMs(), runId)
    .run();
}

async function leaseNextRun(db: D1Database): Promise<{ runId: string; workspaceId: string; userId: string; queueId: string } | null> {
  const ts = nowMs();
  const leaseUntil = ts + 30_000;
  const workerId = `worker-${crypto.randomUUID()}`;

  const candidate = await db
    .prepare(
      "SELECT run_id, workspace_id, user_id FROM orchestration_queue WHERE status IN ('queued','leased') AND available_at <= ?1 AND (lease_until IS NULL OR lease_until < ?1) ORDER BY priority ASC, created_at ASC LIMIT 1"
    )
    .bind(ts)
    .first<{ run_id: string; workspace_id: string; user_id: string }>();

  if (!candidate) return null;

  await db
    .prepare(
      "UPDATE orchestration_queue SET status = 'leased', lease_until = ?1, worker_id = ?2, updated_at = ?3 WHERE run_id = ?4 AND status IN ('queued','leased')"
    )
    .bind(leaseUntil, workerId, ts, candidate.run_id)
    .run();

  const leased = await db
    .prepare("SELECT id, run_id, workspace_id, user_id FROM orchestration_queue WHERE run_id = ?1 AND worker_id = ?2 LIMIT 1")
    .bind(candidate.run_id, workerId)
    .first<{ id: string; run_id: string; workspace_id: string; user_id: string }>();

  if (!leased) return null;
  return { runId: leased.run_id, workspaceId: leased.workspace_id, userId: leased.user_id, queueId: leased.id };
}

async function getNodeStatusMap(db: D1Database, runId: string): Promise<Map<string, string>> {
  const rows = await db
    .prepare("SELECT node_key, status FROM run_graph_nodes WHERE run_id = ?1")
    .bind(runId)
    .all<{ node_key: string; status: string }>();

  const map = new Map<string, string>();
  for (const row of rows.results || []) {
    map.set(row.node_key, row.status);
  }
  return map;
}

function pickNextExecutableNode(plan: OsPlan, statusMap: Map<string, string>): OsPlanNode | null {
  for (const node of plan.nodes) {
    const status = statusMap.get(node.id) || "pending";
    if (status === "succeeded" || status === "running") {
      continue;
    }

    const deps = node.depends_on || [];
    const depsOk = deps.every((dep) => statusMap.get(dep) === "succeeded");
    if (!depsOk) continue;

    return node;
  }
  return null;
}

async function loadLatestNodeToolCall(
  db: D1Database,
  runId: string,
  nodeId: string
): Promise<{
  toolCallId: string;
  runStepId: string;
  inputJson: string | null;
  toolCallStatus: string;
  approvalId: string | null;
  approvalStatus: string | null;
} | null> {
  return db
    .prepare(
      "SELECT tc.id AS toolCallId, tc.run_step_id AS runStepId, tc.input_json AS inputJson, tc.status AS toolCallStatus, tc.approval_id AS approvalId, a.status AS approvalStatus FROM tool_calls tc JOIN run_steps rs ON rs.id = tc.run_step_id LEFT JOIN approvals a ON a.id = tc.approval_id WHERE tc.run_id = ?1 AND rs.node_id = ?2 ORDER BY tc.created_at DESC LIMIT 1"
    )
    .bind(runId, nodeId)
    .first<{
      toolCallId: string;
      runStepId: string;
      inputJson: string | null;
      toolCallStatus: string;
      approvalId: string | null;
      approvalStatus: string | null;
    }>();
}

async function processRunOnce(
  db: D1Database,
  run: {
    id: string;
    workspace_id: string;
    user_id: string;
    status: string;
    correlation_id: string;
    retry_count: number;
    max_retries: number;
    plan_json: string | null;
  }
): Promise<{ status: string; waitingApproval?: boolean }> {
  if (run.status === "cancelled" || run.status === "failed" || run.status === "succeeded") {
    return { status: run.status };
  }

  const plan = safeJsonParse<OsPlan>(run.plan_json, { version: 1, nodes: [], edges: [] });
  if (!plan.nodes.length) {
    await updateRunStatus(db, run.id, "failed", { errorCode: "invalid_plan", errorMessage: "Plan has no nodes" });
    await markQueue(db, run.id, "dead_letter", { lastErrorCode: "invalid_plan", lastErrorMessage: "Plan has no nodes" });
    return { status: "failed" };
  }

  await updateRunStatus(db, run.id, "running");

  const statusMap = await getNodeStatusMap(db, run.id);
  const nextNode = pickNextExecutableNode(plan, statusMap);

  if (!nextNode) {
    const statuses = Array.from(statusMap.values());
    const anyFailed = statuses.some((v) => v === "failed");
    if (anyFailed) {
      await updateRunStatus(db, run.id, "failed", { errorCode: "node_failed", errorMessage: "One or more nodes failed" });
      await markQueue(db, run.id, "done");
      return { status: "failed" };
    }

    const hasNonTerminal = statuses.some((v) => v === "pending" || v === "running" || v === "waiting_for_approval");
    if (hasNonTerminal) {
      const waiting = statuses.some((v) => v === "waiting_for_approval");
      await updateRunStatus(db, run.id, waiting ? "waiting_for_approval" : "running");
      await markQueue(db, run.id, "queued", { availableAt: nowMs() + (waiting ? 60_000 : 5000) });
      return { status: waiting ? "waiting_for_approval" : "running", waitingApproval: waiting };
    }

    await updateRunStatus(db, run.id, "succeeded", { currentStep: null });
    await markQueue(db, run.id, "done");
    return { status: "succeeded" };
  }

  await db
    .prepare("UPDATE run_graph_nodes SET status = 'running', started_at = COALESCE(started_at, ?1), updated_at = ?1 WHERE run_id = ?2 AND node_key = ?3")
    .bind(nowMs(), run.id, nextNode.id)
    .run();

  await updateRunStatus(db, run.id, "running", { currentStep: nextNode.id });

  if (nextNode.type !== "tool") {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "succeeded");
    await markQueue(db, run.id, "queued", { availableAt: nowMs() + 10 });
    return { status: "running" };
  }

  const toolName = nextNode.tool_name || "";
  const toolPayload = nextNode.input || {};

  const tool = await loadTool(db, toolName);
  if (!tool || !tool.is_enabled) {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: "tool_not_found", errorMessage: `Unknown/disabled tool: ${toolName}` });
    await markQueue(db, run.id, "done", { lastErrorCode: "tool_not_found", lastErrorMessage: toolName });
    return { status: "failed" };
  }

  const schemaCheck = validateSchemaMinimal(tool.input_schema_json, toolPayload);
  if (!schemaCheck.ok) {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: "invalid_tool_input", errorMessage: schemaCheck.message });
    await markQueue(db, run.id, "done", { lastErrorCode: "invalid_tool_input", lastErrorMessage: schemaCheck.message });
    return { status: "failed" };
  }

  const role = await getMembershipRole(db, run.workspace_id, run.user_id);
  const permission = await getToolPermission(db, run.workspace_id, role, toolName);
  if (!permission.allowed) {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: "permission_denied", errorMessage: `Role ${role} cannot use ${toolName}` });
    await markQueue(db, run.id, "done", { lastErrorCode: "permission_denied", lastErrorMessage: toolName });
    return { status: "failed" };
  }
  const nodeStatus = statusMap.get(nextNode.id) || "pending";
  let stepId = "";
  let toolCallId = "";
  let approvalId: string | null = null;
  let executionPayload: Record<string, unknown> = toolPayload;
  let resumedApprovedCall = false;

  if (nodeStatus === "waiting_for_approval") {
    const latest = await loadLatestNodeToolCall(db, run.id, nextNode.id);
    if (!latest) {
      await updateRunStatus(db, run.id, "failed", {
        errorCode: "approval_state_corrupt",
        errorMessage: "Node is waiting_for_approval but no tool call exists",
      });
      await markQueue(db, run.id, "done", {
        lastErrorCode: "approval_state_corrupt",
        lastErrorMessage: nextNode.id,
      });
      return { status: "failed" };
    }

    stepId = latest.runStepId;
    toolCallId = latest.toolCallId;
    approvalId = latest.approvalId;
    executionPayload = safeJsonParse<Record<string, unknown>>(latest.inputJson, toolPayload);

    if (latest.approvalStatus === "pending" || !latest.approvalStatus) {
      await updateRunStatus(db, run.id, "waiting_for_approval", { currentStep: nextNode.id });
      await markQueue(db, run.id, "queued", { availableAt: nowMs() + 60_000 });
      return { status: "waiting_for_approval", waitingApproval: true };
    }

    if (latest.approvalStatus === "rejected") {
      await finalizeToolCall(db, {
        toolCallId,
        status: "cancelled",
        output: null,
        errorCode: "approval_rejected",
        errorMessage: "Tool call rejected",
        approvalId,
      });
      await updateRunStep(db, stepId, {
        status: "failed",
        errorCode: "approval_rejected",
        errorMessage: "Tool call rejected",
      });
      await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
      await updateRunStatus(db, run.id, "failed", {
        errorCode: "approval_rejected",
        errorMessage: `Approval rejected for ${toolName}`,
      });
      await markQueue(db, run.id, "done", {
        lastErrorCode: "approval_rejected",
        lastErrorMessage: toolName,
      });
      return { status: "failed" };
    }

    await db
      .prepare("UPDATE tool_calls SET status = 'running', started_at = COALESCE(started_at, ?1) WHERE id = ?2")
      .bind(nowMs(), toolCallId)
      .run();
    await updateRunStep(db, stepId, {
      status: "running",
      summary: "Approval granted, executing tool",
    });
    await upsertRunNodeStatus(db, run.id, nextNode.id, "running");
    resumedApprovedCall = true;
  }

  if (!resumedApprovedCall) {
    stepId = await createRunStep(db, {
      runId: run.id,
      workspaceId: run.workspace_id,
      nodeId: nextNode.id,
      stepType: "tool",
      status: "running",
      summary: `Executing ${toolName}`,
      correlationId: run.correlation_id,
      inputPayload: toolPayload,
    });

    const endpoint = await db
      .prepare("SELECT id FROM tool_endpoints WHERE tool_name = ?1 AND is_enabled = 1 ORDER BY updated_at DESC LIMIT 1")
      .bind(toolName)
      .first<{ id: string }>();

    const created = await createToolCall(db, {
      runId: run.id,
      workspaceId: run.workspace_id,
      stepId,
      nodeId: nextNode.id,
      toolName,
      toolVersion: tool.version,
      endpointId: endpoint?.id || null,
      payload: toolPayload,
      runRetryCount: run.retry_count,
    });
    toolCallId = created.id;

    const requiresApproval = permission.requires_approval === 1 || tool.risk_level !== "read_only";
    if (requiresApproval) {
      const requestedApprovalId = await requestApproval(db, {
        workspaceId: run.workspace_id,
        runId: run.id,
        toolCallId,
        requestedByUserId: run.user_id,
        reason: `${toolName} requires approval`,
        metadata: { node_id: nextNode.id, tool_name: toolName, risk_level: tool.risk_level, payload: toolPayload },
      });
      approvalId = requestedApprovalId;

      await finalizeToolCall(db, {
        toolCallId,
        status: "waiting_for_approval",
        output: null,
        approvalId: requestedApprovalId,
      });
      await updateRunStep(db, stepId, { status: "waiting_for_approval", summary: "Waiting for approval" });
      await upsertRunNodeStatus(db, run.id, nextNode.id, "waiting_for_approval");
      await updateRunStatus(db, run.id, "waiting_for_approval", { currentStep: nextNode.id });
      await markQueue(db, run.id, "queued", { availableAt: nowMs() + 60_000 });

      return { status: "waiting_for_approval", waitingApproval: true };
    }
  }

  const delegationCheck = await ensureDelegationIfNeeded(
    db,
    run.workspace_id,
    run.user_id,
    typeof executionPayload.acting_as_user_id === "string" ? executionPayload.acting_as_user_id : null,
    toolName
  );
  if (!delegationCheck.ok) {
    await finalizeToolCall(db, {
      toolCallId,
      status: "failed",
      output: null,
      errorCode: delegationCheck.code,
      errorMessage: delegationCheck.message,
    });
    await updateRunStep(db, stepId, { status: "failed", errorCode: delegationCheck.code, errorMessage: delegationCheck.message });
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: delegationCheck.code, errorMessage: delegationCheck.message });
    await markQueue(db, run.id, "done", { lastErrorCode: delegationCheck.code, lastErrorMessage: delegationCheck.message });
    return { status: "failed" };
  }

  const start = nowMs();
  const toolResult = await executeTool(db, {
    workspaceId: run.workspace_id,
    runId: run.id,
    userId: delegationCheck.effectiveUserId,
    toolName,
    payload: executionPayload,
  });
  const latencyMs = Math.max(1, nowMs() - start);

  if (!toolResult.ok) {
    const retry = run.retry_count + 1;
    if (retry <= run.max_retries) {
      await finalizeToolCall(db, {
        toolCallId,
        status: "failed",
        output: null,
        errorCode: toolResult.code,
        errorMessage: toolResult.message,
        latencyMs,
        approvalId,
      });
      await updateRunStep(db, stepId, { status: "failed", errorCode: toolResult.code, errorMessage: toolResult.message });
      await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");

      const backoffMs = Math.min(60_000, 1000 * 2 ** Math.max(0, retry - 1));
      await db
        .prepare("UPDATE runs SET retry_count = retry_count + 1, status = 'queued', error_code = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(toolResult.code, toolResult.message, nowMs(), run.id)
        .run();
      await markQueue(db, run.id, "queued", {
        availableAt: nowMs() + backoffMs,
        attemptCountInc: true,
        lastErrorCode: toolResult.code,
        lastErrorMessage: toolResult.message,
      });
      return { status: "queued" };
    }

    await finalizeToolCall(db, {
      toolCallId,
      status: "failed",
      output: null,
      errorCode: toolResult.code,
      errorMessage: toolResult.message,
      latencyMs,
      approvalId,
    });
    await updateRunStep(db, stepId, { status: "failed", errorCode: toolResult.code, errorMessage: toolResult.message });
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: toolResult.code, errorMessage: toolResult.message });
    await markQueue(db, run.id, "done", { lastErrorCode: toolResult.code, lastErrorMessage: toolResult.message });
    return { status: "failed" };
  }

  const budgetCheck = await checkBudget(db, run.workspace_id, toolResult.tokens, toolResult.costCents);
  if (!budgetCheck.ok) {
    await finalizeToolCall(db, {
      toolCallId,
      status: "failed",
      output: toolResult.output,
      errorCode: budgetCheck.code,
      errorMessage: budgetCheck.message,
      latencyMs,
      tokenCount: toolResult.tokens,
      costCents: toolResult.costCents,
      approvalId,
    });
    await updateRunStep(db, stepId, {
      status: "failed",
      summary: "Budget hard limit exceeded",
      errorCode: budgetCheck.code,
      errorMessage: budgetCheck.message,
      output: toolResult.output,
    });
    await upsertRunNodeStatus(db, run.id, nextNode.id, "failed");
    await updateRunStatus(db, run.id, "failed", { errorCode: budgetCheck.code, errorMessage: budgetCheck.message });
    await markQueue(db, run.id, "done", { lastErrorCode: budgetCheck.code, lastErrorMessage: budgetCheck.message });
    return { status: "failed" };
  }

  await finalizeToolCall(db, {
    toolCallId,
    status: budgetCheck.softExceeded ? "succeeded_soft_limit" : "succeeded",
    output: toolResult.output,
    latencyMs,
    tokenCount: toolResult.tokens,
    costCents: toolResult.costCents,
    approvalId,
  });
  await updateRunStep(db, stepId, {
    status: "succeeded",
    summary: budgetCheck.softExceeded ? "Tool succeeded (soft budget warning)" : "Tool succeeded",
    output: toolResult.output,
  });

  if (toolResult.output.artifact_id && typeof toolResult.output.artifact_id === "string") {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "succeeded", { outputArtifactId: toolResult.output.artifact_id });
  } else {
    await upsertRunNodeStatus(db, run.id, nextNode.id, "succeeded");
  }

  await addUsageLedger(db, {
    workspaceId: run.workspace_id,
    userId: run.user_id,
    runId: run.id,
    toolCallId,
    tokens: toolResult.tokens,
    costCents: toolResult.costCents,
    category: `tool:${toolName}`,
    metadata: { soft_budget_exceeded: budgetCheck.softExceeded },
  });

  await updateRunTotals(db, run.id, toolResult.tokens, toolResult.costCents);
  await markQueue(db, run.id, "queued", { availableAt: nowMs() + 10 });
  return { status: "running" };
}

async function handleCreateRunV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) {
    return json({ ok: false, error: "workspace_not_accessible" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body", message: "JSON body required" }, 400);
  }

  const intentText = String(body.intent_text || body.prompt || "").trim();
  if (!intentText) {
    return json({ ok: false, error: "invalid_intent", message: "intent_text is required" }, 400);
  }

  const plan = buildPlanFromBody({ ...body, intent_text: intentText });
  const runId = crypto.randomUUID();
  const ts = nowMs();
  const correlationId = `os-${runId}`;

  await db
    .prepare(
      "INSERT INTO runs (id, workspace_id, user_id, correlation_id, prompt, status, error_code, error_message, started_at, finished_at, canceled_at, pending_confirmation_event_id, total_tokens, total_cost_cents, created_at, updated_at, intent_text, plan_json, current_step, run_version, plan_version, policy_version, retry_count, max_retries, canceled_by_user_id, resume_count, claim_token, claim_expires_at, parent_run_id, goal_id, replay_of_run_id) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?6, ?6, ?7, ?8, NULL, 1, ?9, 1, 0, 3, NULL, 0, NULL, NULL, ?10, ?11, ?12)"
    )
    .bind(
      runId,
      workspaceId,
      resolved.user.id,
      correlationId,
      intentText,
      ts,
      intentText,
      JSON.stringify(plan),
      Number(body.plan_version || 1),
      typeof body.parent_run_id === "string" ? body.parent_run_id : null,
      typeof body.goal_id === "string" ? body.goal_id : null,
      typeof body.replay_of_run_id === "string" ? body.replay_of_run_id : null
    )
    .run();

  await persistGraph(db, workspaceId, runId, plan);
  await enqueueRun(db, runId, workspaceId, resolved.user.id);

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "run_created_v2",
    domain: "orchestration",
    resourceId: runId,
    metadata: { correlation_id: correlationId, nodes: plan.nodes.length, edges: plan.edges.length },
  });

  return json(
    {
      ok: true,
      run: {
        id: runId,
        workspace_id: workspaceId,
        status: "queued",
        correlation_id: correlationId,
        plan_version: plan.version,
        nodes: plan.nodes.length,
        edges: plan.edges.length,
      },
    },
    201
  );
}

async function handleGetRunV2(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const run = await getRunById(db, runId, workspaceId);
  if (!run) return json({ ok: false, error: "not_found" }, 404);

  const steps = await db
    .prepare(
      "SELECT id, run_id, node_id, step_type, status, summary, error_code, error_message, retry_count, max_retries, idempotency_key, started_at, finished_at, created_at FROM run_steps WHERE run_id = ?1 ORDER BY created_at ASC"
    )
    .bind(runId)
    .all<Record<string, unknown>>();

  const toolCalls = await db
    .prepare(
      "SELECT id, run_step_id, tool_name, status, error_code, error_message, idempotency_key, retry_count, max_retries, latency_ms, cost_cents, token_count, input_json, output_json, approval_id, created_at, finished_at FROM tool_calls WHERE run_id = ?1 ORDER BY created_at ASC"
    )
    .bind(runId)
    .all<Record<string, unknown>>();

  const artifacts = await db
    .prepare("SELECT id, type, ref, metadata_json, created_at FROM artifacts WHERE run_id = ?1 ORDER BY created_at ASC")
    .bind(runId)
    .all<Record<string, unknown>>();

  const nodes = await db
    .prepare(
      "SELECT node_key, node_type, tool_name, status, input_json, output_artifact_id, depends_on_json, started_at, finished_at, created_at, updated_at FROM run_graph_nodes WHERE run_id = ?1 ORDER BY created_at ASC"
    )
    .bind(runId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    run,
    steps: steps.results || [],
    tool_calls: (toolCalls.results || []).map((row) => ({
      ...row,
      input_json: safeJsonParse(row.input_json as string | null, null),
      output_json: safeJsonParse(row.output_json as string | null, null),
    })),
    artifacts: (artifacts.results || []).map((row) => ({
      ...row,
      metadata_json: safeJsonParse(row.metadata_json as string | null, null),
    })),
    graph_nodes: (nodes.results || []).map((row) => ({
      ...row,
      input_json: safeJsonParse(row.input_json as string | null, null),
      depends_on_json: safeJsonParse(row.depends_on_json as string | null, []),
    })),
  });
}

async function handleListRunsV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));
  const statusFilter = (url.searchParams.get("status") || "").trim();

  const baseSql =
    "SELECT id, status, intent_text, current_step, retry_count, max_retries, total_tokens, total_cost_cents, created_at, updated_at, started_at, finished_at, goal_id, parent_run_id FROM runs WHERE workspace_id = ?1";

  if (statusFilter) {
    const rows = await db
      .prepare(`${baseSql} AND status = ?2 ORDER BY created_at DESC LIMIT ?3`)
      .bind(workspaceId, statusFilter, limit)
      .all<Record<string, unknown>>();
    return json({ ok: true, runs: rows.results || [] });
  }

  const rows = await db
    .prepare(`${baseSql} ORDER BY created_at DESC LIMIT ?2`)
    .bind(workspaceId, limit)
    .all<Record<string, unknown>>();

  return json({ ok: true, runs: rows.results || [] });
}

async function handleCancelRunV2(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const run = await getRunById(db, runId, workspaceId);
  if (!run) return json({ ok: false, error: "not_found" }, 404);

  const status = String(run.status || "");
  if (["succeeded", "failed", "cancelled"].includes(status)) {
    return json({ ok: true, run: { id: runId, status } });
  }

  await db
    .prepare("UPDATE runs SET status = 'cancelled', canceled_at = ?1, canceled_by_user_id = ?2, updated_at = ?1, finished_at = ?1 WHERE id = ?3")
    .bind(nowMs(), resolved.user.id, runId)
    .run();
  await markQueue(db, runId, "done");

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "run_cancelled_v2",
    domain: "orchestration",
    resourceId: runId,
  });

  return json({ ok: true, run: { id: runId, status: "cancelled" } });
}

async function handleResumeRunV2(env: CloudEnv, resolved: SessionLike, runId: string): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const run = await getRunById(db, runId, workspaceId);
  if (!run) return json({ ok: false, error: "not_found" }, 404);

  const status = String(run.status || "");
  if (!["failed", "cancelled", "waiting_for_approval"].includes(status)) {
    return json({ ok: false, error: "invalid_state", message: `Cannot resume from ${status}` }, 409);
  }

  await db
    .prepare("UPDATE runs SET status = 'queued', error_code = NULL, error_message = NULL, resume_count = resume_count + 1, updated_at = ?1 WHERE id = ?2")
    .bind(nowMs(), runId)
    .run();
  await enqueueRun(db, runId, workspaceId, resolved.user.id);

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: "run_resumed_v2",
    domain: "orchestration",
    resourceId: runId,
  });

  return json({ ok: true, run: { id: runId, status: "queued" } });
}

async function handleWorkerTickV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const lease = await leaseNextRun(db);
  if (!lease) {
    return json({ ok: true, processed: false, reason: "no_queued_runs" });
  }

  const run = await db
    .prepare(
      "SELECT id, workspace_id, user_id, status, correlation_id, retry_count, max_retries, plan_json FROM runs WHERE id = ?1 LIMIT 1"
    )
    .bind(lease.runId)
    .first<{
      id: string;
      workspace_id: string;
      user_id: string;
      status: string;
      correlation_id: string;
      retry_count: number;
      max_retries: number;
      plan_json: string | null;
    }>();

  if (!run) {
    await markQueue(db, lease.runId, "dead_letter", { lastErrorCode: "run_not_found", lastErrorMessage: "run missing" });
    return json({ ok: true, processed: false, reason: "run_not_found", run_id: lease.runId });
  }

  const result = await processRunOnce(db, run);

  await audit(db, {
    workspaceId: run.workspace_id,
    userId: resolved.user.id,
    action: "worker_tick_v2",
    domain: "orchestration",
    resourceId: run.id,
    metadata: { result: result.status, waiting_approval: !!result.waitingApproval },
  });

  return json({ ok: true, processed: true, run_id: run.id, status: result.status, waiting_approval: !!result.waitingApproval });
}

async function handleListApprovalsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const rows = await db
    .prepare(
      "SELECT id, run_id, tool_call_id, requested_by_user_id, approved_by_user_id, status, reason, metadata_json, created_at, updated_at, approved_at FROM approvals WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT 200"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    approvals: (rows.results || []).map((row) => ({
      ...row,
      metadata_json: safeJsonParse(row.metadata_json as string | null, null),
    })),
  });
}

async function handleResolveApprovalV2(
  env: CloudEnv,
  resolved: SessionLike,
  approvalId: string,
  decision: "approved" | "rejected"
): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const approval = await db
    .prepare("SELECT id, run_id, status FROM approvals WHERE id = ?1 AND workspace_id = ?2 LIMIT 1")
    .bind(approvalId, workspaceId)
    .first<{ id: string; run_id: string; status: string }>();

  if (!approval) return json({ ok: false, error: "not_found" }, 404);
  if (approval.status !== "pending") {
    return json({ ok: false, error: "invalid_state", message: "Approval already resolved" }, 409);
  }

  await db
    .prepare("UPDATE approvals SET status = ?1, approved_by_user_id = ?2, approved_at = ?3, updated_at = ?3 WHERE id = ?4")
    .bind(decision, resolved.user.id, nowMs(), approvalId)
    .run();

  if (decision === "approved") {
    await db
      .prepare("UPDATE runs SET status = 'queued', updated_at = ?1 WHERE id = ?2 AND status = 'waiting_for_approval'")
      .bind(nowMs(), approval.run_id)
      .run();
    await enqueueRun(db, approval.run_id, workspaceId, resolved.user.id);
  }

  await audit(db, {
    workspaceId,
    userId: resolved.user.id,
    action: decision === "approved" ? "approval_approved_v2" : "approval_rejected_v2",
    domain: "orchestration",
    resourceId: approval.run_id,
    metadata: { approval_id: approvalId },
  });

  return json({ ok: true, approval: { id: approvalId, status: decision } });
}

async function handleListToolsV2(env: CloudEnv): Promise<Response> {
  const rows = await env.ASSISTANT_DB
    .prepare(
      "SELECT t.name, t.description, t.risk_level, t.version, t.is_enabled, e.id as endpoint_id, e.handler_type, e.handler_ref, e.timeout_ms FROM tools t LEFT JOIN tool_endpoints e ON e.tool_name = t.name AND e.is_enabled = 1 ORDER BY t.name ASC"
    )
    .all<Record<string, unknown>>();
  return json({ ok: true, tools: rows.results || [] });
}

async function handleUpsertToolV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const role = await getMembershipRole(db, workspaceId, resolved.user.id);
  if (!["owner", "admin", "system_owner"].includes(role)) {
    return json({ ok: false, error: "forbidden", message: "Only workspace admins can upsert tools" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const description = String(body.description || "");
  const inputSchema = typeof body.input_schema_json === "string" ? body.input_schema_json : JSON.stringify(body.input_schema_json || {});
  const outputSchema = typeof body.output_schema_json === "string" ? body.output_schema_json : JSON.stringify(body.output_schema_json || {});
  const risk = (String(body.risk_level || "read_only") as RiskLevel);
  const version = String(body.version || "1.0.0");
  const isEnabled = body.is_enabled === false ? 0 : 1;

  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO tools (name, description, input_schema_json, output_schema_json, risk_level, cost_hint, version, is_enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) ON CONFLICT(name) DO UPDATE SET description = excluded.description, input_schema_json = excluded.input_schema_json, output_schema_json = excluded.output_schema_json, risk_level = excluded.risk_level, cost_hint = excluded.cost_hint, version = excluded.version, is_enabled = excluded.is_enabled, updated_at = excluded.updated_at"
    )
    .bind(name, description, inputSchema, outputSchema, risk, String(body.cost_hint || ""), version, isEnabled, ts)
    .run();

  const endpointId = String(body.endpoint_id || `endpoint-${name}-${version}`);
  const handlerType = String(body.handler_type || "internal");
  const handlerRef = String(body.handler_ref || `cloud_os.${name}`);
  const timeoutMs = Math.max(100, Number(body.timeout_ms || 10000));

  await db
    .prepare(
      "INSERT INTO tool_endpoints (id, tool_name, handler_type, handler_ref, timeout_ms, is_enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6) ON CONFLICT(id) DO UPDATE SET tool_name = excluded.tool_name, handler_type = excluded.handler_type, handler_ref = excluded.handler_ref, timeout_ms = excluded.timeout_ms, is_enabled = excluded.is_enabled, updated_at = excluded.updated_at"
    )
    .bind(endpointId, name, handlerType, handlerRef, timeoutMs, ts)
    .run();

  return json({ ok: true, tool: { name, version, endpoint_id: endpointId } });
}

async function handleListMemoriesV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "").trim();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  let sql = "SELECT id, type, content, confidence, ttl, source_run_id, created_at, updated_at FROM memories WHERE workspace_id = ?1";
  const bind: Array<string | number> = [workspaceId];

  if (type) {
    sql += ` AND type = ?${bind.length + 1}`;
    bind.push(type);
  }
  if (q) {
    sql += ` AND lower(content) LIKE ?${bind.length + 1}`;
    bind.push(`%${q}%`);
  }

  sql += ` ORDER BY updated_at DESC LIMIT ?${bind.length + 1}`;
  bind.push(limit);

  const rows = await db.prepare(sql).bind(...bind).all<Record<string, unknown>>();
  return json({ ok: true, memories: rows.results || [] });
}

async function handleCreateDelegationV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const role = await getMembershipRole(db, workspaceId, resolved.user.id);
  if (!["owner", "admin", "system_owner"].includes(role)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const grantorUserId = String(body.grantor_user_id || "").trim();
  const granteeUserId = String(body.grantee_user_id || "").trim();
  const tools = Array.isArray(body.tools) ? body.tools.map(String) : [];
  const validFrom = Number(body.valid_from || nowMs());
  const validUntil = Number(body.valid_until || nowMs() + 7 * 24 * 60 * 60 * 1000);

  if (!grantorUserId || !granteeUserId || tools.length === 0) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const id = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO delegations (id, workspace_id, grantor_user_id, grantee_user_id, tools_json, valid_from, valid_until, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, ?8)"
    )
    .bind(id, workspaceId, grantorUserId, granteeUserId, JSON.stringify(tools), validFrom, validUntil, ts)
    .run();

  return json({ ok: true, delegation: { id, workspace_id: workspaceId } }, 201);
}

async function handleListDelegationsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const rows = await db
    .prepare(
      "SELECT id, grantor_user_id, grantee_user_id, tools_json, valid_from, valid_until, status, created_at, updated_at FROM delegations WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT 200"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    delegations: (rows.results || []).map((row) => ({
      ...row,
      tools_json: safeJsonParse(row.tools_json as string | null, []),
    })),
  });
}

async function handleCreateGoalV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const objective = String(body.objective || "").trim();
  if (!objective) return json({ ok: false, error: "invalid_objective" }, 400);

  const id = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO goals (id, workspace_id, objective, constraints_json, schedule_rrule, success_metrics_json, status, last_run_at, next_run_at, created_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?10)"
    )
    .bind(
      id,
      workspaceId,
      objective,
      JSON.stringify(body.constraints || {}),
      typeof body.schedule_rrule === "string" ? body.schedule_rrule : null,
      JSON.stringify(body.success_metrics || {}),
      String(body.status || "active"),
      typeof body.next_run_at === "number" ? body.next_run_at : null,
      resolved.user.id,
      ts
    )
    .run();

  return json({ ok: true, goal: { id, workspace_id: workspaceId, objective } }, 201);
}

async function handleListGoalsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const rows = await db
    .prepare(
      "SELECT id, objective, constraints_json, schedule_rrule, success_metrics_json, status, last_run_at, next_run_at, created_by_user_id, created_at, updated_at FROM goals WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT 200"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    goals: (rows.results || []).map((row) => ({
      ...row,
      constraints_json: safeJsonParse(row.constraints_json as string | null, {}),
      success_metrics_json: safeJsonParse(row.success_metrics_json as string | null, {}),
    })),
  });
}

async function handleCreateFederationRequestV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const sourceWorkspaceId = await getActiveWorkspaceId(db, resolved);
  if (!sourceWorkspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const targetWorkspaceId = String(body.target_workspace_id || "").trim();
  const dataScope = String(body.data_scope || "summary").trim();
  if (!targetWorkspaceId) return json({ ok: false, error: "invalid_target_workspace" }, 400);

  const id = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO federation_requests (id, source_workspace_id, target_workspace_id, request_run_id, requested_by_user_id, data_scope, request_json, response_json, status, approved_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'pending', NULL, ?8, ?8)"
    )
    .bind(
      id,
      sourceWorkspaceId,
      targetWorkspaceId,
      typeof body.request_run_id === "string" ? body.request_run_id : null,
      resolved.user.id,
      dataScope,
      JSON.stringify(body.request || {}),
      ts
    )
    .run();

  return json({ ok: true, federation_request: { id, status: "pending" } }, 201);
}

async function handleListFederationRequestsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const rows = await db
    .prepare(
      "SELECT id, source_workspace_id, target_workspace_id, request_run_id, requested_by_user_id, data_scope, request_json, response_json, status, approved_by_user_id, created_at, updated_at FROM federation_requests WHERE source_workspace_id = ?1 OR target_workspace_id = ?1 ORDER BY created_at DESC LIMIT 200"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    federation_requests: (rows.results || []).map((row) => ({
      ...row,
      request_json: safeJsonParse(row.request_json as string | null, {}),
      response_json: safeJsonParse(row.response_json as string | null, null),
    })),
  });
}

async function handleRunEvalSuiteV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const suiteId = String(body.suite_id || "").trim();
  if (!suiteId) {
    return json({ ok: false, error: "invalid_suite_id" }, 400);
  }

  const suite = await db
    .prepare("SELECT id, name FROM eval_suites WHERE id = ?1 LIMIT 1")
    .bind(suiteId)
    .first<{ id: string; name: string }>();
  if (!suite) {
    return json({ ok: false, error: "suite_not_found" }, 404);
  }

  const cases = await db
    .prepare(
      "SELECT id, intent_text, expected_tool_name, expected_schema_json, max_cost_cents, max_duration_ms FROM eval_cases WHERE suite_id = ?1 ORDER BY created_at ASC"
    )
    .bind(suiteId)
    .all<{
      id: string;
      intent_text: string;
      expected_tool_name: string | null;
      expected_schema_json: string | null;
      max_cost_cents: number | null;
      max_duration_ms: number | null;
    }>();

  const evalRunId = crypto.randomUUID();
  const started = nowMs();
  await db
    .prepare(
      "INSERT INTO eval_runs (id, suite_id, workspace_id, dry_run, status, started_at, finished_at, result_json, created_at) VALUES (?1, ?2, ?3, 1, 'running', ?4, NULL, NULL, ?4)"
    )
    .bind(evalRunId, suiteId, workspaceId, started)
    .run();

  const results = (cases.results || []).map((testCase) => {
    const plan = buildFallbackPlan(testCase.intent_text);
    const firstTool = plan.nodes.find((n) => n.type === "tool")?.tool_name || null;
    const toolMatch = testCase.expected_tool_name ? firstTool === testCase.expected_tool_name : true;
    const schemaValid = plan.nodes.every((node) => {
      if (node.type !== "tool" || !node.tool_name) return true;
      return typeof node.input === "object";
    });

    return {
      case_id: testCase.id,
      intent_text: testCase.intent_text,
      produced_first_tool: firstTool,
      expected_tool_name: testCase.expected_tool_name,
      tool_choice_ok: toolMatch,
      schema_valid: schemaValid,
      safety_violations: 0,
      estimated_cost_cents: estimateCostCents(estimateTokens(testCase.intent_text)),
      estimated_duration_ms: Math.max(50, testCase.intent_text.length * 4),
      passed: toolMatch && schemaValid,
    };
  });

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    tool_choice_accuracy: results.length === 0 ? 1 : results.filter((r) => r.tool_choice_ok).length / results.length,
    schema_validity: results.length === 0 ? 1 : results.filter((r) => r.schema_valid).length / results.length,
  };

  await db
    .prepare("UPDATE eval_runs SET status = 'succeeded', finished_at = ?1, result_json = ?2 WHERE id = ?3")
    .bind(nowMs(), JSON.stringify({ summary, results }), evalRunId)
    .run();

  return json({ ok: true, eval_run: { id: evalRunId, suite_id: suiteId, summary }, results });
}

async function handleRuntimeMetricsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const runs = await db
    .prepare(
      "SELECT status, COUNT(*) AS count FROM runs WHERE workspace_id = ?1 AND created_at >= ?2 GROUP BY status"
    )
    .bind(workspaceId, nowMs() - 24 * 60 * 60 * 1000)
    .all<{ status: string; count: number }>();

  const success = (runs.results || []).find((r) => r.status === "succeeded")?.count || 0;
  const failed = (runs.results || []).find((r) => r.status === "failed")?.count || 0;
  const totalFinished = success + failed;

  const toolLatency = await db
    .prepare(
      "SELECT COALESCE(AVG(latency_ms),0) AS avg_latency_ms, COALESCE(MAX(latency_ms),0) AS p95_proxy_ms FROM tool_calls WHERE workspace_id = ?1 AND created_at >= ?2 AND latency_ms IS NOT NULL"
    )
    .bind(workspaceId, nowMs() - 24 * 60 * 60 * 1000)
    .first<{ avg_latency_ms: number; p95_proxy_ms: number }>();

  const queue = await db
    .prepare(
      "SELECT COUNT(*) AS queued FROM orchestration_queue WHERE workspace_id = ?1 AND status = 'queued'"
    )
    .bind(workspaceId)
    .first<{ queued: number }>();

  const usage = await loadUsageToday(db, workspaceId);

  return json({
    ok: true,
    metrics: {
      window: "24h",
      run_success_rate: totalFinished === 0 ? 1 : success / totalFinished,
      total_finished_runs: totalFinished,
      avg_tool_latency_ms: Number(toolLatency?.avg_latency_ms || 0),
      p95_tool_latency_proxy_ms: Number(toolLatency?.p95_proxy_ms || 0),
      queued_runs: Number(queue?.queued || 0),
      cost_today_cents: usage.cost,
      tokens_today: usage.tokens,
      slos: {
        run_success_rate_target: 0.98,
        p95_tool_latency_ms_target: 5000,
        queue_backlog_target: 50,
      },
    },
  });
}

async function handleListIncidentsV2(env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  const rows = await db
    .prepare(
      "SELECT id, run_id, severity, category, status, summary, detail_json, opened_at, acknowledged_at, resolved_at FROM incidents WHERE workspace_id = ?1 ORDER BY opened_at DESC LIMIT 200"
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    incidents: (rows.results || []).map((row) => ({
      ...row,
      detail_json: safeJsonParse(row.detail_json as string | null, {}),
    })),
  });
}

async function handleCreateIncidentV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const severity = String(body.severity || "P2");
  const category = String(body.category || "runtime");
  const summary = String(body.summary || "").trim();
  if (!summary) return json({ ok: false, error: "invalid_summary" }, 400);

  const id = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO incidents (id, workspace_id, run_id, severity, category, status, summary, detail_json, opened_at, acknowledged_at, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, NULL, NULL)"
    )
    .bind(id, workspaceId, typeof body.run_id === "string" ? body.run_id : null, severity, category, summary, JSON.stringify(body.detail || {}), ts)
    .run();

  return json({ ok: true, incident: { id, severity, category, status: "open" } }, 201);
}

async function handleCreateEvalSuiteV2(request: Request, env: CloudEnv, resolved: SessionLike): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const workspaceId = await getActiveWorkspaceId(db, resolved);
  if (!workspaceId) return json({ ok: false, error: "workspace_not_accessible" }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const name = String(body.name || "").trim();
  if (!name) return json({ ok: false, error: "invalid_name" }, 400);

  const suiteId = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      "INSERT INTO eval_suites (id, workspace_id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)"
    )
    .bind(suiteId, workspaceId, name, String(body.description || ""), ts)
    .run();

  const cases = Array.isArray(body.cases) ? (body.cases as Record<string, unknown>[]) : [];
  for (const item of cases) {
    const caseId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO eval_cases (id, suite_id, intent_text, expected_tool_name, expected_schema_json, max_cost_cents, max_duration_ms, tags_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"
      )
      .bind(
        caseId,
        suiteId,
        String(item.intent_text || ""),
        typeof item.expected_tool_name === "string" ? item.expected_tool_name : null,
        item.expected_schema_json ? JSON.stringify(item.expected_schema_json) : null,
        typeof item.max_cost_cents === "number" ? item.max_cost_cents : null,
        typeof item.max_duration_ms === "number" ? item.max_duration_ms : null,
        JSON.stringify(item.tags || []),
        ts
      )
      .run();
  }

  return json({ ok: true, suite: { id: suiteId, name, cases: cases.length } }, 201);
}

// ---------------------------------------------------------------------------
// Integration Status — Single Source of Truth
// GET /v1/os/workspaces/:workspaceId/integrations/status
// ---------------------------------------------------------------------------

type IntegrationStatusEntry = {
  integrationKey: string;
  connected: boolean;
  state: "connected" | "needs_auth" | "error" | "disabled";
  scopes: string[];
  health: "ok" | "degraded" | "down";
  lastCheckedAt: string;
  reauthUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type TokenBridgePayload = {
  integrationKey: string;
  present: boolean;
  scopes?: string[];
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
};

const INTEGRATION_STATUS_CACHE_TTL_S = 45;
const INTEGRATION_STATUS_CACHE_VERSION = "v2";

function integrationStatusCacheKey(workspaceId: string): string {
  return `ws:${workspaceId}:integrationStatus:${INTEGRATION_STATUS_CACHE_VERSION}`;
}

async function fetchTokenBridge(
  appOrigin: string,
  internalSecret: string,
  workspaceId: string,
  key: string,
): Promise<TokenBridgePayload | null> {
  try {
    const url = `${appOrigin}/api/internal/workspaces/${encodeURIComponent(workspaceId)}/integrations/${encodeURIComponent(key)}/token`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-elyra-internal-secret": internalSecret,
        "content-type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TokenBridgePayload;
    return data;
  } catch {
    return null;
  }
}

function mapTokenBridgeToStatus(
  key: string,
  data: TokenBridgePayload | null,
  reauthUrl: string | null,
): IntegrationStatusEntry {
  const now = new Date().toISOString();

  if (!data || !data.present) {
    return {
      integrationKey: key,
      connected: false,
      state: "needs_auth",
      scopes: [],
      health: "down",
      lastCheckedAt: now,
      reauthUrl,
      errorCode: "not_connected",
      errorMessage: "No credentials found for this workspace.",
    };
  }

  // Google: connected if refreshToken exists (or non-expired accessToken)
  if (key === "google_oauth" || key === "google") {
    const hasRefresh = Boolean(data.refreshToken);
    const hasAccess = Boolean(data.accessToken);
    const expired = data.expiresAt ? new Date(data.expiresAt).getTime() < Date.now() + 30_000 : true;
    const connected = hasRefresh || (hasAccess && !expired);
    const expiringSoon = hasAccess && !hasRefresh && !expired &&
      new Date(data.expiresAt ?? "").getTime() < Date.now() + 5 * 60_000;
    return {
      integrationKey: key,
      connected,
      state: connected ? (expiringSoon ? "needs_auth" : "connected") : "needs_auth",
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
      health: connected ? (expiringSoon ? "degraded" : "ok") : "down",
      lastCheckedAt: now,
      reauthUrl,
      errorCode: connected ? null : "token_expired",
      errorMessage: connected ? null : "Google token expired or missing. Reconnect Google.",
    };
  }

  // IMAP / iCloud IMAP: connected if host + username + password present
  if (key === "imap" || key === "icloud_imap") {
    const connected = Boolean(data.host && data.username && data.password);
    return {
      integrationKey: key,
      connected,
      state: connected ? "connected" : "needs_auth",
      scopes: [],
      health: connected ? "ok" : "down",
      lastCheckedAt: now,
      reauthUrl,
      errorCode: connected ? null : "credentials_missing",
      errorMessage: connected ? null : "IMAP credentials missing. Reconnect iCloud for this workspace.",
    };
  }

  // CalDAV
  if (key === "icloud_caldav") {
    const connected = Boolean(data.host && data.username && data.password);
    return {
      integrationKey: key,
      connected,
      state: connected ? "connected" : "needs_auth",
      scopes: [],
      health: connected ? "ok" : "down",
      lastCheckedAt: now,
      reauthUrl,
      errorCode: connected ? null : "credentials_missing",
      errorMessage: connected ? null : "CalDAV credentials missing for this workspace.",
    };
  }

  // Unknown integration
  return {
    integrationKey: key,
    connected: data.present,
    state: data.present ? "connected" : "disabled",
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
    health: data.present ? "ok" : "down",
    lastCheckedAt: now,
    reauthUrl,
    errorCode: null,
    errorMessage: null,
  };
}

async function handleWorkspaceIntegrationStatusV2(
  request: Request,
  env: CloudEnv,
  resolved: SessionLike,
  workspaceId: string,
): Promise<Response> {
  const db = env.ASSISTANT_DB;
  const kv = env.ASSISTANT_KV;

  // Membership check
  const role = await getMembershipRole(db, workspaceId, resolved.user.id);
  if (role === "viewer" || role === "") {
    const membership = await db
      .prepare("SELECT workspace_id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1")
      .bind(resolved.user.id, workspaceId)
      .first<{ workspace_id: string }>();
    if (!membership) {
      return json({ ok: false, error: "workspace_not_accessible" }, 403);
    }
  }

  // KV cache check
  const cacheKey = integrationStatusCacheKey(workspaceId);
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { integrations: IntegrationStatusEntry[]; cachedAt: string };
        return json({ ok: true, workspaceId, integrations: parsed.integrations, cachedAt: parsed.cachedAt, fromCache: true });
      }
    } catch {
      // cache miss — continue
    }
  }

  const appOrigin = (env.APP_ORIGIN ?? "").replace(/\/$/, "");
  const internalSecret = (env.ELYRA_INTERNAL_SECRET ?? env.INTERNAL_API_SECRET ?? "").trim();

  // Check if token bridge is available
  if (!appOrigin || !internalSecret) {
    // Fallback: return status from D1 integrations if available, else generic needs_auth
    const now = new Date().toISOString();
    const fallback: IntegrationStatusEntry[] = [
      { integrationKey: "google_oauth", connected: false, state: "needs_auth", scopes: [], health: "down", lastCheckedAt: now, reauthUrl: `/api/google/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=%2Fos`, errorCode: "bridge_unavailable", errorMessage: "Token bridge not configured." },
      { integrationKey: "imap", connected: false, state: "needs_auth", scopes: [], health: "down", lastCheckedAt: now, reauthUrl: null, errorCode: "bridge_unavailable", errorMessage: "Token bridge not configured." },
      { integrationKey: "icloud_imap", connected: false, state: "needs_auth", scopes: [], health: "down", lastCheckedAt: now, reauthUrl: null, errorCode: "bridge_unavailable", errorMessage: "Token bridge not configured." },
      { integrationKey: "icloud_caldav", connected: false, state: "needs_auth", scopes: [], health: "down", lastCheckedAt: now, reauthUrl: null, errorCode: "bridge_unavailable", errorMessage: "Token bridge not configured." },
    ];
    return json({ ok: true, workspaceId, integrations: fallback, fromCache: false });
  }

  const integrationKeys = ["google_oauth", "imap", "icloud_imap", "icloud_caldav"] as const;
  const reauthUrls: Record<string, string | null> = {
    google_oauth: `/api/google/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=%2Fos`,
    imap: null,
    icloud_imap: null,
    icloud_caldav: null,
  };

  // Fetch all in parallel
  const bridgeResults = await Promise.all(
    integrationKeys.map((key) => fetchTokenBridge(appOrigin, internalSecret, workspaceId, key)),
  );

  const integrations: IntegrationStatusEntry[] = integrationKeys.map((key, i) =>
    mapTokenBridgeToStatus(key, bridgeResults[i], reauthUrls[key] ?? null),
  );

  // Write to KV cache
  if (kv) {
    try {
      await kv.put(
        cacheKey,
        JSON.stringify({ integrations, cachedAt: new Date().toISOString() }),
        { expirationTtl: INTEGRATION_STATUS_CACHE_TTL_S },
      );
    } catch {
      // non-fatal
    }
  }

  return json({ ok: true, workspaceId, integrations, fromCache: false });
}

/** Invalidate the integration status KV cache for a workspace (call after connect/disconnect) */
export async function invalidateIntegrationStatusCache(env: CloudEnv, workspaceId: string): Promise<void> {
  if (!env.ASSISTANT_KV) return;
  try {
    await env.ASSISTANT_KV.delete(integrationStatusCacheKey(workspaceId));
  } catch {
    // non-fatal
  }
}

export async function handleV1OsRequest(request: Request, env: CloudEnv, resolved: SessionLike | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/os")) {
    return null;
  }

  const signatureError = await verifyProxySignature(request, env);
  if (signatureError) return signatureError;

  const maintenanceMode = (env.ASSISTANT_OS_MAINTENANCE_MODE || "").trim().toLowerCase() === "true";
  if (maintenanceMode) {
    return json(
      {
        ok: false,
        error: "maintenance_mode",
        message: "Orchestration runtime is temporarily disabled for maintenance.",
      },
      503
    );
  }

  if (!resolved) {
    return json({ ok: false, error: "AUTH_REQUIRED", message: "Not authenticated" }, 401);
  }

  if (url.pathname === "/v1/os/runs" && request.method === "POST") {
    return handleCreateRunV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/runs" && request.method === "GET") {
    return handleListRunsV2(request, env, resolved);
  }

  const runMatch = url.pathname.match(/^\/v1\/os\/runs\/([a-f0-9-]+)$/);
  if (runMatch && request.method === "GET") {
    return handleGetRunV2(env, resolved, runMatch[1]);
  }

  const runCancelMatch = url.pathname.match(/^\/v1\/os\/runs\/([a-f0-9-]+)\/cancel$/);
  if (runCancelMatch && request.method === "POST") {
    return handleCancelRunV2(env, resolved, runCancelMatch[1]);
  }

  const runResumeMatch = url.pathname.match(/^\/v1\/os\/runs\/([a-f0-9-]+)\/resume$/);
  if (runResumeMatch && request.method === "POST") {
    return handleResumeRunV2(env, resolved, runResumeMatch[1]);
  }

  if (url.pathname === "/v1/os/worker/tick" && request.method === "POST") {
    const workerEnabled = (env.ASSISTANT_OS_WORKER_ENABLED || "true").trim().toLowerCase() !== "false";
    if (!workerEnabled) {
      return json(
        {
          ok: false,
          error: "worker_disabled",
          message: "Worker tick is disabled by configuration.",
        },
        503
      );
    }
    return handleWorkerTickV2(env, resolved);
  }

  if (url.pathname === "/v1/os/approvals" && request.method === "GET") {
    return handleListApprovalsV2(env, resolved);
  }

  const approveMatch = url.pathname.match(/^\/v1\/os\/approvals\/([a-f0-9-]+)\/approve$/);
  if (approveMatch && request.method === "POST") {
    return handleResolveApprovalV2(env, resolved, approveMatch[1], "approved");
  }

  const rejectMatch = url.pathname.match(/^\/v1\/os\/approvals\/([a-f0-9-]+)\/reject$/);
  if (rejectMatch && request.method === "POST") {
    return handleResolveApprovalV2(env, resolved, rejectMatch[1], "rejected");
  }

  if (url.pathname === "/v1/os/tools" && request.method === "GET") {
    return handleListToolsV2(env);
  }

  if (url.pathname === "/v1/os/tools" && request.method === "POST") {
    return handleUpsertToolV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/memories" && request.method === "GET") {
    return handleListMemoriesV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/delegations" && request.method === "GET") {
    return handleListDelegationsV2(env, resolved);
  }

  if (url.pathname === "/v1/os/delegations" && request.method === "POST") {
    return handleCreateDelegationV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/goals" && request.method === "GET") {
    return handleListGoalsV2(env, resolved);
  }

  if (url.pathname === "/v1/os/goals" && request.method === "POST") {
    return handleCreateGoalV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/federation/requests" && request.method === "GET") {
    return handleListFederationRequestsV2(env, resolved);
  }

  if (url.pathname === "/v1/os/federation/requests" && request.method === "POST") {
    return handleCreateFederationRequestV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/evals/suites" && request.method === "POST") {
    return handleCreateEvalSuiteV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/evals/run" && request.method === "POST") {
    return handleRunEvalSuiteV2(request, env, resolved);
  }

  if (url.pathname === "/v1/os/metrics" && request.method === "GET") {
    return handleRuntimeMetricsV2(env, resolved);
  }

  if (url.pathname === "/v1/os/incidents" && request.method === "GET") {
    return handleListIncidentsV2(env, resolved);
  }

  if (url.pathname === "/v1/os/incidents" && request.method === "POST") {
    return handleCreateIncidentV2(request, env, resolved);
  }

  // Integration status — single source of truth
  const integrationStatusMatch = url.pathname.match(
    /^\/v1\/os\/workspaces\/([^/]+)\/integrations\/status$/,
  );
  if (integrationStatusMatch && request.method === "GET") {
    const wsId = decodeURIComponent(integrationStatusMatch[1]!);
    return handleWorkspaceIntegrationStatusV2(request, env, resolved, wsId);
  }

  return json({ ok: false, error: "not_found" }, 404);
}
