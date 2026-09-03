-- Unified HSE platform: Free plan, deadline delivery, Learning and Safety Vision.

-- Rename the customer-facing trial plan without breaking existing installations.
alter table public.organizations alter column plan set default 'free';
alter table public.organizations drop constraint if exists organizations_plan_check;
update public.organizations set plan='free' where plan='trial';
update public.organizations set subscription_status='free' where subscription_status='trialing';
alter table public.organizations add constraint organizations_plan_check check (plan in ('free','pro','enterprise'));

alter table public.ppe_issues add column if not exists department text;
update public.ppe_issues p
set department=e.department
from public.employees e
where p.organization_id=e.organization_id
  and p.employee_name=e.full_name
  and nullif(p.department,'') is null;

alter table public.tasks
  add column if not exists reminder_sent_at timestamptz;

create table if not exists public.learning_courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  course_type text not null default 'instruction' check (course_type in ('instruction','knowledge_check')),
  description text,
  passing_score integer not null default 80 check (passing_score between 1 and 100),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  question text not null,
  options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)>=2),
  correct_option integer not null check (correct_option>=0),
  created_at timestamptz not null default now()
);

create table if not exists public.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  taken_by uuid not null default auth.uid() references auth.users(id),
  score integer not null check (score between 0 and 100),
  passed boolean not null,
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now()
);

create table if not exists public.learning_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  due_date date not null,
  status text not null default 'assigned' check (status in ('assigned','in_progress','passed','failed')),
  assigned_by uuid default auth.uid() references auth.users(id),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(course_id,employee_id)
);

create table if not exists public.vision_cameras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  location text not null,
  stream_url text,
  status text not null default 'offline' check (status in ('online','offline','maintenance')),
  zone_points jsonb not null default '[]'::jsonb check (jsonb_typeof(zone_points)='array'),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vision_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  camera_id uuid references public.vision_cameras(id) on delete set null,
  event_type text not null check (event_type in ('no_helmet','no_vest','danger_zone','blocked_exit','manual')),
  confidence numeric(5,2),
  status text not null default 'new' check (status in ('new','confirmed','dismissed','resolved')),
  task_id uuid references public.tasks(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  notification_date date not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'sent' check (status in ('sent','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique(organization_id,recipient_user_id,notification_date)
);

create index if not exists learning_courses_org_idx on public.learning_courses(organization_id,is_active);
create index if not exists learning_assignments_due_idx on public.learning_assignments(organization_id,due_date,status);
create index if not exists vision_cameras_org_idx on public.vision_cameras(organization_id,status);
create index if not exists vision_events_org_idx on public.vision_events(organization_id,occurred_at desc);
create index if not exists notification_deliveries_date_idx on public.notification_deliveries(notification_date,status);

do $$ declare t text; begin
  foreach t in array array['learning_courses','learning_questions','learning_attempts','learning_assignments','vision_cameras','vision_events','notification_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists "tenant read" on public.%I',t);
    execute format('create policy "tenant read" on public.%I for select using (public.is_org_member(organization_id) or public.is_platform_admin())',t);
  end loop;
end $$;

drop policy if exists "tenant insert" on public.learning_attempts;
create policy "tenant insert" on public.learning_attempts for insert with check (
  (public.is_org_member(organization_id) and taken_by=auth.uid()) or public.is_platform_admin()
);

do $$ declare t text; begin
  foreach t in array array['learning_courses','learning_questions','learning_attempts','learning_assignments','vision_cameras','vision_events'] loop
    execute format('drop policy if exists "tenant insert" on public.%I',t);
    execute format('create policy "tenant insert" on public.%I for insert with check (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
    execute format('drop policy if exists "tenant update" on public.%I',t);
    execute format('create policy "tenant update" on public.%I for update using (public.can_manage_org(organization_id) or public.is_platform_admin()) with check (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
    execute format('drop policy if exists "tenant delete" on public.%I',t);
    execute format('create policy "tenant delete" on public.%I for delete using (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
  end loop;
end $$;

-- Notification delivery history is written only with the service role.
revoke insert,update,delete on public.notification_deliveries from anon,authenticated;

drop trigger if exists learning_courses_updated_at on public.learning_courses;
create trigger learning_courses_updated_at before update on public.learning_courses for each row execute function public.set_updated_at();
drop trigger if exists vision_cameras_updated_at on public.vision_cameras;
create trigger vision_cameras_updated_at before update on public.vision_cameras for each row execute function public.set_updated_at();

-- Free limits are still enforced by the database, not only by the UI.
create or replace function public.enforce_trial_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare current_plan text; current_count integer;
begin
  select plan into current_plan from public.organizations where id=new.organization_id;
  if current_plan in ('free','trial') and not public.is_platform_admin() then
    execute format('select count(*) from public.%I where organization_id=$1 and archived_at is null',tg_table_name)
      into current_count using new.organization_id;
    if current_count>=5 then raise exception 'FREE_LIMIT_REACHED: максимум 5 активных записей в бесплатном режиме'; end if;
  end if;
  return new;
end;
$$;

-- Capture module activity in the common audit trail.
do $$ declare t text; begin
  foreach t in array array['learning_courses','learning_questions','learning_assignments','vision_cameras','vision_events'] loop
    execute format('drop trigger if exists audit_row_change on public.%I',t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.record_audit_event()',t);
  end loop;
end $$;
