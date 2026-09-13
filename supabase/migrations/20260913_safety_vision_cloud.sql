-- Multi-tenant Safety Vision Cloud: one Telegram bot, per-company recipients and edge agents.
create table if not exists public.vision_notification_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.vision_notification_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  chat_id text not null,
  enabled boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,chat_id)
);

create table if not exists public.vision_edge_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  site_name text not null,
  token_hash text not null unique,
  status text not null default 'offline' check(status in ('online','offline','maintenance')),
  version text,
  last_seen_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vision_notification_targets_org_idx on public.vision_notification_targets(organization_id,enabled);
create index if not exists vision_edge_agents_org_idx on public.vision_edge_agents(organization_id,status);

alter table public.vision_notification_settings enable row level security;
alter table public.vision_notification_targets enable row level security;
alter table public.vision_edge_agents enable row level security;

do $$ declare t text; begin
  foreach t in array array['vision_notification_settings','vision_notification_targets','vision_edge_agents'] loop
    execute format('drop policy if exists "section read" on public.%I',t);
    execute format('create policy "section read" on public.%I for select using (public.has_section_access(organization_id,''vision''))',t);
    execute format('drop policy if exists "section insert" on public.%I',t);
    execute format('create policy "section insert" on public.%I for insert with check (public.can_manage_section(organization_id,''vision''))',t);
    execute format('drop policy if exists "section update" on public.%I',t);
    execute format('create policy "section update" on public.%I for update using (public.can_manage_section(organization_id,''vision'')) with check (public.can_manage_section(organization_id,''vision''))',t);
    execute format('drop policy if exists "section delete" on public.%I',t);
    execute format('create policy "section delete" on public.%I for delete using (public.can_manage_section(organization_id,''vision''))',t);
  end loop;
end $$;

drop trigger if exists vision_edge_agents_updated_at on public.vision_edge_agents;
create trigger vision_edge_agents_updated_at before update on public.vision_edge_agents for each row execute function public.set_updated_at();
