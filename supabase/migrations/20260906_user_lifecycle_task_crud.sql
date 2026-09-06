-- User lifecycle, reliable team access and self-service task editing.

alter table public.memberships add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists email text;
update public.profiles p set email=u.email from auth.users u where u.id=p.id and p.email is distinct from u.email;

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and is_active=true);
$$;
create or replace function public.can_manage_org(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and is_active=true and role in ('owner','hse','hr'));
$$;
create or replace function public.can_admin_org(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and is_active=true and role='owner');
$$;
create or replace function public.has_section_access(org_id uuid, section_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and is_active=true and (role='owner' or section_key=any(section_permissions)));
$$;
create or replace function public.can_manage_section(org_id uuid, section_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(select 1 from public.memberships where organization_id=org_id and user_id=auth.uid() and is_active=true and (role='owner' or (role in ('hse','manager','hr') and section_key=any(section_permissions))));
$$;

drop policy if exists "section update" on public.tasks;
create policy "section update" on public.tasks for update
using(public.has_section_access(organization_id,'tasks') and (public.can_manage_section(organization_id,'tasks') or assignee_id=auth.uid() or created_by=auth.uid()))
with check(public.has_section_access(organization_id,'tasks') and (public.can_manage_section(organization_id,'tasks') or assignee_id=auth.uid() or created_by=auth.uid()));
drop policy if exists "section delete" on public.tasks;
create policy "section delete" on public.tasks for delete
using(public.has_section_access(organization_id,'tasks') and (public.can_manage_section(organization_id,'tasks') or assignee_id=auth.uid() or created_by=auth.uid()));

create or replace function public.archive_record(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare org_id uuid; creator_id uuid; responsible_id uuid; section_key text;
begin
  if target_table not in ('employees','inventory','ppe_issues','documents','tasks') then raise exception 'INVALID_TABLE'; end if;
  if target_table='tasks' then
    select organization_id,created_by,assignee_id into org_id,creator_id,responsible_id from public.tasks where id=target_id;
    if org_id is null or not public.has_section_access(org_id,'tasks') or not (public.can_manage_section(org_id,'tasks') or creator_id=auth.uid() or responsible_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
  else
    section_key:=case target_table when 'ppe_issues' then 'ppe' else target_table end;
    execute format('select organization_id from public.%I where id=$1',target_table) into org_id using target_id;
    if org_id is null or not public.can_manage_section(org_id,section_key) then raise exception 'FORBIDDEN'; end if;
  end if;
  execute format('update public.%I set archived_at=now(), archived_by=$1 where id=$2 and archived_at is null',target_table) using auth.uid(),target_id;
end;
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare org_id uuid; display_name text;
begin
  display_name:=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1));
  insert into public.profiles(id,full_name,email) values(new.id,display_name,new.email) on conflict(id) do update set email=excluded.email;
  if new.invited_at is not null then return new; end if;
  insert into public.organizations(name) values(display_name||' · HSE') returning id into org_id;
  insert into public.memberships(organization_id,user_id,role,is_active) values(org_id,new.id,'owner',true);
  return new;
end;
$$;

create index if not exists memberships_active_idx on public.memberships(organization_id,is_active);
