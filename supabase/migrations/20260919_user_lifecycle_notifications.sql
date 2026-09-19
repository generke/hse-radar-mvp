-- Registration lifecycle and task assignment notifications.

create table if not exists public.registration_notification_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.registration_notification_events enable row level security;
revoke all on public.registration_notification_events from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  org_id uuid;
  display_name text;
  matched integer;
  admin_created boolean;
begin
  display_name:=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1));
  admin_created:=coalesce((new.raw_app_meta_data->>'created_by_admin')::boolean,false);

  insert into public.profiles(id,full_name,email)
  values(new.id,display_name,new.email)
  on conflict(id) do update
  set email=excluded.email,
      full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name);

  insert into public.memberships(organization_id,user_id,role,section_permissions,is_active)
  select organization_id,new.id,role,section_permissions,true
  from public.organization_invites
  where lower(email)=lower(new.email) and accepted_at is null and expires_at>now()
  on conflict(organization_id,user_id) do update
  set role=excluded.role,section_permissions=excluded.section_permissions,is_active=true;
  get diagnostics matched=row_count;

  update public.organization_invites set accepted_at=now()
  where lower(email)=lower(new.email) and accepted_at is null and expires_at>now();

  if matched>0 or new.invited_at is not null or admin_created then return new; end if;

  insert into public.organizations(name)
  values(display_name||' · HSE') returning id into org_id;
  insert into public.memberships(organization_id,user_id,role,is_active)
  values(org_id,new.id,'owner',true);
  insert into public.registration_notification_events(user_id,organization_id,email,full_name)
  values(new.id,org_id,new.email,display_name)
  on conflict(user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function public.notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  org_name text;
  target record;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op='UPDATE' and old.assignee_id is not distinct from new.assignee_id then return new; end if;

  select name into org_name from public.organizations where id=new.organization_id;
  insert into public.user_notifications(
    organization_id,user_id,notification_date,source_key,title,body,severity
  ) values (
    new.organization_id,
    new.assignee_id,
    timezone('Asia/Almaty',now())::date,
    'task-assigned:'||new.id::text,
    'Вам назначена задача',
    new.title||' · срок '||to_char(new.due_date,'DD.MM.YYYY'),
    case when new.priority in ('critical','high') then 'critical' else 'warning' end
  )
  on conflict(organization_id,user_id,notification_date,source_key)
  do update set title=excluded.title,body=excluded.body,severity=excluded.severity,read_at=null,created_at=now();

  -- Telegram is best-effort. A provider error must not undo the durable
  -- in-product notification inserted above or creation of the task itself.
  begin
    for target in
      select distinct chat_id from public.vision_notification_targets
      where recipient_user_id=new.assignee_id and enabled=true
    loop
      perform public.vision_send_telegram(
        target.chat_id,
        format('📌 HSE Radar\nВам назначена задача: %s\nОрганизация: %s\nСрок: %s',new.title,coalesce(org_name,'Организация'),to_char(new.due_date,'DD.MM.YYYY'))
      );
    end loop;
  exception when others then
    raise warning 'Telegram task notification failed for %: %',new.id,sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.notify_task_assignee() from public,anon,authenticated;
drop trigger if exists task_assignee_notification on public.tasks;
create trigger task_assignee_notification
after insert or update of assignee_id on public.tasks
for each row execute function public.notify_task_assignee();
