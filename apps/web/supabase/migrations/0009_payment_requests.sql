-- Story 4.2: payment requests and the private screenshot bucket (AD-6, AD-8, AD-12).
-- Additive and idempotent: creates a table, indexes, a policy and a bucket; drops or deletes nothing.
-- Writers are the service-role client only (bypasses RLS); no insert/update/delete policy exists.

create table if not exists public.payment_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  plan            text not null check (plan in ('plus', 'pro', 'max')),
  amount_usd      integer not null check (amount_usd > 0),
  transaction_id  text not null check (char_length(btrim(transaction_id)) between 1 and 100),
  screenshot_path text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  reject_reason   text,
  created_at      timestamptz not null default now()
);

-- At most one pending request per user (second submit -> 409 PENDING_REQUEST_EXISTS).
create unique index if not exists payment_requests_one_pending_idx
  on public.payment_requests (user_id) where status = 'pending';
-- Non-unique: a repeated transaction id only raises a duplicate flag at read time.
create index if not exists payment_requests_transaction_id_idx
  on public.payment_requests (transaction_id);
create index if not exists payment_requests_status_created_idx
  on public.payment_requests (status, created_at);
create index if not exists payment_requests_user_created_idx
  on public.payment_requests (user_id, created_at desc);

alter table public.payment_requests enable row level security;

drop policy if exists "payment_requests select own" on public.payment_requests;
create policy "payment_requests select own" on public.payment_requests
  for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.payment_requests from anon, authenticated;

-- Private bucket for receipts. No storage policy for anon/authenticated: only the service role
-- touches it, and users see a file only through a server-minted signed URL.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('payment-proofs', 'payment-proofs', false)
    on conflict (id) do nothing;
  end if;
end $$;
