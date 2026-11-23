-- Elyra: Einstellungen aus Workspace Admin (AI-Modell, Kreativität, Web-Recherche, Budget)
-- Ergänzt die bestehende Tabelle workspace_policies um eine flexible JSON-Spalte.
BEGIN;

ALTER TABLE public.workspace_policies
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
