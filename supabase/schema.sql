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
  title       text,
  -- Phase 4: full AnalysisResult (quotations w/ per-field source + confidence)
  result      jsonb
  -- FUTURE: owner_id uuid references auth.users(id)
);

-- Migration for databases created before Phase 4 (idempotent):
alter table public.analyses add column if not exists result jsonb;

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

-- Deep-document RAG (MiniLM all-MiniLM-L6-v2 = 384 dims + pgvector)
create extension if not exists vector;

alter table public.documents add column if not exists full_text text;
alter table public.documents add column if not exists index_status text default 'pending'; -- pending|indexing|ready|failed
alter table public.documents add column if not exists index_error text;
alter table public.documents add column if not exists chunk_count int default 0;
alter table public.documents add column if not exists indexed_chunks int default 0;

create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_index int not null,
  page int,
  content text not null,
  embedding vector(384),
  unique (document_id, chunk_index)
);
-- NOTE: no ivfflat index. An ivfflat index built on an empty table has
-- degenerate clusters and silently drops results (with probes=1 a query can
-- land on an empty cluster -> 0 rows). At our scale (hundreds of chunks per
-- doc, filtered by document_id) an exact scan is sub-millisecond and correct.
create index if not exists document_chunks_doc_idx
  on public.document_chunks(document_id);

-- FUTURE: multi-tenant auth
--   1. Add owner_id uuid references auth.users(id) to each table.
--   2. Replace anon policies with: to authenticated using (owner_id = auth.uid()).
--   3. Scope the storage bucket path by user id and tighten bucket policies.
