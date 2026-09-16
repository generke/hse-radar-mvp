-- Production security foundation: canonical obligations, tenant isolation, RBAC and immutable audit.
-- Apply after 20260914_performance_editable_directories.sql.
-- Existing names retained for compatibility:
-- memberships = organization_members, job_profiles = positions, audit_events = audit_logs.

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner','hse','manager','hr','member','viewer'));

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  parent_id uuid references public.departments(id) on delete set null,
  manager_user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

alter table public.employees
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text,
  title text not null,
  requirement_type text not null check (requirement_type in ('briefing','training','medical','ppe','document','inspection','other')),
  description text,
  recurrence_days integer check (recurrence_days is null or recurrence_days > 0),
  source_document_id uuid references public.documents(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,title)
);

create table if not exists public.employee_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete set null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','verified','waived','expired')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  waiver_reason text,
  source_type text,
  source_id uuid,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  check (status <> 'completed' or (completed_at is not null and completed_by is not null)),
  check (status <> 'verified' or (completed_at is not null and completed_by is not null and verified_at is not null and verified_by is not null)),
  check (verified_by is null or completed_by is null or verified_by <> completed_by)
);

create unique index if not exists employee_requirement_active_uniq
  on public.employee_requirements(organization_id,employee_id,requirement_id)
  where archived_at is null;
create index if not exists employee_requirements_due_idx
  on public.employee_requirements(organization_id,status,due_date) where archived_at is null;

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_requirement_id uuid references public.employee_requirements(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  storage_path text,
  evidence_type text not null default 'document' check (evidence_type in ('document','photo','video','certificate','signature','note','system')),
  note text,
  checksum_sha256 text,
  captured_at timestamptz not null default now(),
  captured_by uuid default auth.uid() references auth.users(id),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(employee_requirement_id,task_id) = 1)
);

create index if not exists evidence_requirement_idx on public.evidence(employee_requirement_id);
create index if not exists evidence_task_idx on public.evidence(task_id);

alter table public.audit_events
  add column if not exists request_id uuid,
  add column if not exists ip_hash text,
  add column if not exists user_agent text,
  add column if not exists context jsonb not null default '{}'::jsonb;

