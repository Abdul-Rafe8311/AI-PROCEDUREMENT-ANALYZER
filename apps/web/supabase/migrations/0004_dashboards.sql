-- Procurement analytics dashboard pages: one row per batch, served as a real
-- page (GET /api/dashboard?token=...) instead of a raw .html email attachment.
--
-- The token is the batch's Gmail message id (same scheme as the Approve link)
-- — unguessable in practice, but not a secret, so this is intentionally a
-- public, ownerless, shareable artifact: anyone with the link can view it,
-- nobody needs to be logged in to write or read it (the writer is the Fastn
-- workflow, which has no Supabase session). Idempotent: safe to re-run.

create table if not exists public.dashboards (
  token      text primary key,
  html       text not null,
  created_at timestamptz not null default now()
);

alter table public.dashboards enable row level security;

drop policy if exists "dashboards public read" on public.dashboards;
create policy "dashboards public read" on public.dashboards
  for select
  using (true);

drop policy if exists "dashboards public write" on public.dashboards;
create policy "dashboards public write" on public.dashboards
  for insert
  with check (true);

drop policy if exists "dashboards public upsert" on public.dashboards;
create policy "dashboards public upsert" on public.dashboards
  for update
  using (true)
  with check (true);
