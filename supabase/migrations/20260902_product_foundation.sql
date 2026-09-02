-- HSE Radar production foundation: traceability, teamwork, tasks and billing integrity.

alter table public.organizations
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.employees add column if not exists archived_at timestamptz;
alter table public.employees add column if not exists archived_by uuid references auth.users(id);
alter table public.inventory add column if not exists archived_at timestamptz;
alter table public.inventory add column if not exists archived_by uuid references auth.users(id);
alter table public.ppe_issues add column if not exists archived_at timestamptz;
alter table public.ppe_issues add column if not exists archived_by uuid references auth.users(id);
alter table public.documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists expires_at date,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','updated','archived','restored','deleted','approved','rejected')),
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_org_created_idx on public.audit_events(organization_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','done','verified')),
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date not null,
  source_type text,
  source_id uuid,
  evidence_path text,
  created_by uuid not null default auth.uid() references auth.users(id),
  completed_at timestamptz,
  verified_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_org_status_due_idx on public.tasks(organization_id, status, due_date);
create index if not exists tasks_assignee_idx on public.tasks(assignee_id, status);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('kaspi_pay','stripe','manual')),
  external_id text,
  event_type text not null,
  amount numeric(14,2),
  currency text not null default 'KZT',
  payload jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(provider, external_id, event_type)
);
create index if not exists billing_events_org_idx on public.billing_events(organization_id, created_at desc);

alter table public.payment_requests
  add column if not exists invoice_number text,
  add column if not exists amount numeric(14,2),
  add column if not exists billing_months integer not null default 1 check (billing_months between 1 and 36),
  add column if not exists review_note text;
create unique index if not exists payment_requests_invoice_idx on public.payment_requests(invoice_number) where invoice_number is not null;

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table public.stripe_events add column if not exists received_at timestamptz not null default now();
alter table public.stripe_events add column if not exists last_error text;
alter table public.stripe_events alter column processed_at drop not null;
alter table public.stripe_events alter column processed_at drop default;

create or replace function public.can_admin_org(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.memberships
    where organization_id=org_id and user_id=auth.uid() and role='owner'
  );
$$;

create or replace function public.can_manage_org(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.memberships
    where organization_id=org_id and user_id=auth.uid() and role in ('owner','hse','manager','hr')
  );
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();

create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_row jsonb;
  new_row jsonb;
  org_id uuid;
  row_id uuid;
  event_action text;
begin
  old_row := case when tg_op='INSERT' then null else to_jsonb(old) end;
  new_row := case when tg_op='DELETE' then null else to_jsonb(new) end;
  org_id := coalesce((new_row->>'organization_id')::uuid, (old_row->>'organization_id')::uuid);
  if tg_table_name='organizations' then org_id := coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid); end if;
  row_id := coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
  event_action := case
    when tg_op='INSERT' then 'created'
    when tg_op='DELETE' then 'deleted'
    when old_row->>'archived_at' is null and new_row->>'archived_at' is not null then 'archived'
    when old_row->>'archived_at' is not null and new_row->>'archived_at' is null then 'restored'
    else 'updated'
  end;
  if org_id is not null then
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(org_id,auth.uid(),event_action,tg_table_name,row_id,old_row,new_row);
  end if;
  return coalesce(new,old);
end;
$$;