create or replace function public.has_permission(org_id uuid, permission_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select (select auth.uid()) is not null and (
    public.is_platform_admin() or exists (
      select 1 from public.memberships m
      where m.organization_id=org_id
        and m.user_id=(select auth.uid())
        and m.is_active=true
        and (
          m.role='owner'
          or permission_key='employees.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='employees.manage' and m.role in ('hse','hr')
          or permission_key='employees.import' and m.role in ('hse','hr')
          or permission_key='requirements.assign' and m.role='hse'
          or permission_key='requirements.complete' and m.role in ('hse','manager','member')
          or permission_key='requirements.verify' and m.role in ('hse','manager')
          or permission_key='tasks.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='tasks.manage' and m.role in ('hse','manager')
          or permission_key='documents.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='documents.manage' and m.role='hse'
          or permission_key='inventory.view' and m.role in ('hse','manager','viewer')
          or permission_key='inventory.manage' and m.role='hse'
          or permission_key='audit.view' and m.role='hse'
        )
    )
  );
$$;
revoke all on function public.has_permission(uuid,text) from public,anon;
grant execute on function public.has_permission(uuid,text) to authenticated;

create or replace function public.guard_employee_requirement_transition()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.organization_id <> old.organization_id
     or new.employee_id <> old.employee_id
     or new.requirement_id <> old.requirement_id then
    raise exception 'OBLIGATION_IDENTITY_IMMUTABLE';
  end if;
  if new.status='completed' and old.status is distinct from 'completed' then
    if not public.has_permission(new.organization_id,'requirements.complete') then raise exception 'FORBIDDEN'; end if;
    new.completed_at:=coalesce(new.completed_at,now());
    new.completed_by:=(select auth.uid());
    new.verified_at:=null;
    new.verified_by:=null;
  end if;
  if new.status='verified' and old.status is distinct from 'verified' then
    if old.completed_at is null or old.completed_by is null then raise exception 'COMPLETE_BEFORE_VERIFY'; end if;
    if not public.has_permission(new.organization_id,'requirements.verify') then raise exception 'FORBIDDEN'; end if;
    if old.completed_by=(select auth.uid()) then raise exception 'SECOND_PERSON_REQUIRED'; end if;
    new.completed_at:=old.completed_at;
    new.completed_by:=old.completed_by;
    new.verified_at:=now();
    new.verified_by:=(select auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.guard_employee_requirement_transition() from public,anon,authenticated;

drop trigger if exists employee_requirements_transition_guard on public.employee_requirements;
create trigger employee_requirements_transition_guard
before update on public.employee_requirements
for each row execute function public.guard_employee_requirement_transition();

alter table public.departments enable row level security;
alter table public.requirements enable row level security;
alter table public.employee_requirements enable row level security;
alter table public.evidence enable row level security;

grant select,insert,update,delete on public.departments to authenticated;
grant select,insert,update,delete on public.requirements to authenticated;
grant select,insert,update on public.employee_requirements to authenticated;
grant select,insert,update on public.evidence to authenticated;

create policy "departments read" on public.departments for select to authenticated
  using(public.has_permission(organization_id,'employees.view'));
create policy "departments insert" on public.departments for insert to authenticated
  with check(public.has_permission(organization_id,'employees.manage'));
create policy "departments update" on public.departments for update to authenticated
  using(public.has_permission(organization_id,'employees.manage'))
  with check(public.has_permission(organization_id,'employees.manage'));
create policy "departments delete" on public.departments for delete to authenticated
  using(public.has_permission(organization_id,'employees.manage'));

create policy "requirements read" on public.requirements for select to authenticated
  using(public.is_org_member(organization_id));
create policy "requirements insert" on public.requirements for insert to authenticated
  with check(public.has_permission(organization_id,'requirements.assign'));
create policy "requirements update" on public.requirements for update to authenticated
  using(public.has_permission(organization_id,'requirements.assign'))
  with check(public.has_permission(organization_id,'requirements.assign'));
create policy "requirements delete" on public.requirements for delete to authenticated
  using(public.has_permission(organization_id,'requirements.assign'));

create policy "employee requirements read" on public.employee_requirements for select to authenticated
  using(public.has_permission(organization_id,'employees.view'));
create policy "employee requirements insert" on public.employee_requirements for insert to authenticated
  with check(public.has_permission(organization_id,'requirements.assign'));
create policy "employee requirements update" on public.employee_requirements for update to authenticated
  using(public.has_permission(organization_id,'requirements.complete'))
  with check(public.has_permission(organization_id,'requirements.complete'));

create policy "evidence read" on public.evidence for select to authenticated
  using(public.is_org_member(organization_id));
create policy "evidence insert" on public.evidence for insert to authenticated
  with check(public.has_permission(organization_id,'requirements.complete'));
create policy "evidence update" on public.evidence for update to authenticated
  using(public.has_permission(organization_id,'requirements.verify'))
  with check(public.has_permission(organization_id,'requirements.verify'));

-- PostgreSQL combines permissive policies with OR. Remove legacy broad policies first.
do $$ declare t text; begin
  foreach t in array array['employees','inventory','ppe_issues','documents'] loop
    execute format('drop policy if exists "tenant read" on public.%I',t);
    execute format('drop policy if exists "tenant insert" on public.%I',t);
    execute format('drop policy if exists "tenant update" on public.%I',t);
    execute format('drop policy if exists "tenant delete" on public.%I',t);
    execute format('drop policy if exists "section read" on public.%I',t);
    execute format('drop policy if exists "section insert" on public.%I',t);
    execute format('drop policy if exists "section update" on public.%I',t);
    execute format('drop policy if exists "section delete" on public.%I',t);
  end loop;
end $$;

create policy "employees capability read" on public.employees for select to authenticated
  using(public.has_permission(organization_id,'employees.view'));
create policy "employees capability insert" on public.employees for insert to authenticated
  with check(public.has_permission(organization_id,'employees.manage'));
create policy "employees capability update" on public.employees for update to authenticated
  using(public.has_permission(organization_id,'employees.manage'))
  with check(public.has_permission(organization_id,'employees.manage'));

create policy "inventory capability read" on public.inventory for select to authenticated
  using(public.has_permission(organization_id,'inventory.view'));
create policy "inventory capability insert" on public.inventory for insert to authenticated
  with check(public.has_permission(organization_id,'inventory.manage'));
create policy "inventory capability update" on public.inventory for update to authenticated
  using(public.has_permission(organization_id,'inventory.manage'))
  with check(public.has_permission(organization_id,'inventory.manage'));

create policy "ppe capability read" on public.ppe_issues for select to authenticated
  using(public.has_permission(organization_id,'inventory.view'));
create policy "ppe capability insert" on public.ppe_issues for insert to authenticated
  with check(public.has_permission(organization_id,'inventory.manage'));
create policy "ppe capability update" on public.ppe_issues for update to authenticated
  using(public.has_permission(organization_id,'inventory.manage'))
  with check(public.has_permission(organization_id,'inventory.manage'));

create policy "documents capability read" on public.documents for select to authenticated
  using(public.has_permission(organization_id,'documents.view'));
create policy "documents capability insert" on public.documents for insert to authenticated
  with check(public.has_permission(organization_id,'documents.manage'));
create policy "documents capability update" on public.documents for update to authenticated
  using(public.has_permission(organization_id,'documents.manage'))
  with check(public.has_permission(organization_id,'documents.manage'));

create or replace function public.record_audit_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare old_row jsonb; new_row jsonb; org_id uuid; row_id uuid; event_action text; headers jsonb;
begin
  old_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  new_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  org_id:=coalesce((new_row->>'organization_id')::uuid,(old_row->>'organization_id')::uuid);
  if tg_table_name='organizations' then org_id:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid); end if;
  row_id:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
  headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  event_action:=case
    when tg_op='INSERT' then 'created'
    when tg_op='DELETE' then 'deleted'
    when old_row->>'archived_at' is null and new_row->>'archived_at' is not null then 'archived'
    when old_row->>'archived_at' is not null and new_row->>'archived_at' is null then 'restored'
    else 'updated' end;
  if org_id is not null then
    insert into public.audit_events(
      organization_id,actor_id,action,entity_type,entity_id,before_data,after_data,
      request_id,ip_hash,user_agent,context
    ) values(
      org_id,(select auth.uid()),event_action,tg_table_name,row_id,old_row,new_row,
      gen_random_uuid(),
      encode(digest(coalesce(headers->>'x-forwarded-for','unknown'),'sha256'),'hex'),
      left(coalesce(headers->>'user-agent','unknown'),512),
      jsonb_build_object('database_role',current_user,'provider_request_id',headers->>'x-request-id')
    );
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.record_audit_event() from public,anon,authenticated;

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql security invoker as $$
begin raise exception 'AUDIT_LOG_IMMUTABLE'; end;
$$;
revoke all on function public.prevent_audit_mutation() from public,anon,authenticated;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

revoke insert,update,delete,truncate on public.audit_events from anon,authenticated;

do $$ declare t text; begin
  foreach t in array array[
    'departments','requirements','employee_requirements','evidence',
    'job_profiles','learning_assignments','training_types'
  ] loop
    execute format('drop trigger if exists audit_row_change on public.%I',t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.record_audit_event()',t);
  end loop;
end $$;

drop trigger if exists departments_updated_at on public.departments;
create trigger departments_updated_at before update on public.departments
for each row execute function public.set_updated_at();
drop trigger if exists requirements_updated_at on public.requirements;
create trigger requirements_updated_at before update on public.requirements
for each row execute function public.set_updated_at();
drop trigger if exists employee_requirements_updated_at on public.employee_requirements;
create trigger employee_requirements_updated_at before update on public.employee_requirements
for each row execute function public.set_updated_at();

comment on table public.employee_requirements is
  'Canonical safety obligation: requirement + employee + due date + owner + status + closure evidence.';
