-- Align workspace_google_tokens with OAuth v2 storage model.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_google_tokens'
      AND column_name = 'token_expiry'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_google_tokens'
      AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE public.workspace_google_tokens
      RENAME COLUMN token_expiry TO expires_at;
  END IF;
END $$;

ALTER TABLE public.workspace_google_tokens
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_email TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_google_tokens'
      AND column_name = 'scopes'
      AND udt_name = '_text'
  ) THEN
    ALTER TABLE public.workspace_google_tokens
      ALTER COLUMN scopes TYPE TEXT
      USING array_to_string(scopes, ' ');
  END IF;
END $$;

ALTER TABLE public.workspace_google_tokens
  ALTER COLUMN scopes TYPE TEXT USING scopes::TEXT,
  ALTER COLUMN scopes SET DEFAULT '',
  ALTER COLUMN scopes SET NOT NULL;

UPDATE public.workspace_google_tokens
SET provider = 'google'
WHERE provider IS NULL OR provider = '';

ALTER TABLE public.workspace_google_tokens
  ALTER COLUMN expires_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_google_tokens_workspace_provider_idx
  ON public.workspace_google_tokens (workspace_id, provider);
