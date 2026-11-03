BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_capabilities (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
