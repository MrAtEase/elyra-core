-- Elyra: KI-Sichtbarkeit (GEO-Monitoring) – Projekte und Messungen
BEGIN;

CREATE TABLE IF NOT EXISTS public.visibility_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
  location text,
  industry text,
  language text NOT NULL DEFAULT 'de',
  prompts jsonb NOT NULL DEFAULT '[]'::jsonb,
  providers jsonb NOT NULL DEFAULT '["gemini"]'::jsonb,
  web_search boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.visibility_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.visibility_projects(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visibility_projects_ws_idx ON public.visibility_projects (workspace_id);
CREATE INDEX IF NOT EXISTS visibility_runs_project_idx ON public.visibility_runs (project_id, created_at);

ALTER TABLE public.visibility_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visibility_runs ENABLE ROW LEVEL SECURITY;

COMMIT;
