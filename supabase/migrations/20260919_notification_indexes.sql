-- Cover notification lookups used on registration and task assignment.
create index if not exists registration_notification_events_organization_idx
  on public.registration_notification_events(organization_id);

create index if not exists vision_notification_targets_recipient_idx
  on public.vision_notification_targets(recipient_user_id)
  where enabled=true;
