-- Brain Foundation: identity + memory + artifacts + tracking

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Workspace core (compat with existing installs)
CREATE TABLE IF NOT EXISTS public.workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'organisation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.workspaces
SET kind = CASE
  WHEN lower(COALESCE(kind, '')) IN ('personal', 'private', 'privat') THEN 'privat'
  WHEN lower(COALESCE(kind, '')) IN ('team', 'company', 'business', 'organization', 'organisation', 'org') THEN 'organisation'
  WHEN lower(COALESCE(kind, '')) IN ('system', 'platform', 'system_platform') THEN 'platform'
  ELSE 'organisation'
END;

ALTER TABLE public.workspaces
  ALTER COLUMN kind SET DEFAULT 'organisation',
  ALTER COLUMN kind SET NOT NULL;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_kind_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_kind_check
  CHECK (kind IN ('privat', 'organisation', 'platform'));

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.workspace_identity (
  workspace_id TEXT PRIMARY KEY,
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_policies (
  workspace_id TEXT PRIMARY KEY,
  policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'running', 'completed', 'failed', 'cancelled')),
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intent_messages (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES public.intents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.runs (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT,
  intent_id TEXT NOT NULL REFERENCES public.intents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'approval_required', 'skipped')),
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  output_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (run_id, step_key)
);

CREATE TABLE IF NOT EXISTS public.tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  run_step_id TEXT REFERENCES public.run_steps(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_json JSONB,
  response_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  intent_id TEXT REFERENCES public.intents(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES public.runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT,
  latest_version INTEGER NOT NULL DEFAULT 0,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, title)
);

CREATE TABLE IF NOT EXISTS public.artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

CREATE TABLE IF NOT EXISTS public.behavior_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  intent_id TEXT REFERENCES public.intents(id) ON DELETE SET NULL,
  run_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('approve_step', 'deny_step', 'edit_output', 'run_completed')),
  field_name TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.persona_snapshots (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  denials INTEGER NOT NULL DEFAULT 0,
  verbosity_preference TEXT NOT NULL DEFAULT 'normal' CHECK (verbosity_preference IN ('low', 'normal', 'high')),
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_intents_workspace_created ON public.intents (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_messages_intent_created ON public.intent_messages (intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_intent_messages_workspace_created ON public.intent_messages (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_created ON public.runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_intent_created ON public.runs (intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_ai_run_id ON public.runs (ai_run_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_created ON public.run_steps (run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_run_steps_workspace_status ON public.run_steps (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_created ON public.tool_calls (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_updated ON public.artifacts (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_version ON public.artifact_versions (artifact_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_events_workspace_created ON public.behavior_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_events_user_type_created ON public.behavior_events (user_id, event_type, created_at DESC);

DROP TRIGGER IF EXISTS workspaces_touch_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_touch_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_members_touch_updated_at ON public.workspace_members;
CREATE TRIGGER workspace_members_touch_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_identity_touch_updated_at ON public.workspace_identity;
CREATE TRIGGER workspace_identity_touch_updated_at
  BEFORE UPDATE ON public.workspace_identity
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_policies_touch_updated_at ON public.workspace_policies;
CREATE TRIGGER workspace_policies_touch_updated_at
  BEFORE UPDATE ON public.workspace_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS intents_touch_updated_at ON public.intents;
CREATE TRIGGER intents_touch_updated_at
  BEFORE UPDATE ON public.intents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS runs_touch_updated_at ON public.runs;
CREATE TRIGGER runs_touch_updated_at
  BEFORE UPDATE ON public.runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS run_steps_touch_updated_at ON public.run_steps;
CREATE TRIGGER run_steps_touch_updated_at
  BEFORE UPDATE ON public.run_steps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS artifacts_touch_updated_at ON public.artifacts;
CREATE TRIGGER artifacts_touch_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS persona_snapshots_touch_updated_at ON public.persona_snapshots;
CREATE TRIGGER persona_snapshots_touch_updated_at
  BEFORE UPDATE ON public.persona_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
