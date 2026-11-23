-- Elyra: MCP-Server (Notion, Linear, GitHub, lokale Server …) pro Workspace
BEGIN;

CREATE TABLE IF NOT EXISTS public.mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,  -- workspaces.id ist hier text
  name text NOT NULL,
  catalog_id text,
  transport text NOT NULL CHECK (transport IN ('http', 'stdio')),
  url text,
  command text,
  args jsonb NOT NULL DEFAULT '[]'::jsonb,
  auth_type text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'token', 'oauth')),
  secrets_enc text,                 -- AES-256-GCM (TOKEN_ENCRYPTION_KEY): Tokens, Header, Env, OAuth
  oauth_pending jsonb,              -- state/PKCE während der Anmeldung
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'connected', 'needs_auth', 'error')),
  last_error text,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_servers_workspace_idx ON public.mcp_servers (workspace_id);
CREATE INDEX IF NOT EXISTS mcp_servers_oauth_state_idx ON public.mcp_servers ((oauth_pending->>'state'));

-- Zugriff nur serverseitig (Service-Role); Browser liest nie direkt.
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

COMMIT;
