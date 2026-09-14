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
end $$;

-- Authenticated behavioral test matrix (run through Supabase client/JWT):
-- A owner: all A rows allowed; all B rows denied.
-- A HSE: A employee write/requirements/verification allowed; all B denied.
-- A HR: A employee view/write/import allowed; inventory write and verification denied.
-- A manager: A employee view/task manage/verification allowed; employee write denied.
-- A viewer: read-only permitted capabilities; every write denied.
-- Direct REST request with organization_id=B under an A JWT must return zero rows/403.

rollback;
