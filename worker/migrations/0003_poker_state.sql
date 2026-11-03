CREATE TABLE IF NOT EXISTS poker_state (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_poker_state_workspace ON poker_state(workspace_id);

SELECT 1;