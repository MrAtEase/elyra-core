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

