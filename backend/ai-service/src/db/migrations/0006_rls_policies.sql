-- RLS Policies for Elyra Core (intents, runs, artifacts, brain foundation, etc.)
-- HOW TO APPLY:
--   1. In Supabase Dashboard go to SQL Editor → New Query.
--   2. Paste this migration (or run `select * from run_sql(...)` with the file contents).
--   3. Execute; Supabase will report the statements and register the policies.
--   4. Ensure there are no remaining RLS warning flags for the listed tables.

BEGIN;

-- Ensure helper functions have deterministic search_path (Supabase linter: function_search_path_mutable)
ALTER FUNCTION public.has_workspace_access(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_workspace_manager(uuid)
  SET search_path = public, pg_catalog;

-- Enable RLS on the tables that require workspace scoping
ALTER TABLE public.intents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intent_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_steps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_calls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavior_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_identity   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_policies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persona_snapshots    ENABLE ROW LEVEL SECURITY;

-- General workspace access policies (SELECT/INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS intents_workspace_members ON public.intents;
CREATE POLICY intents_workspace_members ON public.intents
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS intent_messages_workspace_members ON public.intent_messages;
CREATE POLICY intent_messages_workspace_members ON public.intent_messages
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS runs_workspace_members ON public.runs;
CREATE POLICY runs_workspace_members ON public.runs
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS run_steps_workspace_members ON public.run_steps;
CREATE POLICY run_steps_workspace_members ON public.run_steps
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS tool_calls_workspace_members ON public.tool_calls;
CREATE POLICY tool_calls_workspace_members ON public.tool_calls
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS artifacts_workspace_members ON public.artifacts;
CREATE POLICY artifacts_workspace_members ON public.artifacts
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS artifact_versions_workspace_members ON public.artifact_versions;
CREATE POLICY artifact_versions_workspace_members ON public.artifact_versions
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS behavior_events_workspace_members ON public.behavior_events;
CREATE POLICY behavior_events_workspace_members ON public.behavior_events
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

-- Brain foundation tables (workspace identity/policies/persona snapshots) expose sensitive data;
-- allow any workspace member to read, but guard INSERT/UPDATE/DELETE for workspace managers
DROP POLICY IF EXISTS workspace_identity_select ON public.workspace_identity;
CREATE POLICY workspace_identity_select ON public.workspace_identity
  FOR SELECT
  USING (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS workspace_identity_manager_write ON public.workspace_identity;
CREATE POLICY workspace_identity_manager_write ON public.workspace_identity
  FOR INSERT
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY workspace_identity_manager_update ON public.workspace_identity
  FOR UPDATE
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY workspace_identity_manager_delete ON public.workspace_identity
  FOR DELETE
  USING (public.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS workspace_policies_select ON public.workspace_policies;
CREATE POLICY workspace_policies_select ON public.workspace_policies
  FOR SELECT
  USING (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS workspace_policies_manager_write ON public.workspace_policies;
CREATE POLICY workspace_policies_manager_write ON public.workspace_policies
  FOR INSERT
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY workspace_policies_manager_update ON public.workspace_policies
  FOR UPDATE
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY workspace_policies_manager_delete ON public.workspace_policies
  FOR DELETE
  USING (public.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS persona_snapshots_select ON public.persona_snapshots;
CREATE POLICY persona_snapshots_select ON public.persona_snapshots
  FOR SELECT
  USING (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS persona_snapshots_manager_write ON public.persona_snapshots;
CREATE POLICY persona_snapshots_manager_write ON public.persona_snapshots
  FOR INSERT
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY persona_snapshots_manager_update ON public.persona_snapshots
  FOR UPDATE
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));
CREATE POLICY persona_snapshots_manager_delete ON public.persona_snapshots
  FOR DELETE
  USING (public.is_workspace_manager(workspace_id));

COMMIT;