do $$ declare t text; begin
  foreach t in array array['employees','inventory','ppe_issues','documents','tasks','memberships','payment_requests'] loop
    execute format('drop trigger if exists audit_row_change on public.%I',t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.record_audit_event()',t);
  end loop;
end $$;

alter table public.audit_events enable row level security;
alter table public.tasks enable row level security;
alter table public.billing_events enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "audit org read" on public.audit_events;
create policy "audit org read" on public.audit_events for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists "tasks org read" on public.tasks;
create policy "tasks org read" on public.tasks for select using (public.is_org_member(organization_id) or public.is_platform_admin());
drop policy if exists "tasks org insert" on public.tasks;
create policy "tasks org insert" on public.tasks for insert with check (public.can_manage_org(organization_id));
drop policy if exists "tasks org update" on public.tasks;
create policy "tasks org update" on public.tasks for update
using (public.can_manage_org(organization_id) or assignee_id=auth.uid())
with check (public.can_manage_org(organization_id) or assignee_id=auth.uid());

drop policy if exists "billing admin read" on public.billing_events;
create policy "billing admin read" on public.billing_events for select using (public.can_admin_org(organization_id));

drop policy if exists "membership admin insert" on public.memberships;
create policy "membership admin insert" on public.memberships for insert with check (public.can_admin_org(organization_id));
drop policy if exists "membership admin update" on public.memberships;
create policy "membership admin update" on public.memberships for update using (public.can_admin_org(organization_id)) with check (public.can_admin_org(organization_id));
drop policy if exists "membership admin delete" on public.memberships;
create policy "membership admin delete" on public.memberships for delete using (public.can_admin_org(organization_id) and user_id<>auth.uid());

drop policy if exists "profile org read" on public.profiles;
create policy "profile org read" on public.profiles for select using (
  id=auth.uid() or public.is_platform_admin() or exists(
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.organization_id=mine.organization_id
    where mine.user_id=auth.uid() and theirs.user_id=profiles.id
  )
);

create or replace function public.archive_record(target_table text, target_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare org_id uuid;
begin
  if target_table not in ('employees','inventory','ppe_issues','documents','tasks') then raise exception 'INVALID_TABLE'; end if;
  execute format('select organization_id from public.%I where id=$1',target_table) into org_id using target_id;
  if org_id is null or not public.can_manage_org(org_id) then raise exception 'FORBIDDEN'; end if;
  execute format('update public.%I set archived_at=now(), archived_by=$1 where id=$2 and archived_at is null',target_table)
    using auth.uid(),target_id;
end;
$$;
revoke all on function public.archive_record(text,uuid) from public;
grant execute on function public.archive_record(text,uuid) to authenticated;

-- Archived records no longer consume the trial allowance.
create or replace function public.enforce_trial_limit()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare current_plan text; current_count integer;
begin
  select plan into current_plan from public.organizations where id=new.organization_id;
  if current_plan='trial' and not public.is_platform_admin() then
    execute format('select count(*) from public.%I where organization_id=$1 and archived_at is null',tg_table_name)
      into current_count using new.organization_id;
    if current_count>=5 then raise exception 'TRIAL_LIMIT_REACHED: максимум 5 активных записей в пробном режиме'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.approve_payment_request(request_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare target_org uuid; months integer; ref text; paid_amount numeric;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select organization_id,billing_months,payment_reference,amount into target_org,months,ref,paid_amount
  from public.payment_requests where id=request_id and status='pending' for update;
  if target_org is null then raise exception 'PAYMENT_REQUEST_NOT_PENDING'; end if;
  update public.organizations set
    plan='pro', subscription_status='active',
    subscription_expires_at=greatest(coalesce(subscription_expires_at,now()),now()) + make_interval(months=>months)
  where id=target_org;
  update public.payment_requests set status='approved',reviewed_at=now(),reviewed_by=auth.uid() where id=request_id;
  insert into public.billing_events(organization_id,provider,external_id,event_type,amount,created_by,payload)
  values(target_org,'kaspi_pay',request_id::text,'payment_approved',paid_amount,auth.uid(),jsonb_build_object('reference',ref,'months',months))
  on conflict(provider,external_id,event_type) do nothing;
end;
$$;

-- Invited Supabase users should not receive a redundant personal organization.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare org_id uuid; display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1));
  insert into public.profiles(id,full_name) values(new.id,display_name) on conflict(id) do nothing;
  if new.invited_at is not null then return new; end if;
  insert into public.organizations(name) values(display_name || ' · HSE') returning id into org_id;
  insert into public.memberships(organization_id,user_id,role) values(org_id,new.id,'owner');
  return new;
end; $$;
