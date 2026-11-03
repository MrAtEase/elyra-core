BEGIN;

CREATE TABLE IF NOT EXISTS public.os_metric_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
