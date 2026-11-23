-- Vereinheitlicht public.tasks auf das Schema, das Frontend und Elly-Tool nutzen.
-- Idempotent: kann mehrfach ausgeführt werden. Im Supabase SQL-Editor ausführen.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Alte Spalte due_date übernehmen, falls vorhanden
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'due_date') THEN
    EXECUTE 'UPDATE public.tasks SET due_at = due_date WHERE due_at IS NULL AND due_date IS NOT NULL';
  END IF;
END $$;

-- created_by darf leer sein (Aufgaben aus Elly-Chat haben keinen Browser-Nutzer)
ALTER TABLE public.tasks ALTER COLUMN created_by DROP NOT NULL;

-- Status: alte Werte übersetzen und beide Schreibweisen erlauben
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
UPDATE public.tasks SET status = 'open' WHERE status = 'todo';
UPDATE public.tasks SET status = 'canceled' WHERE status = 'cancelled';
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('open', 'in_progress', 'done', 'canceled'));
ALTER TABLE public.tasks ALTER COLUMN status SET DEFAULT 'open';
