-- Story 1.2: append-only plan ledger and audit log (AD-3, AD-12).
-- Idempotent: safe to re-run. No writers here; all writes go through the
-- service-role client (which bypasses RLS). No insert/update/delete policy exists.

create extension if not exists btree_gist;

create table if not exists public.plan_periods (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  plan               text not null check (plan in ('plus', 'pro', 'max')),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  source             text not null check (source in ('payment', 'admin')),
  payment_request_id uuid,
  created_by         text,
  created_at         timestamptz not null default now(),
  voided_at          timestamptz,
  constraint plan_periods_ends_after_starts check (ends_at > starts_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plan_periods_no_overlap'
  ) then
    alter table public.plan_periods
      add constraint plan_periods_no_overlap
      exclude using gist (user_id with =, tstzrange(starts_at, ends_at) with &&)
      where (voided_at is null);
  end if;
end $$;

create index if not exists plan_periods_user_ends_idx
  on public.plan_periods (user_id, ends_at);

create table if not exists public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_email     text,
  action          text not null,
  subject_user_id uuid,
  subject_id      text,
  detail          jsonb,
  created_at      timestamptz not null default now()
);

alter table public.plan_periods enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "plan_periods select own" on public.plan_periods;
create policy "plan_periods select own" on public.plan_periods
  for select
  to authenticated
  using (user_id = auth.uid());

-- audit_log: intentionally no user policy.

-- Defense in depth: browser roles never write these tables, even if RLS were relaxed.
revoke insert, update, delete on public.plan_periods from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;
