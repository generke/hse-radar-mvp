-- Telegram updates arrive through a server-side webhook. The pairing RPC must
-- never be callable from the public Data API with a user-controlled payload.

revoke all on function public.vision_process_telegram_pairing(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.vision_process_telegram_pairing(text,text,text,text,text) to service_role;
