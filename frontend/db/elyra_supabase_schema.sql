-- Elyra Core – Supabase-Schema für ein LEERES Projekt
-- Basis: frontend/db/migrations 0001–0011, angepasst:
--   * Workspace-IDs als TEXT (App nutzt "ws-personal", "ws-elyra-core" …)
--   * workspaces.kind ergänzt (wird von tokenStore.ts geschrieben)
--   * doppelte integrations_provider_check-Constraints idempotent
-- Einmal komplett im Supabase SQL Editor ausführen.

-- ===== 0000 Aufräumen: entfernt halb angelegte Elyra-Tabellen (nur wenn sie LEER sind)
-- auth.users / Logins werden NICHT angefasst.
DO $$
DECLARE t text; n bigint; filled text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_run_steps','ai_runs','ai_tool_calls','ai_usage_daily','app_manifests','artifact_versions','artifacts','behavior_events','calendar_events','chat_messages','entity_links','graph_edges','graph_nodes','installed_apps','integration_tokens','integrations','intent_messages','intents','mail_threads','orchestration_runs','os_admin_audit_log','os_incidents','os_metric_aggregates','os_metric_samples','os_tool_artifacts','persona_snapshots','plugin_audit_log','plugin_manifests','run_events','run_steps','runs','sync_runs','tasks','tool_calls','tool_registry_entries','workspace_capabilities','workspace_google_tokens','workspace_identity','workspace_mail_accounts','workspace_members','workspace_plugins','workspace_policies','workspace_projects','workspaces'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN filled := filled || t || '(' || n || ') '; END IF;
    END IF;
  END LOOP;
  IF filled <> '' THEN
    RAISE EXCEPTION 'Abbruch – diese Tabellen enthalten Daten: %', filled;
  END IF;
  FOREACH t IN ARRAY ARRAY['ai_run_steps','ai_runs','ai_tool_calls','ai_usage_daily','app_manifests','artifact_versions','artifacts','behavior_events','calendar_events','chat_messages','entity_links','graph_edges','graph_nodes','installed_apps','integration_tokens','integrations','intent_messages','intents','mail_threads','orchestration_runs','os_admin_audit_log','os_incidents','os_metric_aggregates','os_metric_samples','os_tool_artifacts','persona_snapshots','plugin_audit_log','plugin_manifests','run_events','run_steps','runs','sync_runs','tasks','tool_calls','tool_registry_entries','workspace_capabilities','workspace_google_tokens','workspace_identity','workspace_mail_accounts','workspace_members','workspace_plugins','workspace_policies','workspace_projects','workspaces'] LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
  FOR t IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = 'public' AND p.proname IN ('has_workspace_access','is_workspace_manager','touch_updated_at','touch_workspace_projects_updated_at') LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || t || ' CASCADE';
  END LOOP;
  DROP TYPE IF EXISTS public.orchestration_run_status CASCADE;
END $$;

