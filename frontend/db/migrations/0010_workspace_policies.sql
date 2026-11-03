BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_policies (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  fast_model text NOT NULL DEFAULT 'gemini-2.0-flash',
  deep_model text NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  graph_memory boolean NOT NULL DEFAULT true,
  budget numeric NOT NULL DEFAULT 200,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_policies_select ON public.workspace_policies;
CREATE POLICY workspace_policies_select ON public.workspace_policies
  FOR SELECT USING (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS workspace_policies_update ON public.workspace_policies;
CREATE POLICY workspace_policies_update ON public.workspace_policies
  FOR ALL
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));

DROP TRIGGER IF EXISTS workspace_policies_touch_updated_at ON public.workspace_policies;
CREATE TRIGGER workspace_policies_touch_updated_at
  BEFORE UPDATE ON public.workspace_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
