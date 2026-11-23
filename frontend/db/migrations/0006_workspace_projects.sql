create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspace_projects_workspace_id
  on public.workspace_projects (workspace_id, archived, updated_at desc);

create or replace function public.touch_workspace_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workspace_projects_touch on public.workspace_projects;
create trigger trg_workspace_projects_touch
before update on public.workspace_projects
for each row execute function public.touch_workspace_projects_updated_at();
