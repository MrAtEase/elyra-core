-- Confirmation events and audit log for the Elli trust core.
-- Every mutating action must have a confirmed confirmation_event before execution.

CREATE TABLE IF NOT EXISTS confirmation_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,       -- 'send' | 'create' | 'update' | 'delete'
  target TEXT NOT NULL,            -- 'mail' | 'calendar' | 'task' | 'integration' | 'slides'
  proposal_json TEXT NOT NULL,     -- full ActionProposal serialized as JSON
  state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  executed_at INTEGER,
  result_state TEXT,               -- 'succeeded' | 'failed'
  error_message TEXT,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ce_workspace ON confirmation_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ce_user ON confirmation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ce_state ON confirmation_events(state);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'propose' | 'confirm' | 'cancel' | 'execute' | 'succeed' | 'fail'
  domain TEXT NOT NULL,             -- 'mail' | 'calendar' | 'task' | 'slides' | 'integration'
  resource_id TEXT,
  confirmation_event_id TEXT,
  metadata_json TEXT,               -- non-sensitive metadata only (no email bodies, no event descriptions)
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_al_workspace ON audit_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_al_ce ON audit_log(confirmation_event_id);
