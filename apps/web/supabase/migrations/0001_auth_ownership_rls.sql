-- ============================================================================
-- Phase 2 — Data ownership + Row-Level Security (RLS)
-- ============================================================================
-- Run this ONCE against the Supabase project (SQL Editor → paste → Run, or
-- `supabase db push`). It is idempotent — safe to re-run.
--
-- What it does:
--   1. profiles table (the user's name) + auto-fill trigger on sign-up.
--   2. analyses.user_id (owner) referencing auth.users.
--   3. Enables RLS on analyses / messages / documents and adds owner-only
--      policies so a user can read/write ONLY their own rows — enforced by the
--      DATABASE, not just the app. User A physically cannot read User B's rows.
--
-- Existing anonymous rows (user_id IS NULL, created before auth) stay anonymous:
-- no policy matches them for any logged-in user, so they are simply invisible and
-- are never attached to the first user who signs in (Phase-2 item 10).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Profiles (display name lives here + in auth user_metadata)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: owner can read own"   on public.profiles;
drop policy if exists "profiles: owner can update own" on public.profiles;
create policy "profiles: owner can read own"
  on public.profiles for select
  using (auth.uid() = id);
create policy "profiles: owner can update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row when a new auth user signs up, copying the name they
-- entered (passed as user_metadata.full_name from the sign-up form).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
  on conflict (id) do update set
    full_name = excluded.full_name,
    email     = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 2. Ownership column on analyses
-- ─────────────────────────────────────────────────────────────
alter table public.analyses
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists analyses_user_id_idx on public.analyses (user_id);

-- ─────────────────────────────────────────────────────────────
-- 3. RLS: owner-only access to analyses / messages / documents
-- ─────────────────────────────────────────────────────────────
alter table public.analyses  enable row level security;
alter table public.messages  enable row level security;
alter table public.documents enable row level security;

-- analyses: the owner (user_id) is the only one who can touch the row.
drop policy if exists "analyses: owner select" on public.analyses;
drop policy if exists "analyses: owner insert" on public.analyses;
drop policy if exists "analyses: owner update" on public.analyses;
drop policy if exists "analyses: owner delete" on public.analyses;
create policy "analyses: owner select" on public.analyses for select using (auth.uid() = user_id);
create policy "analyses: owner insert" on public.analyses for insert with check (auth.uid() = user_id);
create policy "analyses: owner update" on public.analyses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "analyses: owner delete" on public.analyses for delete using (auth.uid() = user_id);

-- messages: allowed only when the parent analysis is owned by the caller.
drop policy if exists "messages: via owned analysis select" on public.messages;
drop policy if exists "messages: via owned analysis insert" on public.messages;
drop policy if exists "messages: via owned analysis update" on public.messages;
drop policy if exists "messages: via owned analysis delete" on public.messages;
create policy "messages: via owned analysis select" on public.messages for select
  using (exists (select 1 from public.analyses a where a.id = messages.analysis_id and a.user_id = auth.uid()));
create policy "messages: via owned analysis insert" on public.messages for insert
  with check (exists (select 1 from public.analyses a where a.id = messages.analysis_id and a.user_id = auth.uid()));
create policy "messages: via owned analysis update" on public.messages for update
  using (exists (select 1 from public.analyses a where a.id = messages.analysis_id and a.user_id = auth.uid()));
create policy "messages: via owned analysis delete" on public.messages for delete
  using (exists (select 1 from public.analyses a where a.id = messages.analysis_id and a.user_id = auth.uid()));

-- documents: same rule via the parent analysis.
drop policy if exists "documents: via owned analysis select" on public.documents;
drop policy if exists "documents: via owned analysis insert" on public.documents;
drop policy if exists "documents: via owned analysis update" on public.documents;
drop policy if exists "documents: via owned analysis delete" on public.documents;
create policy "documents: via owned analysis select" on public.documents for select
  using (exists (select 1 from public.analyses a where a.id = documents.analysis_id and a.user_id = auth.uid()));
create policy "documents: via owned analysis insert" on public.documents for insert
  with check (exists (select 1 from public.analyses a where a.id = documents.analysis_id and a.user_id = auth.uid()));
create policy "documents: via owned analysis update" on public.documents for update
  using (exists (select 1 from public.analyses a where a.id = documents.analysis_id and a.user_id = auth.uid()));
create policy "documents: via owned analysis delete" on public.documents for delete
  using (exists (select 1 from public.analyses a where a.id = documents.analysis_id and a.user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 4. (OPTIONAL) Storage hardening for the 'quotations' bucket
-- ─────────────────────────────────────────────────────────────
-- The app currently serves uploaded PDFs via PUBLIC URLs (the RAG indexer fetches
-- them by URL), so files are readable by URL regardless of RLS. If you later make
-- the bucket PRIVATE, uncomment the policies below to scope object writes/reads to
-- the analysis owner (path is "<analysis_id>/<file>"). Leaving them off keeps the
-- current public-URL flow working.
--
-- create policy "quotations: owner can upload" on storage.objects for insert to authenticated
--   with check (bucket_id = 'quotations' and exists (
--     select 1 from public.analyses a where a.id::text = split_part(name, '/', 1) and a.user_id = auth.uid()));
-- create policy "quotations: owner can read" on storage.objects for select to authenticated
--   using (bucket_id = 'quotations' and exists (
--     select 1 from public.analyses a where a.id::text = split_part(name, '/', 1) and a.user_id = auth.uid()));
