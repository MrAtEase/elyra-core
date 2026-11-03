-- Workspace kind normalization v2: individual | organization | platform

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_kind_check;

UPDATE public.workspaces
SET kind = CASE
  WHEN lower(COALESCE(kind, '')) IN ('individual', 'personal', 'private', 'privat') THEN 'individual'
  WHEN lower(COALESCE(kind, '')) IN ('organization', 'organisation', 'org', 'team', 'company', 'business') THEN 'organization'
  WHEN lower(COALESCE(kind, '')) IN ('platform', 'system', 'system_platform') THEN 'platform'
  ELSE 'organization'
END;

ALTER TABLE public.workspaces
  ALTER COLUMN kind SET DEFAULT 'organization',
  ALTER COLUMN kind SET NOT NULL;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_kind_check
  CHECK (kind IN ('individual', 'organization', 'platform'));
