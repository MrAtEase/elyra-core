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

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('google', 'icloud_imap', 'icloud_caldav'));
