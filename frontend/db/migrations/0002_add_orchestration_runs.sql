-- Migration to add orchestration_runs table for persisting AI agent state.
BEGIN;

CREATE TYPE public.orchestration_run_status AS ENUM (
  'thinking',
  'plan_ready',
  'executing',
  'done',
  'failed',
  'canceled'
);

CREATE TABLE IF NOT EXISTS public.orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status public.orchestration_run_status NOT NULL DEFAULT 'thinking',
  intent text,
  plan_json jsonb,
  current_step_id text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS orchestration_runs_workspace_status_idx ON public.orchestration_runs (workspace_id, status);
CREATE INDEX IF NOT EXISTS orchestration_runs_workspace_user_idx ON public.orchestration_runs (workspace_id, user_id);

-- Row-Level Security
ALTER TABLE public.orchestration_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orchestration_runs_workspace_members ON public.orchestration_runs;
CREATE POLICY orchestration_runs_workspace_members ON public.orchestration_runs
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

-- Touch updated_at trigger
DROP TRIGGER IF EXISTS orchestration_runs_touch_updated_at ON public.orchestration_runs;
CREATE TRIGGER orchestration_runs_touch_updated_at
  BEFORE UPDATE ON public.orchestration_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orchestration_runs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orchestration_runs;
    END IF;
  END IF;
END;
$$;

COMMIT;
