-- Phase 1-4 runtime expansion for persistent AI-OS orchestration.

-- ---------------------------------------------------------------------------
-- Phase 1: run reliability, replay, idempotency, lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE runs ADD COLUMN intent_text TEXT;
ALTER TABLE runs ADD COLUMN plan_json TEXT;
ALTER TABLE runs ADD COLUMN current_step TEXT;
ALTER TABLE runs ADD COLUMN run_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE runs ADD COLUMN canceled_by_user_id TEXT;
ALTER TABLE runs ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN claim_token TEXT;
ALTER TABLE runs ADD COLUMN claim_expires_at INTEGER;
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE runs ADD COLUMN goal_id TEXT;
ALTER TABLE runs ADD COLUMN replay_of_run_id TEXT;

ALTER TABLE run_steps ADD COLUMN node_id TEXT;
ALTER TABLE run_steps ADD COLUMN step_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE run_steps ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_steps ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE run_steps ADD COLUMN error_code TEXT;
ALTER TABLE run_steps ADD COLUMN error_message TEXT;
ALTER TABLE run_steps ADD COLUMN idempotency_key TEXT;
ALTER TABLE run_steps ADD COLUMN depends_on_json TEXT;
ALTER TABLE run_steps ADD COLUMN checkpoint_json TEXT;

ALTER TABLE tool_calls ADD COLUMN step_id TEXT;
ALTER TABLE tool_calls ADD COLUMN input_json TEXT;
ALTER TABLE tool_calls ADD COLUMN output_json TEXT;
ALTER TABLE tool_calls ADD COLUMN idempotency_key TEXT;
ALTER TABLE tool_calls ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tool_calls ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tool_calls ADD COLUMN latency_ms INTEGER;
ALTER TABLE tool_calls ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tool_calls ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tool_calls ADD COLUMN error_message TEXT;
ALTER TABLE tool_calls ADD COLUMN tool_version TEXT;
ALTER TABLE tool_calls ADD COLUMN endpoint_id TEXT;
ALTER TABLE tool_calls ADD COLUMN approval_id TEXT;
ALTER TABLE tool_calls ADD COLUMN started_by_worker_id TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_status_updated ON runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_runs_claim_expires ON runs(claim_expires_at);
CREATE INDEX IF NOT EXISTS idx_run_steps_node ON run_steps(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_idempotency ON tool_calls(run_id, idempotency_key);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ref TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at);

CREATE TABLE IF NOT EXISTS orchestration_queue (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  lease_until INTEGER,
  worker_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id),
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_queue_claim ON orchestration_queue(status, available_at, lease_until, priority);