-- ===== 0001_elyra_core_init.sql
-- Supabase migration for the Fish-Delish MVP schema (workspaces, tasks, realtime, and related caches).
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL DEFAULT 'organization',
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE OR REPLACE FUNCTION public.has_workspace_access(p_workspace_id text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_workspace_manager(p_workspace_id text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin')
  );
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','canceled')),
  priority int NOT NULL DEFAULT 0,
  due_at timestamptz,
  assigned_to uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gmail','calendar')),
  external_ref text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google')),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error')),
  connected_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS public.integration_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  calendar_id text,
  title text,
  description text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  organizer_email text,
  attendees jsonb,
  raw jsonb,
  updated_at_remote timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.mail_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  subject text,
  snippet text,
  from_email text,
  to_emails jsonb,
  last_message_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('gmail','calendar')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('task_to_mail_thread','task_to_calendar_event')),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  mail_thread_id uuid REFERENCES public.mail_threads(id) ON DELETE CASCADE,
  calendar_event_id uuid REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, task_id, mail_thread_id, calendar_event_id),
  CHECK (
    ((mail_thread_id IS NOT NULL)::int + (calendar_event_id IS NOT NULL)::int) = 1
  )
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON public.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx ON public.tasks (workspace_id, status);
CREATE INDEX IF NOT EXISTS tasks_workspace_due_idx ON public.tasks (workspace_id, due_at);
CREATE INDEX IF NOT EXISTS tasks_workspace_updated_idx ON public.tasks (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS calendar_events_workspace_start_idx ON public.calendar_events (workspace_id, start_at);
CREATE INDEX IF NOT EXISTS calendar_events_workspace_updated_idx ON public.calendar_events (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS mail_threads_workspace_last_message_idx ON public.mail_threads (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS mail_threads_workspace_updated_idx ON public.mail_threads (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_workspace_kind_started_idx ON public.sync_runs (workspace_id, kind, started_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_workspace_status_idx ON public.sync_runs (workspace_id, status);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_member_only ON public.workspaces;
CREATE POLICY workspaces_member_only ON public.workspaces
  FOR SELECT USING (public.has_workspace_access(id));

DROP POLICY IF EXISTS workspace_members_self ON public.workspace_members;
CREATE POLICY workspace_members_self ON public.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_workspace_manager(workspace_id)
  );
DROP POLICY IF EXISTS workspace_members_manage ON public.workspace_members;
CREATE POLICY workspace_members_manage ON public.workspace_members
  FOR ALL
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS tasks_workspace_members ON public.tasks;
CREATE POLICY tasks_workspace_members ON public.tasks
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS integrations_workspace_members ON public.integrations;
CREATE POLICY integrations_workspace_members ON public.integrations
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS calendar_events_workspace_members ON public.calendar_events;
CREATE POLICY calendar_events_workspace_members ON public.calendar_events
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS mail_threads_workspace_members ON public.mail_threads;
CREATE POLICY mail_threads_workspace_members ON public.mail_threads
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS sync_runs_workspace_members ON public.sync_runs;
CREATE POLICY sync_runs_workspace_members ON public.sync_runs
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS entity_links_workspace_members ON public.entity_links;
CREATE POLICY entity_links_workspace_members ON public.entity_links
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS integration_tokens_deny_all ON public.integration_tokens;
CREATE POLICY integration_tokens_deny_all ON public.integration_tokens
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP TRIGGER IF EXISTS workspaces_touch_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_touch_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tasks_touch_updated_at ON public.tasks;
CREATE TRIGGER tasks_touch_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS integrations_touch_updated_at ON public.integrations;
CREATE TRIGGER integrations_touch_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS integration_tokens_touch_updated_at ON public.integration_tokens;
CREATE TRIGGER integration_tokens_touch_updated_at
  BEFORE UPDATE ON public.integration_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS calendar_events_touch_updated_at ON public.calendar_events;
CREATE TRIGGER calendar_events_touch_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS mail_threads_touch_updated_at ON public.mail_threads;
CREATE TRIGGER mail_threads_touch_updated_at
  BEFORE UPDATE ON public.mail_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS sync_runs_touch_updated_at ON public.sync_runs;
CREATE TRIGGER sync_runs_touch_updated_at
  BEFORE UPDATE ON public.sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sync_runs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_runs;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'calendar_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mail_threads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.mail_threads;
    END IF;
  END IF;
END;
$$;

-- Sanity Check: confirm tables exist, RLS is active, and realtime publication is aware of the tables.
SELECT 'workspaces' AS table_name, to_regclass('public.workspaces') IS NOT NULL AS exists;
SELECT 'workspace_members' AS table_name, to_regclass('public.workspace_members') IS NOT NULL AS exists;
SELECT 'tasks' AS table_name, to_regclass('public.tasks') IS NOT NULL AS exists;
SELECT 'integrations' AS table_name, to_regclass('public.integrations') IS NOT NULL AS exists;
SELECT 'integration_tokens' AS table_name, to_regclass('public.integration_tokens') IS NOT NULL AS exists;
SELECT 'calendar_events' AS table_name, to_regclass('public.calendar_events') IS NOT NULL AS exists;
SELECT 'mail_threads' AS table_name, to_regclass('public.mail_threads') IS NOT NULL AS exists;
SELECT 'sync_runs' AS table_name, to_regclass('public.sync_runs') IS NOT NULL AS exists;
SELECT 'entity_links' AS table_name, to_regclass('public.entity_links') IS NOT NULL AS exists;
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('workspaces','workspace_members','tasks','integrations','integration_tokens','calendar_events','mail_threads','sync_runs','entity_links');
SELECT tbl.table_name,
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = tbl.table_name
  ) AS in_realtime
FROM (VALUES ('tasks'), ('sync_runs'), ('calendar_events'), ('mail_threads')) AS tbl(table_name);

SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
ORDER BY tablename;

-- Manual seed template for the primary workspace (run via Supabase SQL editor; do not execute automatically).
-- INSERT INTO public.workspaces (id, slug, name)
-- VALUES ('11111111-1111-1111-1111-111111111111', 'prod', 'Fish Delish Prod');
-- INSERT INTO public.workspace_members (workspace_id, user_id, role)
-- VALUES (
--   '11111111-1111-1111-1111-111111111111',
--   '<REPLACE_WITH_USER_ID_FROM_MF-S_WHOAMI>',
--   'owner'
-- );
-- Replace `<REPLACE_WITH_USER_ID_FROM_MF-S_WHOAMI>` with the `id` (or `user_id`) returned by your `whoami` call while authenticated via the mf-s session.
-- This seed ensures at least one workspace + membership exist so RLS does not reject authenticated reads.

COMMIT;

-- ===== 0002_add_orchestration_runs.sql
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
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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

-- ===== 0003_os_tool_artifacts.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.os_tool_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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


-- ===== 0004_orb_os_contracts_events.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_capabilities (
  workspace_id text PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contract_version text NOT NULL DEFAULT 'v1.0',
  policy_version integer NOT NULL DEFAULT 1,
  surfaces jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL,
  manifest_version text NOT NULL,
  schema_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deprecated')),
  is_latest boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, manifest_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_manifests_latest_per_app_idx
  ON public.app_manifests (app_id)
  WHERE is_latest = true;

CREATE TABLE IF NOT EXISTS public.installed_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  installed boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manifest_pack',
  installed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, app_id)
);

CREATE TABLE IF NOT EXISTS public.tool_registry_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  app_id text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('read_only', 'writes', 'destructive')),
  requires_approval boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'policy_blocked')),
  version text NOT NULL DEFAULT '1.0.0',
  source_manifest_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tool_name)
);

