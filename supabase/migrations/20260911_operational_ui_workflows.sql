-- Unified TMC, employee learning records, document review dates and in-app alerts.

alter table public.inventory add column if not exists quantity integer not null default 1 check(quantity > 0);
alter table public.employees add column if not exists training_records jsonb not null default '{}'::jsonb;
alter table public.documents
  add column if not exists review_date date,
  add column if not exists is_perpetual boolean not null default false;

alter table public.learning_courses drop constraint if exists learning_courses_training_type_check;
alter table public.learning_courses add constraint learning_courses_training_type_check check(training_type in (
  'intro','workplace','primary_workplace','repeat','unscheduled','targeted',
  'electrical','ptm','first_aid','industrial_safety','hse_exam','other'
));

-- Replace the legacy inventory/PPE menu permissions with one TMC permission.
update public.memberships m set section_permissions=(
  select array_agg(distinct value order by value)
  from unnest(array_replace(array_replace(m.section_permissions,'inventory','tmc'),'ppe','tmc')) value
);

do $$ declare pair text[]; begin
  foreach pair slice 1 in array array[['inventory','tmc'],['ppe_issues','tmc']] loop
    execute format('drop policy if exists "section read" on public.%I',pair[1]);
    execute format('create policy "section read" on public.%I for select using (public.has_section_access(organization_id,%L))',pair[1],pair[2]);
    execute format('drop policy if exists "section insert" on public.%I',pair[1]);
    execute format('create policy "section insert" on public.%I for insert with check (public.can_manage_section(organization_id,%L))',pair[1],pair[2]);
    execute format('drop policy if exists "section update" on public.%I',pair[1]);
    execute format('create policy "section update" on public.%I for update using (public.can_manage_section(organization_id,%L)) with check (public.can_manage_section(organization_id,%L))',pair[1],pair[2],pair[2]);
    execute format('drop policy if exists "section delete" on public.%I',pair[1]);
    execute format('create policy "section delete" on public.%I for delete using (public.can_manage_section(organization_id,%L))',pair[1],pair[2]);
  end loop;
end $$;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_date date not null,
  source_key text not null,
  title text not null,
  body text not null,
  severity text not null default 'critical' check(severity in ('info','warning','critical')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,user_id,notification_date,source_key)
);
create index if not exists user_notifications_user_idx on public.user_notifications(user_id,created_at desc);
alter table public.user_notifications enable row level security;
drop policy if exists "notification own read" on public.user_notifications;
create policy "notification own read" on public.user_notifications for select using(user_id=auth.uid());
drop policy if exists "notification own update" on public.user_notifications;
create policy "notification own update" on public.user_notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid());
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;

-- Free allowance is five TMC records in total, not five in each legacy table.
create or replace function public.enforce_trial_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare current_plan text; current_count integer;
begin
  select plan into current_plan from public.organizations where id=new.organization_id;
  if current_plan in ('free','trial') and not public.is_platform_admin() then
    if tg_table_name in ('inventory','ppe_issues') then
      select
        (select count(*) from public.inventory where organization_id=new.organization_id and archived_at is null)+
        (select count(*) from public.ppe_issues where organization_id=new.organization_id and archived_at is null)
      into current_count;
    else
      execute format('select count(*) from public.%I where organization_id=$1 and archived_at is null',tg_table_name)
        into current_count using new.organization_id;
    end if;
    if current_count>=5 then raise exception 'FREE_LIMIT_REACHED: максимум 5 активных записей в бесплатном режиме'; end if;
  end if;
  return new;
end;
$$;
