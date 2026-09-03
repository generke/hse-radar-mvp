-- HSE Radar multi-tenant schema. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free','pro','enterprise')),
  subscription_status text not null default 'free',
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','hse','manager','hr','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null, department text not null, position text not null, hire_date date not null,
  medical_exam_expiry date not null, briefing_expiry date not null, training_expiry date not null,
  photo_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, category text not null, building text not null, location text not null,
  next_service_date date not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.ppe_issues (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_name text not null, item_name text not null, quantity integer not null default 1 check(quantity > 0),
  issued_at date not null, replacement_date date not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, category text not null, storage_path text not null, created_at timestamptz not null default now()
);

create index if not exists employees_org_idx on public.employees(organization_id);
create index if not exists inventory_org_idx on public.inventory(organization_id);
create index if not exists ppe_org_idx on public.ppe_issues(organization_id);
create index if not exists documents_org_idx on public.documents(organization_id);

create or replace function public.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid());
$$;
create or replace function public.can_manage_org(org_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and role in ('owner','hse','hr'));
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.employees enable row level security;
alter table public.inventory enable row level security;
alter table public.ppe_issues enable row level security;
alter table public.documents enable row level security;

drop policy if exists "org read" on public.organizations;
create policy "org read" on public.organizations for select using (public.is_org_member(id));
drop policy if exists "profile self" on public.profiles;
create policy "profile self" on public.profiles for all using (id=auth.uid()) with check (id=auth.uid());
drop policy if exists "membership read" on public.memberships;
create policy "membership read" on public.memberships for select using (user_id=auth.uid() or public.is_org_member(organization_id));

do $$ declare t text; begin
  foreach t in array array['employees','inventory','ppe_issues','documents'] loop
    execute format('drop policy if exists "tenant read" on public.%I',t);
    execute format('create policy "tenant read" on public.%I for select using (public.is_org_member(organization_id))',t);
    execute format('drop policy if exists "tenant insert" on public.%I',t);
    execute format('create policy "tenant insert" on public.%I for insert with check (public.can_manage_org(organization_id))',t);
    execute format('drop policy if exists "tenant update" on public.%I',t);
    execute format('create policy "tenant update" on public.%I for update using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id))',t);
    execute format('drop policy if exists "tenant delete" on public.%I',t);
    execute format('create policy "tenant delete" on public.%I for delete using (public.can_manage_org(organization_id))',t);
  end loop;
end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare org_id uuid; display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1));
  insert into public.profiles(id,full_name) values(new.id,display_name);
  insert into public.organizations(name) values(display_name || ' · HSE') returning id into org_id;
  insert into public.memberships(organization_id,user_id,role) values(org_id,new.id,'owner');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hse-documents','hse-documents',false,10485760,array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "org files read" on storage.objects;
create policy "org files read" on storage.objects for select using (bucket_id='hse-documents' and public.is_org_member((storage.foldername(name))[1]::uuid));
drop policy if exists "org files insert" on storage.objects;
create policy "org files insert" on storage.objects for insert with check (bucket_id='hse-documents' and public.can_manage_org((storage.foldername(name))[1]::uuid));
drop policy if exists "org files delete" on storage.objects;
create policy "org files delete" on storage.objects for delete using (bucket_id='hse-documents' and public.can_manage_org((storage.foldername(name))[1]::uuid));

-- Apply the billing, trial-limit and platform-admin extension after this base schema.
-- Source: supabase/migrations/20260901_kaspi_trial_admin.sql
