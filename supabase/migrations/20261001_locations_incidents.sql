-- Locations and incidents are tenant-scoped operational records.
create table public.safety_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  kind text not null check (kind in ('site','building','room','workplace')),
  name text not null check (length(trim(name)) between 2 and 160),
  address text,
  description text,
  responsible_id uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key (parent_id,organization_id) references public.safety_locations(id,organization_id)
);
create index safety_locations_org_parent_idx on public.safety_locations(organization_id,parent_id) where archived_at is null;

create function public.validate_safety_location() returns trigger language plpgsql set search_path=public as $$
declare parent_kind text; parent_parent uuid;
begin
  if new.parent_id is null then
    if new.kind <> 'site' then raise exception 'Only a site can be a root location'; end if;
  else
    select kind,parent_id into parent_kind,parent_parent from public.safety_locations
      where id=new.parent_id and organization_id=new.organization_id and archived_at is null;
    if parent_kind is null or (parent_kind='site' and new.kind<>'building')
      or (parent_kind='building' and new.kind not in ('room','workplace'))
      or (parent_kind='room' and new.kind<>'workplace')
      or parent_kind='workplace'
    then raise exception 'Invalid location hierarchy'; end if;
    if new.id=new.parent_id or parent_parent=new.id then raise exception 'Cyclic location hierarchy'; end if;
  end if;
  return new;
end $$;
create trigger safety_location_validate before insert or update of kind,parent_id,organization_id on public.safety_locations
  for each row execute function public.validate_safety_location();
create function public.guard_safety_location_archive() returns trigger language plpgsql set search_path=public as $$
begin
  if old.archived_at is null and new.archived_at is not null and (
    exists(select 1 from public.safety_locations where parent_id=old.id and archived_at is null)
    or exists(select 1 from public.inventory where location_id=old.id and archived_at is null)
    or exists(select 1 from public.safety_incidents where location_id=old.id and archived_at is null)
  ) then raise exception 'Move active child locations, assets and incidents before archiving'; end if;
  return new;
end $$;
create trigger safety_location_updated before update on public.safety_locations for each row execute function public.set_updated_at();
create trigger safety_location_audit after insert or update or delete on public.safety_locations
  for each row execute function public.record_audit_event();

create table public.safety_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  title text not null check (length(trim(title)) between 3 and 180),
  category text not null check (category in ('incident','near_miss','injury','fire','hazard')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'reported' check (status in ('reported','investigating','actions','verification','closed')),
  occurred_at timestamptz not null,
  description text not null check (length(trim(description))>=10),
  immediate_action text,
  root_cause text,
  evidence_path text,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key (location_id,organization_id) references public.safety_locations(id,organization_id)
);
create index safety_incidents_org_status_date_idx on public.safety_incidents(organization_id,status,occurred_at desc) where archived_at is null;
create index safety_incidents_location_idx on public.safety_incidents(location_id) where archived_at is null;
create index tasks_incident_source_idx on public.tasks(organization_id,source_id) where source_type='incident' and archived_at is null;

create function public.guard_incident_closure() returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='closed' and (tg_op='INSERT' or old.status is distinct from 'closed') then
    if new.root_cause is null or length(trim(new.root_cause))<10 or new.evidence_path is null
      or not exists(select 1 from public.tasks where organization_id=new.organization_id
        and source_type='incident' and source_id=new.id and archived_at is null)
      or exists(select 1 from public.tasks where organization_id=new.organization_id
        and source_type='incident' and source_id=new.id and archived_at is null and status<>'verified')
    then raise exception 'Complete investigation, attach evidence and verify all measures before closing'; end if;
    new.verified_by:=auth.uid(); new.verified_at:=now();
  elsif new.status<>'closed' then
    new.verified_by:=null; new.verified_at:=null;
  end if;
  return new;
end $$;
create trigger safety_incident_guard before insert or update on public.safety_incidents
  for each row execute function public.guard_incident_closure();
create trigger safety_incident_updated before update on public.safety_incidents for each row execute function public.set_updated_at();
create trigger safety_incident_audit after insert or update or delete on public.safety_incidents
  for each row execute function public.record_audit_event();
create trigger safety_location_archive before update of archived_at on public.safety_locations
  for each row execute function public.guard_safety_location_archive();
create function public.guard_closed_incident_measures() returns trigger language plpgsql set search_path=public as $$
declare incident_id uuid; org_id uuid;
begin
  incident_id:=coalesce(new.source_id,old.source_id);
  org_id:=coalesce(new.organization_id,old.organization_id);
  if coalesce(new.source_type,old.source_type)='incident'
    and exists(select 1 from public.safety_incidents where id=incident_id and organization_id=org_id
      and status='closed' and archived_at is null)
    and (tg_op='DELETE' or new.archived_at is not null or new.status<>'verified'
      or new.source_id is distinct from old.source_id)
  then raise exception 'Reopen the incident before changing a verified measure'; end if;
  return coalesce(new,old);
end $$;
create trigger tasks_closed_incident_guard before update or delete on public.tasks
  for each row when (old.source_type='incident') execute function public.guard_closed_incident_measures();

alter table public.inventory add column location_id uuid;
alter table public.inventory add constraint inventory_safety_location_fk foreign key (location_id,organization_id)
  references public.safety_locations(id,organization_id);

alter table public.safety_locations enable row level security;
alter table public.safety_incidents enable row level security;
create policy "locations read" on public.safety_locations for select to authenticated
  using (public.has_section_access(organization_id,'locations') or public.has_section_access(organization_id,'incidents'));
create policy "locations insert" on public.safety_locations for insert to authenticated
  with check (public.can_manage_section(organization_id,'locations'));
create policy "locations update" on public.safety_locations for update to authenticated
  using (public.can_manage_section(organization_id,'locations'))
  with check (public.can_manage_section(organization_id,'locations'));
create policy "incidents read" on public.safety_incidents for select to authenticated
  using (public.has_section_access(organization_id,'incidents'));
create policy "incidents insert" on public.safety_incidents for insert to authenticated
  with check (public.can_manage_section(organization_id,'incidents'));
create policy "incidents update" on public.safety_incidents for update to authenticated
  using (public.can_manage_section(organization_id,'incidents'))
  with check (public.can_manage_section(organization_id,'incidents'));
grant select,insert,update on public.safety_locations, public.safety_incidents to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('incident-evidence','incident-evidence',false,10485760,array['application/pdf','image/png','image/jpeg'])
  on conflict(id) do nothing;
create policy "incident evidence read" on storage.objects for select to authenticated
  using (bucket_id='incident-evidence' and public.has_section_access((storage.foldername(name))[1]::uuid,'incidents'));
create policy "incident evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id='incident-evidence' and public.can_manage_section((storage.foldername(name))[1]::uuid,'incidents'));

-- Give existing HSE engineers access to the two new workflows. Owners already
-- have access through their role; other roles remain under the owner's control.
update public.memberships set section_permissions=(
  select array_agg(distinct permission_key)
  from unnest(coalesce(section_permissions,array[]::text[]) || array['locations','incidents']) as permission_key
) where role='hse' and is_active=true;
