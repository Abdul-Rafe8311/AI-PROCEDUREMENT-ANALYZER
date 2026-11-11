-- Story 2.1: per-user API keys for the Fastn intake workflow (AD-2, AD-12).
-- Idempotent. Only the SHA-256 of a key is stored. No user policy: browser roles never touch this table.

create table if not exists public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  key_sha256 text not null unique check (key_sha256 ~ '^[0-9a-f]{64}$'),
  label      text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

-- api_keys: intentionally no user policy.
revoke all on public.api_keys from anon, authenticated;
