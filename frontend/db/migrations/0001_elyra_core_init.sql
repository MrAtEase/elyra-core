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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE OR REPLACE FUNCTION public.has_workspace_access(p_workspace_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_workspace_manager(p_workspace_id uuid)
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
