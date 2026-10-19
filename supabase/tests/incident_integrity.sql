-- Transactional integration checks. No accounts, files or business rows persist.
-- Two existing auth IDs are only referenced; their accounts are not modified.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); incident uuid:=gen_random_uuid(); measure uuid:=gen_random_uuid();
  actor uuid; reviewer uuid; proof text; blocked boolean;
begin
  select id into actor from auth.users order by id limit 1;
  select id into reviewer from auth.users where id<>actor order by id limit 1;
  if actor is null or reviewer is null then raise exception 'Two fixture actors required'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.organizations(id,name,plan) values(org,'Incident integration fixture','pro');
  insert into public.memberships(organization_id,user_id,role)
    values(org,actor,'owner'),(org,reviewer,'owner');
  insert into public.safety_incidents(id,organization_id,title,category,severity,occurred_at,description)
    values(incident,org,'Integration event','near_miss','medium',now(),'Integration test description');
  blocked:=false;
  begin update public.safety_incidents set status='closed' where id=incident;
  exception when raise_exception then blocked:=sqlerrm='INCIDENT_CLOSURE_INCOMPLETE'; end;
  if not blocked then raise exception 'Premature closure was not blocked'; end if;
  blocked:=false;
  begin
    insert into public.tasks(organization_id,title,due_date,status)
      values(org,'Bypass attempt',current_date,'verified');
  exception when raise_exception then blocked:=sqlerrm='TASK_START_OPEN'; end;
  if not blocked then raise exception 'Verified task insert was not blocked'; end if;
  insert into public.tasks(id,organization_id,title,due_date,source_type,source_id)
    values(measure,org,'Integration corrective measure',current_date,'incident',incident);
  insert into public.evidence(organization_id,task_id,evidence_type,note)
    values(org,measure,'note','Fixture completion evidence');
  update public.tasks set status='done' where id=measure;
  blocked:=false;
  begin update public.tasks set status='verified' where id=measure;
  exception when raise_exception then blocked:=sqlerrm='SECOND_PERSON_REQUIRED'; end;
  if not blocked then raise exception 'Self verification was not blocked'; end if;
  perform set_config('request.jwt.claim.sub',reviewer::text,true);
  update public.tasks set status='verified' where id=measure;
  proof:=org::text||'/'||incident::text||'/fixture.pdf';
  update public.safety_incidents set root_cause='Fixture investigation root cause',evidence_path=proof where id=incident;
  blocked:=false;
  begin update public.safety_incidents set status='closed' where id=incident;
  exception when raise_exception then blocked:=sqlerrm='INCIDENT_CLOSURE_INCOMPLETE'; end;
  if not blocked then raise exception 'Nonexistent proof was accepted'; end if;
  -- Only metadata is seeded, inside this rollback-only transaction; no file is uploaded.
  insert into storage.objects(bucket_id,name) values('incident-evidence',proof);
  update public.safety_incidents set status='closed' where id=incident;
  blocked:=false;
  begin update public.safety_incidents set root_cause=null where id=incident;
  exception when raise_exception then blocked:=sqlerrm='REOPEN_INCIDENT_REQUIRED'; end;
  if not blocked then raise exception 'Closed investigation remained editable'; end if;
  blocked:=false;
  begin update public.tasks set source_type=null,source_id=null where id=measure;
  exception when raise_exception then blocked:=sqlerrm='REOPEN_INCIDENT_REQUIRED'; end;
  if not blocked then raise exception 'Closed measure could be detached'; end if;
  blocked:=false;
  begin
    insert into public.tasks(organization_id,title,due_date,source_type,source_id)
      values(org,'Late measure',current_date,'incident',incident);
  exception when raise_exception then blocked:=sqlerrm='REOPEN_INCIDENT_REQUIRED'; end;
  if not blocked then raise exception 'Closed incident accepted a new measure'; end if;
  update public.safety_incidents set status='investigating' where id=incident;
  update public.tasks set title='Reopened measure' where id=measure;
end $$;
rollback;
