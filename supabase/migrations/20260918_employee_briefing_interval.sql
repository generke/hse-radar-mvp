-- The interval belongs to each employee because recurrence can differ by role and employer policy.
set local lock_timeout = '5s';

alter table public.employees
  add column if not exists briefing_interval_months integer not null default 6
  check (briefing_interval_months between 1 and 60);

comment on column public.employees.briefing_interval_months is
  'Number of months between workplace briefings; used to calculate the next deadline after completion.';
