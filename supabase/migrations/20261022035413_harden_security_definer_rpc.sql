create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter default privileges revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from anon, authenticated;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.platform_admins
      where user_id = (select auth.uid())
    );
$$;

create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.memberships
      where organization_id = org_id
        and user_id = (select auth.uid())
        and is_active = true
    );
$$;

create or replace function private.can_admin_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_platform_admin()
      or exists (
        select 1
        from public.memberships
        where organization_id = org_id
          and user_id = (select auth.uid())
          and is_active = true
          and role = 'owner'
      )
    );
$$;

create or replace function private.can_manage_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_platform_admin()
      or exists (
        select 1
        from public.memberships m
        where m.organization_id = org_id
          and m.user_id = (select auth.uid())
          and m.is_active = true
          and m.role in ('owner', 'hse')
      )
    );
$$;

create or replace function private.can_manage_section(org_id uuid, section_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_platform_admin()
      or exists (
        select 1
        from public.memberships m
        where m.organization_id = org_id
          and m.user_id = (select auth.uid())
          and m.is_active = true
          and (
            m.role = 'owner'
            or section_key = any(m.section_permissions) and (
              m.role = 'hse'
              or m.role = 'manager' and section_key in ('tasks', 'learning', 'vision')
              or m.role = 'hr' and section_key = 'employees'
            )
          )
      )
    );
$$;

create or replace function private.has_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_platform_admin()
      or exists (
        select 1
        from public.memberships m
        where m.organization_id = org_id
          and m.user_id = (select auth.uid())
          and m.is_active = true
          and (
            m.role = 'owner'
            or permission_key = 'employees.view' and m.role in ('hse', 'manager', 'hr', 'member', 'viewer')
            or permission_key = 'employees.manage' and m.role in ('hse', 'hr')
            or permission_key = 'employees.import' and m.role in ('hse', 'hr')
            or permission_key = 'requirements.assign' and m.role = 'hse'
            or permission_key = 'requirements.complete' and m.role in ('hse', 'manager', 'member')
            or permission_key = 'requirements.verify' and m.role in ('hse', 'manager')
            or permission_key = 'tasks.view' and m.role in ('hse', 'manager', 'hr', 'member', 'viewer')
            or permission_key = 'tasks.manage' and m.role in ('hse', 'manager')
            or permission_key = 'documents.view' and m.role in ('hse', 'manager', 'hr', 'member', 'viewer')
            or permission_key = 'documents.manage' and m.role = 'hse'
            or permission_key = 'inventory.view' and m.role in ('hse', 'manager', 'viewer')
            or permission_key = 'inventory.manage' and m.role = 'hse'
          )
      )
    );
$$;

create or replace function private.has_section_access(org_id uuid, section_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_platform_admin()
      or exists (
        select 1
        from public.memberships
        where organization_id = org_id
          and user_id = (select auth.uid())
          and is_active = true
          and (role = 'owner' or section_key = any(section_permissions))
      )
    );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_platform_admin(); $$;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_org_member(org_id); $$;

