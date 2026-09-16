-- Keep the login/bootstrap lookup index-backed as the number of users grows.
create index if not exists memberships_user_active_created_idx
  on public.memberships(user_id, created_at)
  where is_active = true;