CREATE TABLE IF NOT EXISTS public.workspace_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, policy_key)
);

CREATE TABLE IF NOT EXISTS public.run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  tool_call_id text,
  event_type text NOT NULL CHECK (
    event_type IN (
      'RUN_CREATED',
      'PLAN_WRITTEN',
      'TOOL_REQUESTED',
      'APPROVAL_REQUIRED',
      'APPROVAL_GRANTED',
      'AUTH_REQUIRED',
      'TOOL_STARTED',
      'TOOL_COMPLETED',
      'ARTIFACT_CREATED',
      'RUN_SUCCEEDED',
      'RUN_FAILED',
      'RUN_CANCELLED'
    )
  ),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_events_workspace_run_created_idx
  ON public.run_events (workspace_id, run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.os_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_admin_audit_workspace_created_idx
  ON public.os_admin_audit_log (workspace_id, created_at DESC);

ALTER TABLE public.workspace_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_registry_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_capabilities_workspace_members ON public.workspace_capabilities;
CREATE POLICY workspace_capabilities_workspace_members ON public.workspace_capabilities
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS app_manifests_readable ON public.app_manifests;
CREATE POLICY app_manifests_readable ON public.app_manifests
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS app_manifests_admin_write ON public.app_manifests;
CREATE POLICY app_manifests_admin_write ON public.app_manifests
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS installed_apps_workspace_members ON public.installed_apps;
CREATE POLICY installed_apps_workspace_members ON public.installed_apps
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS tool_registry_entries_workspace_members ON public.tool_registry_entries;
CREATE POLICY tool_registry_entries_workspace_members ON public.tool_registry_entries
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS workspace_policies_workspace_members ON public.workspace_policies;
CREATE POLICY workspace_policies_workspace_members ON public.workspace_policies
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS run_events_workspace_members ON public.run_events;
CREATE POLICY run_events_workspace_members ON public.run_events
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS os_admin_audit_log_workspace_members ON public.os_admin_audit_log;
CREATE POLICY os_admin_audit_log_workspace_members ON public.os_admin_audit_log
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP TRIGGER IF EXISTS workspace_capabilities_touch_updated_at ON public.workspace_capabilities;
CREATE TRIGGER workspace_capabilities_touch_updated_at
  BEFORE UPDATE ON public.workspace_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS app_manifests_touch_updated_at ON public.app_manifests;
CREATE TRIGGER app_manifests_touch_updated_at
  BEFORE UPDATE ON public.app_manifests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS installed_apps_touch_updated_at ON public.installed_apps;
CREATE TRIGGER installed_apps_touch_updated_at
  BEFORE UPDATE ON public.installed_apps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tool_registry_entries_touch_updated_at ON public.tool_registry_entries;
CREATE TRIGGER tool_registry_entries_touch_updated_at
  BEFORE UPDATE ON public.tool_registry_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_policies_touch_updated_at ON public.workspace_policies;
CREATE TRIGGER workspace_policies_touch_updated_at
  BEFORE UPDATE ON public.workspace_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;

-- ===== 0005_operability_plugins.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.os_metric_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric_name text NOT NULL,
  metric_value double precision NOT NULL,
  tags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_metric_samples_workspace_metric_time_idx
  ON public.os_metric_samples (workspace_id, metric_name, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.os_metric_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  bucket_granularity text NOT NULL DEFAULT 'hourly' CHECK (bucket_granularity IN ('hourly', 'daily')),
  run_success_rate double precision,
  queue_lag double precision,
  p95_tool_latency double precision,
  approval_time double precision,
  auth_failure_rate double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, bucket_start, bucket_granularity)
);

