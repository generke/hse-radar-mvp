-- Closed investigations are immutable until deliberately reopened.
create or replace function public.guard_incident_closure()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
      or new.created_by is distinct from old.created_by then
      raise exception 'INCIDENT_IDENTITY_IMMUTABLE';
    end if;
    if old.status='closed' and new.status='closed' then
      if new is distinct from old then raise exception 'REOPEN_INCIDENT_REQUIRED'; end if;
      return new;
    end if;
  end if;
  if new.status='closed' then
    if new.root_cause is null or length(trim(new.root_cause))<10
      or nullif(trim(new.evidence_path),'') is null
      or split_part(new.evidence_path,'/',1)<>new.organization_id::text
      or split_part(new.evidence_path,'/',2)<>new.id::text
      or not exists(select 1 from storage.objects where bucket_id='incident-evidence' and name=new.evidence_path)
      or not exists(select 1 from public.tasks where organization_id=new.organization_id
        and source_type='incident' and source_id=new.id and archived_at is null)
      or exists(select 1 from public.tasks where organization_id=new.organization_id
        and source_type='incident' and source_id=new.id and archived_at is null and status<>'verified')
    then raise exception 'INCIDENT_CLOSURE_INCOMPLETE'; end if;
    new.verified_by:=auth.uid(); new.verified_at:=now();
  else
    new.verified_by:=null; new.verified_at:=null;
  end if;
  return new;
end $$;

-- Internal trigger must see the parent even when a task assignee cannot read
-- the incident section. It exposes no data and is not callable by API roles.
create schema if not exists private;
create or replace function private.guard_closed_incident_measures()
returns trigger language plpgsql security definer set search_path=public as $$
declare old_incident uuid; new_incident uuid;
begin
  if tg_op in ('UPDATE','DELETE') and old.source_type='incident' then old_incident:=old.source_id; end if;
  if tg_op in ('INSERT','UPDATE') and new.source_type='incident' then new_incident:=new.source_id; end if;
  -- Serialize task changes with closing/reopening their parent investigation.
  perform id from public.safety_incidents where id in (old_incident,new_incident)
    order by id for update;
  -- Check OLD first: changing source_type/source_id must not evade this guard.
  if tg_op in ('UPDATE','DELETE') then
    if old.source_type='incident' and exists(
      select 1 from public.safety_incidents where id=old.source_id
        and organization_id=old.organization_id and status='closed'
    ) then raise exception 'REOPEN_INCIDENT_REQUIRED'; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if new.source_type='incident' and exists(
      select 1 from public.safety_incidents where id=new.source_id
        and organization_id=new.organization_id and status='closed'
    ) then raise exception 'REOPEN_INCIDENT_REQUIRED'; end if;
    return new;
  end if;
  return old;
end $$;
drop trigger tasks_closed_incident_guard on public.tasks;
create trigger tasks_closed_incident_guard before insert or update or delete on public.tasks
  for each row execute function private.guard_closed_incident_measures();
drop function public.guard_closed_incident_measures();

-- TMC users need location names when assigning assets, without gaining writes.
alter policy "locations read" on public.safety_locations to authenticated
  using (public.has_section_access(organization_id,'locations')
    or public.has_section_access(organization_id,'incidents')
    or public.has_section_access(organization_id,'tmc'));

revoke all on function public.guard_incident_closure() from public,anon,authenticated;
revoke all on function private.guard_closed_incident_measures() from public,anon,authenticated;

-- A direct REST insert must follow the same completion/verification workflow.
create or replace function private.guard_task_creation()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.status not in ('open','in_progress') then raise exception 'TASK_START_OPEN'; end if;
  new.completed_at:=null; new.completed_by:=null;
  new.verified_at:=null; new.verified_by:=null;
  return new;
end $$;
create trigger tasks_creation_guard before insert on public.tasks
  for each row execute function private.guard_task_creation();
revoke all on function private.guard_task_creation() from public,anon,authenticated;
