BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_identity (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_identity_select ON public.workspace_identity;
CREATE POLICY workspace_identity_select ON public.workspace_identity
  FOR SELECT USING (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS workspace_identity_update ON public.workspace_identity;
CREATE POLICY workspace_identity_update ON public.workspace_identity
  FOR ALL
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));

DROP TRIGGER IF EXISTS workspace_identity_touch_updated_at ON public.workspace_identity;
CREATE TRIGGER workspace_identity_touch_updated_at
  BEFORE UPDATE ON public.workspace_identity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