CREATE TABLE IF NOT EXISTS public.os_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  incident_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  summary text NOT NULL,
  trigger_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS os_incidents_workspace_status_idx
  ON public.os_incidents (workspace_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.plugin_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL,
  version text NOT NULL,
  manifest_json jsonb NOT NULL,
  signature text,
  immutable_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plugin_id, version)
);

CREATE TABLE IF NOT EXISTS public.workspace_plugins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  installed_by uuid,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS public.plugin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  action text NOT NULL,
  actor_user_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.os_metric_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_metric_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugin_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_metric_samples_workspace_members ON public.os_metric_samples;
CREATE POLICY os_metric_samples_workspace_members ON public.os_metric_samples
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS os_metric_aggregates_workspace_members ON public.os_metric_aggregates;
CREATE POLICY os_metric_aggregates_workspace_members ON public.os_metric_aggregates
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS os_incidents_workspace_members ON public.os_incidents;
CREATE POLICY os_incidents_workspace_members ON public.os_incidents
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS plugin_manifests_readable ON public.plugin_manifests;
CREATE POLICY plugin_manifests_readable ON public.plugin_manifests
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS plugin_manifests_admin_write ON public.plugin_manifests;
CREATE POLICY plugin_manifests_admin_write ON public.plugin_manifests
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS workspace_plugins_workspace_members ON public.workspace_plugins;
CREATE POLICY workspace_plugins_workspace_members ON public.workspace_plugins
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP POLICY IF EXISTS plugin_audit_log_workspace_members ON public.plugin_audit_log;
CREATE POLICY plugin_audit_log_workspace_members ON public.plugin_audit_log
  FOR ALL
  USING (public.has_workspace_access(workspace_id))
  WITH CHECK (public.has_workspace_access(workspace_id));

