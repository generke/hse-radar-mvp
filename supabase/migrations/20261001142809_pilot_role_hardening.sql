-- Align database authorization with the product role matrix used by the UI.
-- Organization owners are the only tenant administrators. HSE specialists can
-- manage operational records, while HR remains scoped to employee workflows.

create or replace function public.can_manage_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select (select auth.uid()) is not null and (
    public.is_platform_admin()
    or exists(
      select 1
      from public.memberships m
      where m.organization_id=org_id
        and m.user_id=(select auth.uid())
        and m.is_active=true
        and m.role in ('owner','hse')
    )
  );
$$;

create or replace function public.has_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select (select auth.uid()) is not null and (
    public.is_platform_admin()
    or exists (
      select 1 from public.memberships m
      where m.organization_id=org_id
        and m.user_id=(select auth.uid())
        and m.is_active=true
        and (
          m.role='owner'
          or permission_key='employees.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='employees.manage' and m.role in ('hse','hr')
          or permission_key='employees.import' and m.role in ('hse','hr')
          or permission_key='requirements.assign' and m.role='hse'
          or permission_key='requirements.complete' and m.role in ('hse','manager','member')
          or permission_key='requirements.verify' and m.role in ('hse','manager')
          or permission_key='tasks.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='tasks.manage' and m.role in ('hse','manager')
          or permission_key='documents.view' and m.role in ('hse','manager','hr','member','viewer')
          or permission_key='documents.manage' and m.role='hse'
          or permission_key='inventory.view' and m.role in ('hse','manager','viewer')
          or permission_key='inventory.manage' and m.role='hse'
        )
    )
  );
$$;

revoke all on function public.can_manage_org(uuid) from public,anon;
revoke all on function public.has_permission(uuid,text) from public,anon;
grant execute on function public.can_manage_org(uuid) to authenticated;
grant execute on function public.has_permission(uuid,text) to authenticated;

-- The audit journal is an administrator surface, not an operational HSE feed.
drop policy if exists "audit org read" on public.audit_events;
create policy "audit owner read" on public.audit_events
for select to authenticated
using (public.can_admin_org(organization_id));

-- Learning attempts follow the learning section assignment instead of the old
-- broad organization-management helper.
drop policy if exists "section read" on public.learning_attempts;
drop policy if exists "section insert" on public.learning_attempts;
drop policy if exists "tenant update" on public.learning_attempts;
drop policy if exists "tenant delete" on public.learning_attempts;
create policy "learning attempts read" on public.learning_attempts
for select to authenticated
using (public.has_section_access(organization_id,'learning'));
create policy "learning attempts insert" on public.learning_attempts
for insert to authenticated
with check (
  public.has_section_access(organization_id,'learning')
  and (taken_by=(select auth.uid()) or public.can_manage_section(organization_id,'learning'))
);
create policy "learning attempts update" on public.learning_attempts
for update to authenticated
using (public.can_manage_section(organization_id,'learning'))
with check (public.can_manage_section(organization_id,'learning'));
create policy "learning attempts delete" on public.learning_attempts
for delete to authenticated
using (public.can_manage_section(organization_id,'learning'));

-- Storage authorization mirrors document permissions. The UPDATE policy is
-- required for safe upserts/replacements in Supabase Storage.
drop policy if exists "org files read" on storage.objects;
drop policy if exists "org files insert" on storage.objects;
drop policy if exists "org files update" on storage.objects;
drop policy if exists "org files delete" on storage.objects;
create policy "org files read" on storage.objects
for select to authenticated
using (
  bucket_id='hse-documents'
  and public.has_permission(((storage.foldername(name))[1])::uuid,'documents.view')
);
create policy "org files insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='hse-documents'
  and public.has_permission(((storage.foldername(name))[1])::uuid,'documents.manage')
);
create policy "org files update" on storage.objects
for update to authenticated
using (
  bucket_id='hse-documents'
  and public.has_permission(((storage.foldername(name))[1])::uuid,'documents.manage')
)
with check (
  bucket_id='hse-documents'
  and public.has_permission(((storage.foldername(name))[1])::uuid,'documents.manage')
);
create policy "org files delete" on storage.objects
for delete to authenticated
using (
  bucket_id='hse-documents'
  and public.has_permission(((storage.foldername(name))[1])::uuid,'documents.manage')
);

-- Cover the foreign keys used by the operational centre and evidence chain.
create index if not exists employee_requirements_employee_idx
  on public.employee_requirements(employee_id);
create index if not exists employee_requirements_requirement_idx
  on public.employee_requirements(requirement_id);
create index if not exists learning_assignments_employee_idx
  on public.learning_assignments(employee_id);
create index if not exists learning_attempts_taken_by_idx
  on public.learning_attempts(taken_by);
create index if not exists evidence_organization_idx
  on public.evidence(organization_id);
create index if not exists vision_events_camera_idx
  on public.vision_events(camera_id);
create index if not exists vision_events_task_idx
  on public.vision_events(task_id) where task_id is not null;
