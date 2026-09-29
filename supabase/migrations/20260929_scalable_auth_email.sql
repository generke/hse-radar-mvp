-- Decouple signup/recovery throughput from Supabase's shared SMTP quota while
-- keeping abuse control local to each email address and source address.
create table if not exists public.auth_email_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  action text not null check (action in ('signup','recovery')),
  created_at timestamptz not null default now()
);

create index if not exists auth_email_attempts_email_created_idx on public.auth_email_attempts(email_hash,created_at desc);
create index if not exists auth_email_attempts_ip_created_idx on public.auth_email_attempts(ip_hash,created_at desc);
create index if not exists auth_email_attempts_created_idx on public.auth_email_attempts(created_at);
alter table public.auth_email_attempts enable row level security;
revoke all on public.auth_email_attempts from public,anon,authenticated;

create or replace function public.check_auth_email_rate_limit(p_email_hash text,p_ip_hash text,p_action text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  email_attempts integer;
  ip_attempts integer;
begin
  if p_action not in ('signup','recovery') or length(p_email_hash)<>64 or length(p_ip_hash)<>64 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash,0));
  if random()<0.02 then delete from public.auth_email_attempts where created_at<now()-interval '24 hours'; end if;
  select count(*) into email_attempts from public.auth_email_attempts where email_hash=p_email_hash and created_at>now()-interval '10 minutes';
  select count(*) into ip_attempts from public.auth_email_attempts where ip_hash=p_ip_hash and created_at>now()-interval '10 minutes';
  if email_attempts>=5 or ip_attempts>=30 then return false; end if;
  insert into public.auth_email_attempts(email_hash,ip_hash,action) values(p_email_hash,p_ip_hash,p_action);
  return true;
end;
$$;

revoke all on function public.check_auth_email_rate_limit(text,text,text) from public,anon,authenticated;
grant execute on function public.check_auth_email_rate_limit(text,text,text) to service_role;