DROP TRIGGER IF EXISTS os_metric_aggregates_touch_updated_at ON public.os_metric_aggregates;
CREATE TRIGGER os_metric_aggregates_touch_updated_at
  BEFORE UPDATE ON public.os_metric_aggregates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS os_incidents_touch_updated_at ON public.os_incidents;
CREATE TRIGGER os_incidents_touch_updated_at
  BEFORE UPDATE ON public.os_incidents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS plugin_manifests_touch_updated_at ON public.plugin_manifests;
CREATE TRIGGER plugin_manifests_touch_updated_at
  BEFORE UPDATE ON public.plugin_manifests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_plugins_touch_updated_at ON public.workspace_plugins;
CREATE TRIGGER workspace_plugins_touch_updated_at
  BEFORE UPDATE ON public.workspace_plugins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;

-- ===== 0006_workspace_projects.sql
create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspace_projects_workspace_id
  on public.workspace_projects (workspace_id, archived, updated_at desc);

create or replace function public.touch_workspace_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workspace_projects_touch on public.workspace_projects;
create trigger trg_workspace_projects_touch
before update on public.workspace_projects
for each row execute function public.touch_workspace_projects_updated_at();

-- ===== 0007_workspace_integration_providers.sql
DO $$
DECLARE
  provider_constraint text;
BEGIN
  SELECT con.conname
  INTO provider_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'integrations'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider IN%';

  IF provider_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.integrations DROP CONSTRAINT %I', provider_constraint);
  END IF;
END $$;

ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('google', 'icloud_imap', 'icloud_caldav'));

-- ===== 0008_workspace_imap_integration_columns.sql
DO $$
DECLARE
  provider_constraint text;
BEGIN
  SELECT con.conname
  INTO provider_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'integrations'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider IN%';

  IF provider_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.integrations DROP CONSTRAINT %I', provider_constraint);
  END IF;
END $$;

ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('google', 'microsoft', 'imap', 'icloud_imap', 'icloud_caldav'));

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS imap_host text,
  ADD COLUMN IF NOT EXISTS imap_port integer,
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer,
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS encrypted_password text,
  ADD COLUMN IF NOT EXISTS ssl_tls_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text;

CREATE INDEX IF NOT EXISTS integrations_workspace_provider_idx
  ON public.integrations (workspace_id, provider);


-- ===== 0009_workspace_mail_accounts.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'imap')),
  label text,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error')),
  last_error text,
  imap_host text,
  imap_port integer,
  imap_secure boolean,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean,
  secrets_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_workspace
  ON public.workspace_mail_accounts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_user
  ON public.workspace_mail_accounts (user_id);

ALTER TABLE public.workspace_mail_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_mail_accounts_select_own ON public.workspace_mail_accounts;
CREATE POLICY workspace_mail_accounts_select_own
  ON public.workspace_mail_accounts
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS workspace_mail_accounts_insert_own ON public.workspace_mail_accounts;
CREATE POLICY workspace_mail_accounts_insert_own
  ON public.workspace_mail_accounts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS workspace_mail_accounts_update_own ON public.workspace_mail_accounts;
CREATE POLICY workspace_mail_accounts_update_own
  ON public.workspace_mail_accounts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS workspace_mail_accounts_touch_updated_at ON public.workspace_mail_accounts;
CREATE TRIGGER workspace_mail_accounts_touch_updated_at
  BEFORE UPDATE ON public.workspace_mail_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

COMMIT;


-- ===== 0010_workspace_policies.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_policies (
  workspace_id text PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
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

-- ===== 0011_workspace_identity.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_identity (
  workspace_id text PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
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

