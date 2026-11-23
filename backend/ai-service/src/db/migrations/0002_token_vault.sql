-- Encrypted Google OAuth tokens per workspace

CREATE TABLE IF NOT EXISTS workspace_google_tokens (
  workspace_id    TEXT PRIMARY KEY,
  access_token    TEXT NOT NULL,      -- AES-256-GCM encrypted
  refresh_token   TEXT NOT NULL,      -- AES-256-GCM encrypted
  token_expiry    TIMESTAMPTZ NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
