-- Reliable audit hashing and organization-safe bulk archive operations.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_row jsonb;
  new_row jsonb;
  org_id uuid;
  row_id uuid;
  event_action text;
  headers jsonb;
begin
  old_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  new_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  org_id:=coalesce((new_row->>'organization_id')::uuid,(old_row->>'organization_id')::uuid);
  if tg_table_name='organizations' then
    org_id:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
  end if;
  row_id:=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
  headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  event_action:=case
    when tg_op='INSERT' then 'created'
    when tg_op='DELETE' then 'deleted'
    when old_row->>'archived_at' is null and new_row->>'archived_at' is not null then 'archived'
    when old_row->>'archived_at' is not null and new_row->>'archived_at' is null then 'restored'
    else 'updated'
  end;
  if org_id is not null then
    insert into public.audit_events(
      organization_id,actor_id,action,entity_type,entity_id,before_data,after_data,
      request_id,ip_hash,user_agent,context
    ) values(
      org_id,(select auth.uid()),event_action,tg_table_name,row_id,old_row,new_row,gen_random_uuid(),
      encode(extensions.digest(coalesce(headers->>'x-forwarded-for','unknown')::text,'sha256'::text),'hex'),
      left(coalesce(headers->>'user-agent','unknown'),512),
      jsonb_build_object('database_role',current_user,'provider_request_id',headers->>'x-request-id')
    );
  end if;
  return coalesce(new,old);
end;
$$;

create or replace function public.archive_records(target_table text,target_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare
  target_id uuid;
  archived_count integer:=0;
begin
  if target_ids is null or cardinality(target_ids)=0 then return 0; end if;
  if cardinality(target_ids)>500 then raise exception 'BULK_LIMIT_EXCEEDED'; end if;
  foreach target_id in array target_ids loop
    perform public.archive_record(target_table,target_id);
    archived_count:=archived_count+1;
  end loop;
  return archived_count;
end;
$$;

revoke all on function public.archive_records(text,uuid[]) from public,anon;
grant execute on function public.archive_records(text,uuid[]) to authenticated;
