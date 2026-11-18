-- Vision 2035 Cloud Workspace OS reset + core runtime schema.

PRAGMA foreign_keys = OFF;

-- PHASE 0 reset: remove all existing workspace-scoped and run-scoped data.
DELETE FROM run_steps;
DELETE FROM tool_calls;
DELETE FROM runs;
DELETE FROM window_layouts;
DELETE FROM usage_daily;
DELETE FROM workspace_quotas;
DELETE FROM workspace_policies;
DELETE FROM confirmation_events;
DELETE FROM audit_log;
DELETE FROM poker_state;
DELETE FROM workspace_connection_domains;
DELETE FROM workspace_connection_configs;
DELETE FROM access_requests;
DELETE FROM workspace_invites;
DELETE FROM onboarding;
DELETE FROM memberships;
DELETE FROM sessions;
DELETE FROM workspaces;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_policies (
  workspace_id TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS workspace_quotas (
  workspace_id TEXT PRIMARY KEY,
  requests_per_day INTEGER NOT NULL,
  tokens_per_day INTEGER NOT NULL,
  cost_cents_per_day INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS usage_daily (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  requests_count INTEGER NOT NULL DEFAULT 0,
  tokens_count INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, user_id, day_utc),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  canceled_at INTEGER,
  pending_confirmation_event_id TEXT,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  input_hash TEXT,
  output_hash TEXT,
  correlation_id TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_step_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  host TEXT,
  method TEXT,
  request_json TEXT,
  response_json TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id),
  FOREIGN KEY(run_step_id) REFERENCES run_steps(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS window_layouts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, user_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_workspace_created ON runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_status ON runs(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_usage_daily_workspace_day ON usage_daily(workspace_id, day_utc);
CREATE INDEX IF NOT EXISTS idx_window_layouts_workspace_user ON window_layouts(workspace_id, user_id);

-- Seed deterministic bootstrap owner and singleton workspace.
INSERT OR IGNORE INTO users (
  id,
  email,
  email_verified,
  display_name,
  status,
  created_at,
  updated_at,
  last_login_at,
  default_workspace_id
)
VALUES (
  'vision-bootstrap-owner',
  'vision-bootstrap@elyra-core.app',
  1,
  'Vision Bootstrap Owner',
  'active',
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000,
  NULL
);

INSERT INTO workspaces (
  id,
  slug,
  type,
  name,
  created_at,
  created_by_user_id,
  brand_json
)
VALUES (
  'vision-2035',
  'vision-2035',
  'system_platform',
  'Vision 2035',
  strftime('%s','now') * 1000,
  'vision-bootstrap-owner',
  '{"productName":"Vision 2035","assistantName":"Orb","workspaceLabel":"Vision 2035"}'
);

INSERT OR IGNORE INTO memberships (
  id,
  user_id,
  workspace_id,
  role,
  title,
  created_at
)
VALUES (
  'vision-bootstrap-membership',
  'vision-bootstrap-owner',
  'vision-2035',
  'system_owner',
  'Bootstrap Owner',
  strftime('%s','now') * 1000
);

INSERT OR REPLACE INTO workspace_quotas (
  workspace_id,
  requests_per_day,
  tokens_per_day,
  cost_cents_per_day,
  updated_at
)
VALUES (
  'vision-2035',
  1000,
  500000,
  50000,
  strftime('%s','now') * 1000
);

INSERT OR REPLACE INTO workspace_policies (
  workspace_id,
  policy_json,
  updated_at
)
VALUES (
  'vision-2035',
  '{"allow_tools":["http_request"],"http_request":{"allowed_hosts":["api.github.com","api.openai.com"],"allowed_methods":["GET","HEAD","POST","DELETE"],"require_approval_methods":["POST","DELETE"],"require_approval_hosts":["api.openai.com"],"deny_private_ips":true,"timeout_ms":10000,"max_response_bytes":262144,"redact_headers":["authorization","cookie","set-cookie"]}}',
  strftime('%s','now') * 1000
);
