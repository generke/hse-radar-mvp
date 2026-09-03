-- Complete the operational workflows for Learning and Safety Vision.

alter table public.learning_assignments
  add column if not exists score integer check (score between 0 and 100),
  add column if not exists completed_at timestamptz;

alter table public.vision_events
  add column if not exists notes text,
  add column if not exists resolved_at timestamptz;

-- Any organization member may complete a knowledge check. Course and question
-- administration remains restricted by the existing manager policies.
drop policy if exists "tenant insert" on public.learning_attempts;
create policy "tenant insert" on public.learning_attempts
for insert with check (
  (public.is_org_member(organization_id) and taken_by=auth.uid())
  or public.is_platform_admin()
);

create index if not exists learning_attempts_course_idx
  on public.learning_attempts(organization_id,course_id,completed_at desc);
create index if not exists vision_events_status_idx
  on public.vision_events(organization_id,status,occurred_at desc);
