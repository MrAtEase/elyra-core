-- 0017: Marktplatz (optionale Apps + Skills) und Mini-Apps, die Elly baut.
-- workspaces.id ist TEXT → workspace_id ebenfalls text.

create table if not exists public.marketplace_installs (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  item_id text not null,
  kind text not null default 'app' check (kind in ('app', 'skill')),
  installed boolean not null default true,
  installed_by text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_id)
);

create table if not exists public.mini_apps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default '✦',
  prompt text not null default '',
  html text not null,
  data jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mini_apps_ws_idx on public.mini_apps (workspace_id, created_at desc);

alter table public.marketplace_installs enable row level security;
alter table public.mini_apps enable row level security;
-- Zugriff nur über die Server-Routen (Service-Role); keine Policies für anon/authenticated.

-- Bestehende Workspaces behalten alle Apps, die sie bisher hatten.
-- Neue Workspaces starten schlank und wählen im Marktplatz.
insert into public.marketplace_installs (workspace_id, item_id, kind, installed)
select w.id, a.item_id, 'app', true
from public.workspaces w
cross join (values
  ('visibility'), ('synergy'), ('feed'), ('insights'), ('automations'), ('ads_audit'),
  ('reporting'), ('agent_team'), ('leads'), ('languages'), ('guitar'), ('magic')
) as a(item_id)
on conflict (workspace_id, item_id) do nothing;
