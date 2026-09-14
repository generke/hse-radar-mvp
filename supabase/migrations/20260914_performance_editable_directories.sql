-- Lazy-loaded sections and editable organization directories.

alter table public.job_profiles
  add column if not exists custom_training_names text[] not null default '{}';
update public.job_profiles
set custom_training_names=array[custom_training_name]
where custom_training_name is not null and custom_training_name<>'' and cardinality(custom_training_names)=0;

create table if not exists public.training_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  format text not null default 'training' check(format in ('briefing','training','exam')),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

create table if not exists public.document_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check(role in ('owner','hse','manager','hr','member')),
  section_permissions text[] not null default array['overview','tasks','learning'],
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid default auth.uid() references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default now()+interval '14 days',
  created_at timestamptz not null default now()
);
create unique index if not exists organization_invites_pending_idx
  on public.organization_invites(organization_id,lower(email)) where accepted_at is null;
create index if not exists training_types_org_idx on public.training_types(organization_id,is_active,name);
create index if not exists document_categories_org_idx on public.document_categories(organization_id,is_active,name);
create index if not exists employees_org_name_idx on public.employees(organization_id,full_name) where archived_at is null;
create index if not exists inventory_org_name_idx on public.inventory(organization_id,name) where archived_at is null;
create index if not exists documents_org_created_idx on public.documents(organization_id,created_at desc) where archived_at is null;
create index if not exists user_notifications_org_user_idx on public.user_notifications(organization_id,user_id,created_at desc);

alter table public.training_types enable row level security;
alter table public.document_categories enable row level security;
alter table public.organization_invites enable row level security;

create policy "training types read" on public.training_types for select using(public.has_section_access(organization_id,'learning'));
create policy "training types write" on public.training_types for all using(public.can_admin_org(organization_id)) with check(public.can_admin_org(organization_id));
create policy "document categories read" on public.document_categories for select using(public.has_section_access(organization_id,'documents'));
create policy "document categories write" on public.document_categories for all using(public.can_admin_org(organization_id)) with check(public.can_admin_org(organization_id));
create policy "organization invites read" on public.organization_invites for select using(public.can_admin_org(organization_id));
create policy "organization invites write" on public.organization_invites for all using(public.can_admin_org(organization_id)) with check(public.can_admin_org(organization_id));

drop trigger if exists training_types_updated_at on public.training_types;
create trigger training_types_updated_at before update on public.training_types for each row execute function public.set_updated_at();
drop trigger if exists document_categories_updated_at on public.document_categories;
create trigger document_categories_updated_at before update on public.document_categories for each row execute function public.set_updated_at();

create or replace function public.invite_member_by_email(org_id uuid, invite_email text, invite_role text, invite_permissions text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.profiles%rowtype; invite_token uuid; normalized text:=lower(trim(invite_email));
begin
  if not public.can_admin_org(org_id) then raise exception 'FORBIDDEN'; end if;
  if invite_role not in ('owner','hse','manager','hr','member') then raise exception 'INVALID_ROLE'; end if;
  select * into target from public.profiles where lower(email)=normalized limit 1;
  if target.id is not null then
    insert into public.memberships(organization_id,user_id,role,section_permissions,is_active)
    values(org_id,target.id,invite_role,invite_permissions,true)
    on conflict(organization_id,user_id) do update set role=excluded.role,section_permissions=excluded.section_permissions,is_active=true;
    return jsonb_build_object('existing',true,'user_id',target.id,'full_name',target.full_name,'email',target.email);
  end if;
  insert into public.organization_invites(organization_id,email,role,section_permissions,invited_by)
  values(org_id,normalized,invite_role,invite_permissions,auth.uid())
  on conflict(organization_id,lower(email)) where accepted_at is null
  do update set role=excluded.role,section_permissions=excluded.section_permissions,expires_at=now()+interval '14 days',invited_by=auth.uid()
  returning token into invite_token;
  return jsonb_build_object('existing',false,'token',invite_token,'email',normalized);
end;
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare org_id uuid; display_name text; matched integer;
begin
  display_name:=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1));
  insert into public.profiles(id,full_name,email) values(new.id,display_name,new.email)
  on conflict(id) do update set email=excluded.email,full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name);
  insert into public.memberships(organization_id,user_id,role,section_permissions,is_active)
  select organization_id,new.id,role,section_permissions,true from public.organization_invites
  where lower(email)=lower(new.email) and accepted_at is null and expires_at>now()
  on conflict(organization_id,user_id) do update set role=excluded.role,section_permissions=excluded.section_permissions,is_active=true;
  get diagnostics matched=row_count;
  update public.organization_invites set accepted_at=now()
  where lower(email)=lower(new.email) and accepted_at is null and expires_at>now();
  if matched>0 or new.invited_at is not null then return new; end if;
  insert into public.organizations(name) values(display_name||' · HSE') returning id into org_id;
  insert into public.memberships(organization_id,user_id,role,is_active) values(org_id,new.id,'owner',true);
  return new;
end;
$$;
