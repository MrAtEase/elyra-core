-- Suspended workspaces (platform owner only). A suspended workspace is hidden from its
-- members and every membership check fails until it is reactivated.
-- The worker also creates this table on first use (platform.ts › ensurePlatformSchema).

CREATE TABLE IF NOT EXISTS workspace_suspensions (
  workspace_id TEXT PRIMARY KEY,
  reason TEXT,
  suspended_by_user_id TEXT NOT NULL,
  suspended_at INTEGER NOT NULL
);
