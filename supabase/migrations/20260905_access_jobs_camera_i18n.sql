-- Role-aware sections, job profiles and structured learning taxonomy.

alter table public.memberships
  add column if not exists section_permissions text[] not null default array['overview','tasks','learning'];

update public.memberships set section_permissions = case role
  when 'owner' then array['overview','employees','positions','inventory','ppe','documents','tasks','learning','vision','team','audit','billing','admin']
  when 'hse' then array['overview','employees','positions','inventory','ppe','documents','tasks','learning','vision','audit']
  when 'hr' then array['overview','employees','documents','learning']
  when 'manager' then array['overview','employees','tasks','learning','vision']
  else array['overview','tasks','learning']
end
where cardinality(section_permissions)=0 or section_permissions=array['overview','tasks','learning'];

create or replace function public.has_section_access(org_id uuid, section_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.memberships
    where organization_id=org_id and user_id=auth.uid()
      and (role='owner' or section_key=any(section_permissions))
  );
$$;

create or replace function public.can_manage_section(org_id uuid, section_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.memberships
    where organization_id=org_id and user_id=auth.uid()
      and (role='owner' or (role in ('hse','manager','hr') and section_key=any(section_permissions)))
  );
$$;

create table if not exists public.job_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  required_fields text[] not null default array['medical_exam','briefing'],
  required_training_codes text[] not null default array['intro'],
  custom_training_name text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,title)
);

alter table public.employees
  add column if not exists job_profile_id uuid references public.job_profiles(id) on delete set null,
  add column if not exists required_training_codes text[] not null default array['intro'];

alter table public.learning_courses
  add column if not exists format text not null default 'briefing'
    check(format in ('briefing','training','exam')),
  add column if not exists training_type text not null default 'intro'
    check(training_type in ('intro','workplace','electrical','ptm','first_aid','industrial_safety','hse_exam','other')),
  add column if not exists custom_type_name text,
  add column if not exists requires_test boolean not null default false;

update public.learning_courses
set format=case when course_type='knowledge_check' then 'exam' else 'briefing' end,
    training_type=case when course_type='knowledge_check' then 'hse_exam' else 'intro' end,
    requires_test=(course_type='knowledge_check');

alter table public.job_profiles enable row level security;
drop policy if exists "job profiles read" on public.job_profiles;
create policy "job profiles read" on public.job_profiles for select
using(public.has_section_access(organization_id,'employees'));
drop policy if exists "job profiles insert" on public.job_profiles;
create policy "job profiles insert" on public.job_profiles for insert
with check(public.can_admin_org(organization_id));
drop policy if exists "job profiles update" on public.job_profiles;
create policy "job profiles update" on public.job_profiles for update
using(public.can_admin_org(organization_id)) with check(public.can_admin_org(organization_id));
drop policy if exists "job profiles delete" on public.job_profiles;
create policy "job profiles delete" on public.job_profiles for delete
using(public.can_admin_org(organization_id));

drop trigger if exists job_profiles_updated_at on public.job_profiles;
create trigger job_profiles_updated_at before update on public.job_profiles
for each row execute function public.set_updated_at();
drop trigger if exists audit_row_change on public.job_profiles;
create trigger audit_row_change after insert or update or delete on public.job_profiles
for each row execute function public.record_audit_event();

-- Enforce section visibility at the database boundary.
do $$ declare pair text[]; begin
  foreach pair slice 1 in array array[
    ['employees','employees'],['inventory','inventory'],['ppe_issues','ppe'],
    ['documents','documents'],['tasks','tasks'],['learning_courses','learning'],
    ['learning_questions','learning'],['learning_attempts','learning'],
    ['learning_assignments','learning'],['vision_cameras','vision'],['vision_events','vision']
  ] loop
    execute format('drop policy if exists "tenant read" on public.%I',pair[1]);
    execute format('drop policy if exists "tasks org read" on public.%I',pair[1]);
    execute format('drop policy if exists "section read" on public.%I',pair[1]);
    execute format('create policy "section read" on public.%I for select using (public.has_section_access(organization_id,%L))',pair[1],pair[2]);
  end loop;
end $$;

-- A hidden module must also be protected from direct API writes.
do $$ declare pair text[]; begin
  foreach pair slice 1 in array array[
    ['employees','employees'],['inventory','inventory'],['ppe_issues','ppe'],
    ['documents','documents'],['learning_courses','learning'],
    ['learning_questions','learning'],['learning_assignments','learning'],
    ['vision_cameras','vision'],['vision_events','vision']
  ] loop
    execute format('drop policy if exists "tenant insert" on public.%I',pair[1]);
    execute format('drop policy if exists "section insert" on public.%I',pair[1]);
    execute format('create policy "section insert" on public.%I for insert with check (public.can_manage_section(organization_id,%L))',pair[1],pair[2]);
    execute format('drop policy if exists "tenant update" on public.%I',pair[1]);
    execute format('drop policy if exists "section update" on public.%I',pair[1]);
    execute format('create policy "section update" on public.%I for update using (public.can_manage_section(organization_id,%L)) with check (public.can_manage_section(organization_id,%L))',pair[1],pair[2],pair[2]);
    execute format('drop policy if exists "tenant delete" on public.%I',pair[1]);
    execute format('drop policy if exists "section delete" on public.%I',pair[1]);
    execute format('create policy "section delete" on public.%I for delete using (public.can_manage_section(organization_id,%L))',pair[1],pair[2]);
  end loop;
end $$;

drop policy if exists "tenant insert" on public.learning_attempts;
drop policy if exists "section insert" on public.learning_attempts;
create policy "section insert" on public.learning_attempts for insert with check (
  public.has_section_access(organization_id,'learning')
  and (taken_by=auth.uid() or public.can_manage_section(organization_id,'learning'))
);

drop policy if exists "tasks org insert" on public.tasks;
drop policy if exists "section insert" on public.tasks;
create policy "section insert" on public.tasks for insert
with check(public.is_platform_admin() or (public.is_org_member(organization_id) and public.can_manage_section(organization_id,'tasks')));
drop policy if exists "tasks org update" on public.tasks;
drop policy if exists "section update" on public.tasks;
create policy "section update" on public.tasks for update
using(public.has_section_access(organization_id,'tasks') and (public.can_manage_section(organization_id,'tasks') or assignee_id=auth.uid()))
with check(public.is_platform_admin() or (public.is_org_member(organization_id) and public.has_section_access(organization_id,'tasks') and (public.can_manage_section(organization_id,'tasks') or assignee_id=auth.uid())));
drop policy if exists "section delete" on public.tasks;
create policy "section delete" on public.tasks for delete
using(public.can_manage_section(organization_id,'tasks'));

drop policy if exists "audit org read" on public.audit_events;
create policy "audit org read" on public.audit_events for select
using(public.has_section_access(organization_id,'audit'));

create index if not exists job_profiles_org_idx on public.job_profiles(organization_id,title);
create index if not exists employees_job_profile_idx on public.employees(job_profile_id);