-- ---------------------------------------------------------------------------
-- Phase 2: tool registry, permissioning, approvals, costs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tools (
  name TEXT PRIMARY KEY,
  description TEXT,
  input_schema_json TEXT NOT NULL,
  output_schema_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  cost_hint TEXT,
  version TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_endpoints (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  handler_ref TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(tool_name) REFERENCES tools(name)
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, role, tool_name),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(tool_name) REFERENCES tools(name)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  approved_by_user_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  UNIQUE(tool_call_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY(approved_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(workspace_id, status, created_at);

CREATE TABLE IF NOT EXISTS workspace_budgets (
  workspace_id TEXT PRIMARY KEY,
  hard_limit_cents_per_day INTEGER NOT NULL,
  soft_limit_cents_per_day INTEGER NOT NULL,
  hard_limit_tokens_per_day INTEGER NOT NULL,
  soft_limit_tokens_per_day INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  run_id TEXT,
  tool_call_id TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  category TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_ws_day ON usage_ledger(workspace_id, created_at);

-- ---------------------------------------------------------------------------
-- Phase 3: graph brain, memory, evals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding_json TEXT,
  source_run_id TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  ttl INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(source_run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_workspace_type ON memories(workspace_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS run_graph_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  tool_name TEXT,
  status TEXT NOT NULL,
  input_json TEXT,
  output_artifact_id TEXT,
  condition_json TEXT,
  depends_on_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, node_key),
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS run_graph_edges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  from_node_key TEXT NOT NULL,
  to_node_key TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  condition_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_run ON run_graph_nodes(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_graph_edges_run ON run_graph_edges(run_id, created_at);

CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  intent_text TEXT NOT NULL,
  expected_tool_name TEXT,
  expected_schema_json TEXT,
  max_cost_cents INTEGER,
  max_duration_ms INTEGER,
  tags_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(suite_id) REFERENCES eval_suites(id)
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  workspace_id TEXT,
  dry_run INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(suite_id) REFERENCES eval_suites(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

-- ---------------------------------------------------------------------------
-- Phase 4: org policy, delegation, federation, goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  grantor_user_id TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(grantor_user_id) REFERENCES users(id),
  FOREIGN KEY(grantee_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_delegations_lookup ON delegations(workspace_id, grantor_user_id, grantee_user_id, status, valid_until);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  scope TEXT NOT NULL,
  role TEXT,
  tool_name TEXT,
  risk_level TEXT,
  data_classification TEXT,
  effect TEXT NOT NULL,
  condition_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS federation_requests (
  id TEXT PRIMARY KEY,
  source_workspace_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  request_run_id TEXT,
  requested_by_user_id TEXT NOT NULL,
  data_scope TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL,
  approved_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(source_workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(target_workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY(approved_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  constraints_json TEXT,
  schedule_rrule TEXT,
  success_metrics_json TEXT,
  status TEXT NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Operations: incident and migration observability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  run_id TEXT,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT,
  opened_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS schema_versions (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  version TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  metadata_json TEXT
);

INSERT INTO schema_versions (id, component, version, applied_at, metadata_json)
VALUES (lower(hex(randomblob(16))), 'orchestration-runtime', 'v2-phase-1-4', strftime('%s','now') * 1000, '{"migration":"0006_orchestration_runtime_v2"}');

-- Seed core tools for immediate use.
INSERT OR IGNORE INTO tools (
  name,
  description,
  input_schema_json,
  output_schema_json,
  risk_level,
  cost_hint,
  version,
  is_enabled,
  created_at,
  updated_at
)
VALUES
  ('http_request', 'Perform constrained HTTP request', '{"type":"object","required":["url"],"properties":{"url":{"type":"string"},"method":{"type":"string"},"headers":{"type":"object"},"body":{"type":"string"}}}', '{"type":"object"}', 'writes', 'external_api', '1.0.0', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('memory_read', 'Retrieve memory snippets', '{"type":"object","properties":{"query":{"type":"string"},"type":{"type":"string"},"limit":{"type":"number"}}}', '{"type":"object"}', 'read_only', 'internal', '1.0.0', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('memory_write', 'Persist workspace memory', '{"type":"object","required":["type","content"],"properties":{"type":{"type":"string"},"content":{"type":"string"},"confidence":{"type":"number"},"ttl":{"type":"number"}}}', '{"type":"object"}', 'writes', 'internal', '1.0.0', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('artifact_create', 'Persist structured run artifact', '{"type":"object","required":["type"],"properties":{"type":{"type":"string"},"ref":{"type":"string"},"metadata":{"type":"object"}}}', '{"type":"object"}', 'writes', 'internal', '1.0.0', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR IGNORE INTO tool_endpoints (
  id,
  tool_name,
  handler_type,
  handler_ref,
  timeout_ms,
  is_enabled,
  created_at,
  updated_at
)
VALUES
  ('endpoint-http-request-v1', 'http_request', 'internal', 'cloud_os.http_request', 10000, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('endpoint-memory-read-v1', 'memory_read', 'internal', 'cloud_os.memory_read', 2000, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('endpoint-memory-write-v1', 'memory_write', 'internal', 'cloud_os.memory_write', 2000, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('endpoint-artifact-create-v1', 'artifact_create', 'internal', 'cloud_os.artifact_create', 2000, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT OR IGNORE INTO workspace_budgets (
  workspace_id,
  hard_limit_cents_per_day,
  soft_limit_cents_per_day,
  hard_limit_tokens_per_day,
  soft_limit_tokens_per_day,
  updated_at
)
VALUES ('vision-2035', 50000, 40000, 500000, 400000, strftime('%s','now') * 1000);

INSERT OR IGNORE INTO tool_permissions (
  id,
  workspace_id,
  role,
  tool_name,
  allowed,
  requires_approval,
  created_at,
  updated_at
)
VALUES
  ('perm-vision-owner-http', 'vision-2035', 'system_owner', 'http_request', 1, 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('perm-vision-owner-memory-read', 'vision-2035', 'system_owner', 'memory_read', 1, 0, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('perm-vision-owner-memory-write', 'vision-2035', 'system_owner', 'memory_write', 1, 0, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
  ('perm-vision-owner-artifact', 'vision-2035', 'system_owner', 'artifact_create', 1, 0, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
