-- Team invitations. Only the SHA-256 hash of the link token is stored.
-- The worker also creates this table on first use (team.ts › ensureTeamSchema).

CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,                 -- 'owner' | 'admin' | 'member' | 'viewer'
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- 7 days after creation
  accepted_at INTEGER,
  accepted_by_user_id TEXT,
  revoked_at INTEGER,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_workspace ON team_invites(workspace_id);
