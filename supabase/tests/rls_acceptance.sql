-- Execute in an isolated test project, inside a transaction.
-- Replace UUIDs with fixture auth.users IDs. Never run with production user IDs.
begin;

-- Required assertions are deliberately expressed as checks so a false result aborts.
do $$
declare org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid();
begin
  insert into public.organizations(id,name) values(org_a,'RLS fixture A'),(org_b,'RLS fixture B');
  if not (select relrowsecurity from pg_class where oid='public.employees'::regclass) then raise exception 'employees RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid='public.employee_requirements'::regclass) then raise exception 'employee_requirements RLS disabled'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('employees','inventory','ppe_issues','documents') and policyname like 'tenant %') then
    raise exception 'legacy tenant policy remains';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.audit_events'::regclass and tgname='audit_events_immutable' and not tgisinternal) then
    raise exception 'immutable audit trigger missing';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='audit_events'
      and policyname='audit owner read' and roles='{authenticated}'
  ) then raise exception 'owner-only audit policy missing'; end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='org files update' and roles='{authenticated}'
  ) then raise exception 'document upsert policy missing'; end if;
  if position('''hr''' in pg_get_functiondef('public.can_manage_org(uuid)'::regprocedure))>0 then
    raise exception 'HR must not have broad organization management';
  end if;
  if position('audit.view' in pg_get_functiondef('public.has_permission(uuid,text)'::regprocedure))>0 then
    raise exception 'audit access must remain owner/platform-admin only';
  end if;
  if position('role in (''hse'',''manager'',''hr'')' in pg_get_functiondef('public.can_manage_section(uuid,text)'::regprocedure))>0 then
    raise exception 'section management must not grant HR broad write access';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_transition_guard' and not tgisinternal) then
    raise exception 'task transition guard missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='completed_by')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='verified_by') then
    raise exception 'task closure actors missing';
  end if;
  if position('EVIDENCE_REQUIRED' in pg_get_functiondef('public.guard_task_transition()'::regprocedure))=0
     or position('SECOND_PERSON_REQUIRED' in pg_get_functiondef('public.guard_task_transition()'::regprocedure))=0 then
    raise exception 'task closure controls missing';
  end if;
end $$;

-- Authenticated behavioral test matrix (run through Supabase client/JWT):
-- A owner: all A rows allowed; all B rows denied.
-- A HSE: A employee write/requirements/verification allowed; all B denied.
-- A HR: A employee view/write/import allowed; inventory write and verification denied.
-- A manager: A employee view/task manage/verification allowed; employee write denied.
-- A viewer: read-only permitted capabilities; every write denied.
-- Direct REST request with organization_id=B under an A JWT must return zero rows/403.

rollback;
