-- Keep mutation rights aligned with the product role matrix. Merely assigning
-- a section grants visibility; it must not silently grant every role writes.
create or replace function public.can_manage_section(org_id uuid, section_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select (select auth.uid()) is not null and (
    public.is_platform_admin()
    or exists(
      select 1 from public.memberships m
      where m.organization_id=org_id
        and m.user_id=(select auth.uid())
        and m.is_active=true
        and (
          m.role='owner'
          or section_key=any(m.section_permissions) and (
            m.role='hse'
            or m.role='manager' and section_key in ('tasks','learning','vision')
            or m.role='hr' and section_key='employees'
          )
        )
    )
  );
$$;

revoke all on function public.can_manage_section(uuid,text) from public,anon;
grant execute on function public.can_manage_section(uuid,text) to authenticated;