create or replace function public.can_admin_org(org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.can_admin_org(org_id); $$;

create or replace function public.can_manage_org(org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.can_manage_org(org_id); $$;

create or replace function public.can_manage_section(org_id uuid, section_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.can_manage_section(org_id, section_key); $$;

create or replace function public.has_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.has_permission(org_id, permission_key); $$;

create or replace function public.has_section_access(org_id uuid, section_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.has_section_access(org_id, section_key); $$;

create or replace function private.approve_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  months integer;
  ref text;
  paid_amount numeric;
begin
  if not private.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select organization_id, billing_months, payment_reference, amount
    into target_org, months, ref, paid_amount
  from public.payment_requests
  where id = request_id and status = 'pending'
  for update;

  if target_org is null then
    raise exception 'PAYMENT_REQUEST_NOT_PENDING';
  end if;

  update public.organizations
  set plan = 'pro',
      subscription_status = 'active',
      subscription_expires_at = greatest(coalesce(subscription_expires_at, now()), now())
        + make_interval(months => months)
  where id = target_org;

  update public.payment_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = request_id;

  insert into public.billing_events(
    organization_id, provider, external_id, event_type, amount, created_by, payload
  )
  values (
    target_org, 'kaspi_pay', request_id::text, 'payment_approved', paid_amount,
    (select auth.uid()), jsonb_build_object('reference', ref, 'months', months)
  )
  on conflict(provider, external_id, event_type) do nothing;
end;
$$;

create or replace function private.reject_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.payment_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = request_id and status = 'pending';
end;
$$;

create or replace function private.archive_record(target_table text, target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid;
  creator_id uuid;
  responsible_id uuid;
  section_key text;
begin
  if target_table not in ('employees', 'inventory', 'ppe_issues', 'documents', 'tasks') then
    raise exception 'INVALID_TABLE';
  end if;

  if target_table = 'tasks' then
    select organization_id, created_by, assignee_id
      into org_id, creator_id, responsible_id
    from public.tasks
    where id = target_id;

    if org_id is null
      or not private.has_section_access(org_id, 'tasks')
      or not (
        private.can_manage_section(org_id, 'tasks')
        or creator_id = (select auth.uid())
        or responsible_id = (select auth.uid())
      ) then
      raise exception 'FORBIDDEN';
    end if;
  else
    section_key := case target_table when 'ppe_issues' then 'ppe' else target_table end;
    execute format('select organization_id from public.%I where id=$1', target_table)
      into org_id using target_id;

    if org_id is null or not private.can_manage_section(org_id, section_key) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  execute format(
    'update public.%I set archived_at=now(), archived_by=$1 where id=$2 and archived_at is null',
    target_table
  ) using (select auth.uid()), target_id;
end;
$$;

create or replace function private.invite_member_by_email(
  org_id uuid,
  invite_email text,
  invite_role text,
  invite_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
  invite_token uuid;
  normalized text := lower(trim(invite_email));
begin
  if not private.can_admin_org(org_id) then
    raise exception 'FORBIDDEN';
  end if;

  if invite_role not in ('owner', 'hse', 'manager', 'hr', 'member') then
    raise exception 'INVALID_ROLE';
  end if;

  if normalized = '' or normalized !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  select * into target
  from public.profiles
  where lower(email) = normalized
  limit 1;

  if target.id is not null then
    insert into public.memberships(organization_id, user_id, role, section_permissions, is_active)
    values(org_id, target.id, invite_role, coalesce(invite_permissions, '{}'::text[]), true)
    on conflict(organization_id, user_id) do update
      set role = excluded.role,
          section_permissions = excluded.section_permissions,
          is_active = true;

    return jsonb_build_object(
      'existing', true,
      'user_id', target.id,
      'full_name', target.full_name,
      'email', target.email
    );
  end if;

  insert into public.organization_invites(
    organization_id, email, role, section_permissions, invited_by
  )
  values(
    org_id, normalized, invite_role, coalesce(invite_permissions, '{}'::text[]), (select auth.uid())
  )
  on conflict(organization_id, lower(email)) where accepted_at is null
  do update set
    role = excluded.role,
    section_permissions = excluded.section_permissions,
    expires_at = now() + interval '14 days',
    invited_by = (select auth.uid())
  returning token into invite_token;

  return jsonb_build_object('existing', false, 'token', invite_token, 'email', normalized);
end;
$$;

create or replace function private.vision_send_telegram_target(
  p_organization_id uuid,
  p_target_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.vision_notification_targets%rowtype;
begin
  if not private.can_manage_section(p_organization_id, 'vision') then
    raise exception 'Access denied';
  end if;

  select * into target
  from public.vision_notification_targets
  where id = p_target_id
    and organization_id = p_organization_id
    and enabled = true;

  if not found then
    raise exception 'Target not found';
  end if;

  return public.vision_send_telegram(
    target.chat_id,
    format('✅ HSE Radar · Safety Vision\nТестовые уведомления для «%s» работают.', target.label)
  );
end;
$$;

create or replace function public.approve_payment_request(request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$ begin perform private.approve_payment_request(request_id); end; $$;

create or replace function public.reject_payment_request(request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$ begin perform private.reject_payment_request(request_id); end; $$;

create or replace function public.archive_record(target_table text, target_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$ begin perform private.archive_record(target_table, target_id); end; $$;

create or replace function public.invite_member_by_email(
  org_id uuid,
  invite_email text,
  invite_role text,
  invite_permissions text[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.invite_member_by_email(org_id, invite_email, invite_role, invite_permissions); $$;

create or replace function public.vision_send_telegram_target(
  p_organization_id uuid,
  p_target_id uuid
)
returns bigint
language sql
security invoker
set search_path = ''
as $$ select private.vision_send_telegram_target(p_organization_id, p_target_id); $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.can_admin_org(uuid) from public, anon;
revoke all on function public.can_manage_org(uuid) from public, anon;
revoke all on function public.can_manage_section(uuid, text) from public, anon;
revoke all on function public.has_permission(uuid, text) from public, anon;
revoke all on function public.has_section_access(uuid, text) from public, anon;
revoke all on function public.approve_payment_request(uuid) from public, anon;
revoke all on function public.reject_payment_request(uuid) from public, anon;
revoke all on function public.archive_record(text, uuid) from public, anon;
revoke all on function public.invite_member_by_email(uuid, text, text, text[]) from public, anon;
revoke all on function public.vision_send_telegram_target(uuid, uuid) from public, anon;

grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.can_admin_org(uuid) to authenticated, service_role;
grant execute on function public.can_manage_org(uuid) to authenticated, service_role;
grant execute on function public.can_manage_section(uuid, text) to authenticated, service_role;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.has_section_access(uuid, text) to authenticated, service_role;
grant execute on function public.approve_payment_request(uuid) to authenticated, service_role;
grant execute on function public.reject_payment_request(uuid) to authenticated, service_role;
grant execute on function public.archive_record(text, uuid) to authenticated, service_role;
grant execute on function public.invite_member_by_email(uuid, text, text, text[]) to authenticated, service_role;
grant execute on function public.vision_send_telegram_target(uuid, uuid) to authenticated, service_role;

