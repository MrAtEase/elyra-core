-- AI Runs tables (ai_ prefix to avoid D1 collision)

CREATE TABLE IF NOT EXISTS ai_runs (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  prompt        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','awaiting_approval','completed','failed','cancelled')),
  plan_summary  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_runs_workspace ON ai_runs(workspace_id, created_at DESC);
CREATE INDEX idx_ai_runs_user ON ai_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_run_steps (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  index             INT NOT NULL,
  tool_name         TEXT NOT NULL,
  label             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed','skipped')),
  input             JSONB NOT NULL DEFAULT '{}',
  output            JSONB,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_ai_run_steps_run ON ai_run_steps(run_id, index);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id                TEXT PRIMARY KEY,
  step_id           TEXT NOT NULL REFERENCES ai_run_steps(id) ON DELETE CASCADE,
  model             TEXT NOT NULL,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(10,6) NOT NULL DEFAULT 0,
  duration_ms       INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_tool_calls_step ON ai_tool_calls(step_id);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  workspace_id          TEXT NOT NULL,
  date                  DATE NOT NULL,
  total_prompt_tokens   BIGINT NOT NULL DEFAULT 0,
  total_completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
  request_count         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, date)
);
