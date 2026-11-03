-- Integrations + Integration Tokens for Google OAuth per workspace/user

DROP TABLE IF EXISTS public.integration_tokens CASCADE;
DROP TABLE IF EXISTS public.integrations CASCADE;

CREATE TABLE public.integrations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  connected_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE public.integration_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  integration_id TEXT NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integrations_workspace_provider ON public.integrations (workspace_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_tokens_integration ON public.integration_tokens (integration_id);
