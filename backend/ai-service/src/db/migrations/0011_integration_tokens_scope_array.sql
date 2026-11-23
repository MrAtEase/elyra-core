-- Convert integration_tokens.scope from TEXT to TEXT[] for existing deployments.
-- Existing string values are split on whitespace into scope entries.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integration_tokens'
      AND column_name = 'scope'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.integration_tokens
      ALTER COLUMN scope TYPE TEXT[]
      USING CASE
        WHEN scope IS NULL OR btrim(scope) = '' THEN NULL
        ELSE regexp_split_to_array(btrim(scope), E'\\s+')
      END;
  END IF;
END $$;
