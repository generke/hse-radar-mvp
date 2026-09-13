-- Multi-tenant Safety Vision Cloud: one Telegram bot, per-company recipients and edge agents.
create table if not exists public.vision_notification_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.vision_notification_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  chat_id text not null,
  enabled boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,chat_id)
);

alter table public.vision_notification_targets add column if not exists recipient_user_id uuid references auth.users(id) on delete set null;
alter table public.vision_notification_targets add column if not exists telegram_user_id text;

create table if not exists public.vision_telegram_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Intentionally has no client policies. Only server-side service-role code can read bot secrets.
create table if not exists public.vision_platform_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.vision_edge_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  site_name text not null,
  token_hash text not null unique,
  status text not null default 'offline' check(status in ('online','offline','maintenance')),
  version text,
  last_seen_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vision_notification_targets_org_idx on public.vision_notification_targets(organization_id,enabled);
create index if not exists vision_edge_agents_org_idx on public.vision_edge_agents(organization_id,status);
create index if not exists vision_telegram_pairings_lookup_idx on public.vision_telegram_pairings(code_hash,expires_at) where used_at is null;

alter table public.vision_notification_settings enable row level security;
alter table public.vision_notification_targets enable row level security;
alter table public.vision_edge_agents enable row level security;
alter table public.vision_telegram_pairings enable row level security;
alter table public.vision_platform_secrets enable row level security;

drop policy if exists "own pairing read" on public.vision_telegram_pairings;
create policy "own pairing read" on public.vision_telegram_pairings for select using (user_id=auth.uid());
drop policy if exists "own pairing insert" on public.vision_telegram_pairings;
create policy "own pairing insert" on public.vision_telegram_pairings for insert with check (user_id=auth.uid() and public.has_section_access(organization_id,'vision'));

create extension if not exists pg_net with schema extensions;

create or replace function public.vision_send_telegram(p_chat_id text,p_text text)
returns bigint language plpgsql security definer set search_path='' as $$
declare bot_token text; request_id bigint;
begin
  select value into bot_token from public.vision_platform_secrets where key='bot_token';
  if bot_token is null then raise exception 'Telegram bot is not configured'; end if;
  select net.http_post(
    url:=format('https://api.telegram.org/bot%s/sendMessage',bot_token),
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=jsonb_build_object('chat_id',p_chat_id,'text',p_text,'disable_web_page_preview',true)
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.vision_send_telegram(text,text) from public,anon,authenticated;

create or replace function public.vision_process_telegram_pairing(p_webhook_secret text,p_code_hash text,p_chat_id text,p_telegram_user_id text,p_label text)
returns text language plpgsql security definer set search_path='' as $$
declare expected_secret text; pairing public.vision_telegram_pairings%rowtype;
begin
  select value into expected_secret from public.vision_platform_secrets where key='webhook_secret';
  if expected_secret is null or expected_secret<>p_webhook_secret then return 'unauthorized'; end if;
  select * into pairing from public.vision_telegram_pairings where code_hash=p_code_hash for update;
  if not found or pairing.used_at is not null or pairing.expires_at<now() then
    perform public.vision_send_telegram(p_chat_id,'Ссылка HSE Radar недействительна. Создайте новую ссылку в разделе Safety Vision.');
    return 'invalid';
  end if;
  insert into public.vision_notification_targets(organization_id,recipient_user_id,telegram_user_id,label,chat_id,enabled)
  values(pairing.organization_id,pairing.user_id,p_telegram_user_id,coalesce(nullif(p_label,''),'Telegram-пользователь'),p_chat_id,true)
  on conflict(organization_id,chat_id) do update set recipient_user_id=excluded.recipient_user_id,telegram_user_id=excluded.telegram_user_id,label=excluded.label,enabled=true;
  update public.vision_telegram_pairings set used_at=now() where id=pairing.id;
  perform public.vision_send_telegram(p_chat_id,'✅ Telegram подключён к вашей организации в HSE Radar. Теперь сюда будут приходить события Safety Vision только этой организации.');
  return 'linked';
end $$;
revoke all on function public.vision_process_telegram_pairing(text,text,text,text,text) from public;
grant execute on function public.vision_process_telegram_pairing(text,text,text,text,text) to anon,authenticated;

create or replace function public.vision_send_telegram_target(p_organization_id uuid,p_target_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare target public.vision_notification_targets%rowtype;
begin
  if not public.has_section_access(p_organization_id,'vision') then raise exception 'Access denied'; end if;
  select * into target from public.vision_notification_targets where id=p_target_id and organization_id=p_organization_id and enabled=true;
  if not found then raise exception 'Target not found'; end if;
  return public.vision_send_telegram(target.chat_id,format('✅ HSE Radar · Safety Vision\nТестовые уведомления для «%s» работают.',target.label));
end $$;
revoke all on function public.vision_send_telegram_target(uuid,uuid) from public;
grant execute on function public.vision_send_telegram_target(uuid,uuid) to authenticated;

create or replace function public.vision_notify_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare target record; camera record; event_label text;
begin
  if exists(select 1 from public.vision_notification_settings where organization_id=new.organization_id and enabled=false) then return new; end if;
  select name,location into camera from public.vision_cameras where id=new.camera_id;
  event_label:=case new.event_type when 'danger_zone' then 'Движение внутри опасной зоны' when 'no_helmet' then 'Работник без каски' when 'no_vest' then 'Работник без сигнального жилета' when 'blocked_exit' then 'Заблокирован аварийный выход' else 'Событие видеоконтроля' end;
  for target in select chat_id from public.vision_notification_targets where organization_id=new.organization_id and enabled=true loop
    perform public.vision_send_telegram(target.chat_id,format('🚨 HSE Radar\n%s\nКамера: %s\nОбъект: %s\nВремя: %s',event_label,coalesce(camera.name,'Камера'),coalesce(camera.location,'Не указан'),to_char(timezone('Asia/Almaty',coalesce(new.occurred_at,now())),'DD.MM.YYYY HH24:MI:SS')));
  end loop;
  return new;
end $$;

drop trigger if exists vision_events_telegram on public.vision_events;
create trigger vision_events_telegram after insert on public.vision_events for each row execute function public.vision_notify_event();

do $$ declare t text; begin
  foreach t in array array['vision_notification_settings','vision_notification_targets','vision_edge_agents'] loop
    execute format('drop policy if exists "section read" on public.%I',t);
    execute format('create policy "section read" on public.%I for select using (public.has_section_access(organization_id,''vision''))',t);
    execute format('drop policy if exists "section insert" on public.%I',t);
    execute format('create policy "section insert" on public.%I for insert with check (public.can_manage_section(organization_id,''vision''))',t);
    execute format('drop policy if exists "section update" on public.%I',t);
    execute format('create policy "section update" on public.%I for update using (public.can_manage_section(organization_id,''vision'')) with check (public.can_manage_section(organization_id,''vision''))',t);
    execute format('drop policy if exists "section delete" on public.%I',t);
    execute format('create policy "section delete" on public.%I for delete using (public.can_manage_section(organization_id,''vision''))',t);
  end loop;
end $$;

drop trigger if exists vision_edge_agents_updated_at on public.vision_edge_agents;
create trigger vision_edge_agents_updated_at before update on public.vision_edge_agents for each row execute function public.set_updated_at();
