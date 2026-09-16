-- Reduce exposed SECURITY DEFINER surface and pin function search paths.

alter function public.set_updated_at() set search_path=public;
alter function public.prevent_audit_mutation() set search_path=public;

revoke all on function public.approve_payment_request(uuid) from public,anon,authenticated;
revoke all on function public.reject_payment_request(uuid) from public,anon,authenticated;
revoke all on function public.archive_record(text,uuid) from public,anon,authenticated;
revoke all on function public.can_admin_org(uuid) from public,anon,authenticated;
revoke all on function public.can_manage_org(uuid) from public,anon,authenticated;
revoke all on function public.can_manage_section(uuid,text) from public,anon,authenticated;
revoke all on function public.has_section_access(uuid,text) from public,anon,authenticated;
revoke all on function public.has_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.invite_member_by_email(uuid,text,text,text[]) from public,anon,authenticated;
revoke all on function public.is_org_member(uuid) from public,anon,authenticated;
revoke all on function public.is_platform_admin() from public,anon,authenticated;
revoke all on function public.enforce_trial_limit() from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.record_audit_event() from public,anon,authenticated;
revoke all on function public.vision_notify_event() from public,anon,authenticated;
revoke all on function public.vision_process_telegram_pairing(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.vision_send_telegram(text,text) from public,anon,authenticated;
revoke all on function public.vision_send_telegram_target(uuid,uuid) from public,anon,authenticated;

-- Authenticated RPCs and RLS helpers. Every function performs its own auth/organization check.
grant execute on function public.approve_payment_request(uuid) to authenticated;
grant execute on function public.reject_payment_request(uuid) to authenticated;
grant execute on function public.archive_record(text,uuid) to authenticated;
grant execute on function public.can_admin_org(uuid) to authenticated;
grant execute on function public.can_manage_org(uuid) to authenticated;
grant execute on function public.can_manage_section(uuid,text) to authenticated;
grant execute on function public.has_section_access(uuid,text) to authenticated;
grant execute on function public.has_permission(uuid,text) to authenticated;
grant execute on function public.invite_member_by_email(uuid,text,text,text[]) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.vision_send_telegram_target(uuid,uuid) to authenticated;

-- Telegram webhook uses a publishable key and validates a server-held webhook secret inside the function.
grant execute on function public.vision_process_telegram_pairing(text,text,text,text,text) to anon,authenticated;
