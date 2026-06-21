-- AI Procurement Copilot - Supabase schema (anonymous MVP)
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
--
-- MVP policies allow anonymous (anon) access so the workspace works
-- without login. See the "FUTURE: multi-tenant auth" note at the bottom
-- for how to lock this down per-user later.

create extension if not exists "pgcrypto";

-- Tables
create table if not exists public.analyses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text
  -- FUTURE: owner_id uuid references auth.users(id)
);

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  file_name   text not null,
  file_url    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists documents_analysis_id_idx on public.documents(analysis_id);
create index if not exists messages_analysis_id_idx on public.messages(analysis_id);

-- Row Level Security (anonymous MVP)
alter table public.analyses  enable row level security;
alter table public.documents enable row level security;
alter table public.messages  enable row level security;

drop policy if exists "anon all analyses"  on public.analyses;
drop policy if exists "anon all documents" on public.documents;
drop policy if exists "anon all messages"  on public.messages;

create policy "anon all analyses"  on public.analyses  for all to anon using (true) with check (true);
create policy "anon all documents" on public.documents for all to anon using (true) with check (true);
create policy "anon all messages"  on public.messages  for all to anon using (true) with check (true);

-- Storage bucket for uploaded quotations
insert into storage.buckets (id, name, public)
values ('quotations', 'quotations', true)
on conflict (id) do nothing;

drop policy if exists "anon upload quotations" on storage.objects;
drop policy if exists "public read quotations" on storage.objects;

create policy "anon upload quotations" on storage.objects
  for insert to anon with check (bucket_id = 'quotations');

create policy "public read quotations" on storage.objects
  for select to anon using (bucket_id = 'quotations');

-- FUTURE: multi-tenant auth
--   1. Add owner_id uuid references auth.users(id) to each table.
--   2. Replace anon policies with: to authenticated using (owner_id = auth.uid()).
--   3. Scope the storage bucket path by user id and tighten bucket policies.
