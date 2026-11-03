-- Schema migration for the assistant's user, workspace, and onboarding tables.
-- Run this with `wrangler d1 migrations apply` (with the ASSISTANT_DB binding configured).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER,
  display_name TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  last_login_at INTEGER,
  default_workspace_id TEXT
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER,
  created_at INTEGER,
  UNIQUE(provider, provider_user_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER,
  created_by_user_id TEXT NOT NULL,
  brand_json TEXT,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT,
  created_at INTEGER,
  UNIQUE(user_id, workspace_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS onboarding (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  state TEXT NOT NULL,
  payload_json TEXT,
  updated_at INTEGER,
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  locale TEXT,
  orb_variant TEXT,
  theme TEXT,
  updated_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  active_workspace_id TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(active_workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT,
  invited_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  token TEXT NOT NULL,
  invite_url TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  expires_at INTEGER,
  accepted_by_user_id TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(invited_by_user_id) REFERENCES users(id),
  FOREIGN KEY(accepted_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  requested_caps_json TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  resolved_by_user_id TEXT,
  resolution_note TEXT,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(requester_user_id) REFERENCES users(id),
  FOREIGN KEY(resolved_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workspace_connection_configs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(connection_id),
  FOREIGN KEY(connection_id) REFERENCES workspace_connections(id)
);

CREATE TABLE IF NOT EXISTS workspace_connection_domains (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  active_connection_id TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(workspace_id, domain),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(active_connection_id) REFERENCES workspace_connections(id)
);
