-- 0016: KI-Newsletter-Digest + Automationen (n8n/Make/Zapier)
-- workspaces.id ist TEXT → workspace_id ebenfalls text.

create table if not exists public.insights_digests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  query text not null default '',
  focus text not null default '',
  days int not null default 7,
  message_count int not null default 0,
  content text not null default '',
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists insights_digests_ws_idx on public.insights_digests (workspace_id, created_at desc);

create table if not exists public.automation_hooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null default 'n8n Webhook',
  url text not null,
  secret_enc text,
  events text[] not null default '{}',
  active boolean not null default true,
  last_status int,
  last_error text,
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_hooks_ws_idx on public.automation_hooks (workspace_id);

create table if not exists public.automation_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null default 'n8n',
  prefix text not null,
  token_hash text not null unique,
  created_by text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists automation_tokens_ws_idx on public.automation_tokens (workspace_id);

alter table public.insights_digests enable row level security;
alter table public.automation_hooks enable row level security;
alter table public.automation_tokens enable row level security;
-- Zugriff nur über den Server (Service Role); keine Policies für anon/authenticated.
