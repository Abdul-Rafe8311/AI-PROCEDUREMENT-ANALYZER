-- Story 4.4: email attempt log (AD-10, AD-11). Additive and idempotent.
-- No user policy: only the service-role client reads or writes it.

create table if not exists public.email_log (
  id         uuid primary key default gen_random_uuid(),
  template   text not null check (template in ('payment_submitted_admin', 'payment_approved', 'payment_rejected', 'expiry_reminder')),
  to_email   text not null,
  subject_id text,
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error      text,
  created_at timestamptz not null default now()
);

-- A reminder is claimed once per period (subject_id = plan_periods.id); other templates may repeat.
create unique index if not exists email_log_reminder_once_idx
  on public.email_log (template, subject_id) where template = 'expiry_reminder';
create index if not exists email_log_created_idx on public.email_log (created_at desc);
create index if not exists email_log_subject_idx on public.email_log (subject_id);

alter table public.email_log enable row level security;

revoke all on public.email_log from anon, authenticated;
