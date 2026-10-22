-- Acceptance checks for migration 20261022035413_harden_security_definer_rpc.
-- Run against a disposable or staging database after applying migrations.

do $$
declare
  exposed_count integer;
  anon_count integer;
begin
  select count(*) into exposed_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname in (
      'approve_payment_request',
      'archive_record',
      'can_admin_org',
      'can_manage_org',
      'can_manage_section',
      'has_permission',
      'has_section_access',
      'invite_member_by_email',
      'is_org_member',
      'is_platform_admin',
      'reject_payment_request',
      'vision_send_telegram_target'
    );

  if exposed_count <> 0 then
    raise exception 'Public SECURITY DEFINER functions remain exposed: %', exposed_count;
  end if;

  select count(*) into anon_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname in (
      'approve_payment_request',
      'archive_record',
      'can_admin_org',
      'can_manage_org',
      'can_manage_section',
      'has_permission',
      'has_section_access',
      'invite_member_by_email',
      'is_org_member',
      'is_platform_admin',
      'reject_payment_request',
      'vision_send_telegram_target'
    )
    and has_function_privilege('anon', p.oid, 'execute');

  if anon_count <> 0 then
    raise exception 'Anonymous EXECUTE privileges remain: %', anon_count;
  end if;

  if public.is_platform_admin() then
    raise exception 'Unauthenticated execution must never report platform admin';
  end if;
end;
$$;
