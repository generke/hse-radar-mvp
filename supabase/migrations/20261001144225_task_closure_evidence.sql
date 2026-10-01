-- A corrective action is not closed by changing a dropdown. Completion needs
-- evidence, and verification must be performed by a second authorized person.

alter table public.tasks
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_by uuid references auth.users(id) on delete set null;

update public.tasks
set completed_by=coalesce(assignee_id,created_by)
where status in ('done','verified') and completed_at is not null and completed_by is null;

create or replace function public.guard_task_transition()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  actor uuid := (select auth.uid());
begin
  if new.organization_id <> old.organization_id or new.created_by <> old.created_by then
    raise exception 'TASK_IDENTITY_IMMUTABLE';
  end if;

  if new.status='verified' and old.status is distinct from 'verified' then
    if old.status <> 'done' or old.completed_at is null or old.completed_by is null then
      raise exception 'COMPLETE_BEFORE_VERIFY';
    end if;
    if actor is null or not public.can_manage_section(new.organization_id,'tasks') then
      raise exception 'FORBIDDEN';
    end if;
    if old.completed_by=actor then
      raise exception 'SECOND_PERSON_REQUIRED';
    end if;
    if not exists(select 1 from public.evidence e where e.task_id=old.id) then
      raise exception 'EVIDENCE_REQUIRED';
    end if;
    new.completed_at:=old.completed_at;
    new.completed_by:=old.completed_by;
    new.verified_at:=now();
    new.verified_by:=actor;
    update public.evidence
      set verified_at=coalesce(verified_at,now()),verified_by=coalesce(verified_by,actor)
      where task_id=old.id;
  elsif new.status='done' and old.status is distinct from 'done' then
    if not exists(select 1 from public.evidence e where e.task_id=old.id) then
      raise exception 'EVIDENCE_REQUIRED';
    end if;
    new.completed_at:=now();
    new.completed_by:=actor;
    new.verified_at:=null;
    new.verified_by:=null;
  elsif new.status in ('open','in_progress') and old.status is distinct from new.status then
    new.completed_at:=null;
    new.completed_by:=null;
    new.verified_at:=null;
    new.verified_by:=null;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_task_transition() from public,anon,authenticated;
drop trigger if exists tasks_transition_guard on public.tasks;
create trigger tasks_transition_guard
before update on public.tasks
for each row execute function public.guard_task_transition();

drop policy if exists "evidence insert" on public.evidence;
drop policy if exists "evidence update" on public.evidence;
create policy "evidence insert" on public.evidence
for insert to authenticated
with check (
  captured_by=(select auth.uid())
  and (
    employee_requirement_id is not null
      and public.has_permission(organization_id,'requirements.complete')
    or task_id is not null and exists(
      select 1 from public.tasks t
      where t.id=task_id and t.organization_id=organization_id
        and (
          public.can_manage_section(organization_id,'tasks')
          or t.assignee_id=(select auth.uid())
          or t.created_by=(select auth.uid())
        )
    )
  )
);
create policy "evidence update" on public.evidence
for update to authenticated
using (
  employee_requirement_id is not null
    and public.has_permission(organization_id,'requirements.verify')
  or task_id is not null and public.can_manage_section(organization_id,'tasks')
)
with check (
  employee_requirement_id is not null
    and public.has_permission(organization_id,'requirements.verify')
  or task_id is not null and public.can_manage_section(organization_id,'tasks')
);

create index if not exists tasks_completed_by_idx
  on public.tasks(completed_by) where completed_by is not null;
create index if not exists tasks_verified_by_idx
  on public.tasks(verified_by) where verified_by is not null;

comment on column public.tasks.completed_by is
  'Actor who submitted evidence-backed completion.';
comment on column public.tasks.verified_by is
  'Second authorized actor who independently verified completion.';
