-- HSE Radar billing/admin migration.
-- Kaspi Pay is intentionally verified by a platform admin because Kaspi Pay
-- payment links do not expose a public SaaS payment-confirmation webhook.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submitted_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null default 'kaspi_pay' check (provider in ('kaspi_pay')),
  payment_reference text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create index if not exists payment_requests_org_idx on public.payment_requests(organization_id, created_at desc);
create index if not exists payment_requests_status_idx on public.payment_requests(status, created_at desc);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid());
$$;

alter table public.platform_admins enable row level security;
alter table public.payment_requests enable row level security;

drop policy if exists "platform admin self read" on public.platform_admins;
create policy "platform admin self read" on public.platform_admins
for select using (user_id=auth.uid());

drop policy if exists "payment org read" on public.payment_requests;
create policy "payment org read" on public.payment_requests
for select using (public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists "payment org submit" on public.payment_requests;
create policy "payment org submit" on public.payment_requests
for insert with check (
  public.is_org_member(organization_id)
  and submitted_by=auth.uid()
  and status='pending'
);

drop policy if exists "payment admin update" on public.payment_requests;
create policy "payment admin update" on public.payment_requests
for update using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "org read" on public.organizations;
create policy "org read" on public.organizations
for select using (public.is_org_member(id) or public.is_platform_admin());

drop policy if exists "profile admin read" on public.profiles;
create policy "profile admin read" on public.profiles
for select using (public.is_platform_admin());

drop policy if exists "membership read" on public.memberships;
create policy "membership read" on public.memberships
for select using (
  user_id=auth.uid()
  or public.is_org_member(organization_id)
  or public.is_platform_admin()
);

do $$ declare t text; begin
  foreach t in array array['employees','inventory','ppe_issues','documents'] loop
    execute format('drop policy if exists "tenant read" on public.%I',t);
    execute format('create policy "tenant read" on public.%I for select using (public.is_org_member(organization_id) or public.is_platform_admin())',t);
    execute format('drop policy if exists "tenant insert" on public.%I',t);
    execute format('create policy "tenant insert" on public.%I for insert with check (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
    execute format('drop policy if exists "tenant update" on public.%I',t);
    execute format('create policy "tenant update" on public.%I for update using (public.can_manage_org(organization_id) or public.is_platform_admin()) with check (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
    execute format('drop policy if exists "tenant delete" on public.%I',t);
    execute format('create policy "tenant delete" on public.%I for delete using (public.can_manage_org(organization_id) or public.is_platform_admin())',t);
  end loop;
end $$;

create or replace function public.enforce_trial_limit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  current_plan text;
  current_count integer;
begin
  select plan into current_plan from public.organizations where id=new.organization_id;
  if current_plan='trial' and not public.is_platform_admin() then
    execute format('select count(*) from public.%I where organization_id=$1', tg_table_name)
      into current_count using new.organization_id;
    if current_count >= 5 then
      raise exception 'TRIAL_LIMIT_REACHED: максимум 5 записей в пробном режиме';
    end if;
  end if;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['employees','inventory','ppe_issues','documents'] loop
    execute format('drop trigger if exists enforce_trial_limit_before_insert on public.%I',t);
    execute format('create trigger enforce_trial_limit_before_insert before insert on public.%I for each row execute function public.enforce_trial_limit()',t);
  end loop;
end $$;

create or replace function public.approve_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare target_org uuid;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select organization_id into target_org
  from public.payment_requests
  where id=request_id and status='pending'
  for update;
  if target_org is null then raise exception 'PAYMENT_REQUEST_NOT_PENDING'; end if;
  update public.organizations
    set plan='pro', subscription_status='active'
    where id=target_org;
  update public.payment_requests
    set status='approved', reviewed_at=now(), reviewed_by=auth.uid()
    where id=request_id;
end;
$$;

create or replace function public.reject_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  update public.payment_requests
    set status='rejected', reviewed_at=now(), reviewed_by=auth.uid()
    where id=request_id and status='pending';
end;
$$;

revoke all on function public.approve_payment_request(uuid) from public;
revoke all on function public.reject_payment_request(uuid) from public;
grant execute on function public.approve_payment_request(uuid) to authenticated;
grant execute on function public.reject_payment_request(uuid) to authenticated;
