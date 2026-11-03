BEGIN;

CREATE TABLE IF NOT EXISTS public.os_tool_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  tool_call_id text NOT NULL,
  artifact_type text NOT NULL CHECK (
    artifact_type IN (
      'research_report',
      'weather_forecast',
      'translation_result',
      'slides_deck_link',
      'drive_file'
    )
  ),
  title text NOT NULL,
  ui_card_hint text NOT NULL CHECK (
    ui_card_hint IN (
      'card.research_report',
      'card.weather_forecast',
      'card.translation_result',
      'card.slides_deck_link',
      'card.drive_file',
      'card.generic'
    )
  ),
  link_url text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_tool_artifacts_workspace_created_idx
  ON public.os_tool_artifacts (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS os_tool_artifacts_run_idx
  ON public.os_tool_artifacts (workspace_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS os_tool_artifacts_tool_call_idx
  ON public.os_tool_artifacts (workspace_id, tool_call_id, created_at DESC);

ALTER TABLE public.os_tool_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_tool_artifacts_workspace_members ON public.os_tool_artifacts;
CREATE POLICY os_tool_artifacts_workspace_members ON public.os_tool_artifacts
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP TRIGGER IF EXISTS os_tool_artifacts_touch_updated_at ON public.os_tool_artifacts;
CREATE TRIGGER os_tool_artifacts_touch_updated_at
  BEFORE UPDATE ON public.os_tool_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;

