-- Tender Comparative Sheet: one editable sheet per analysis.
--
-- The template (what is asked, of whom) and the answers (what each supplier
-- said, each marked ai|user) are stored as JSON, exactly as the app models them
-- — the shape is the reviewer's to change, so a rigid relational schema would
-- fight every "add a criterion" the buyer makes.
--
-- Idempotent: safe to re-run.

create table if not exists public.tender_sheets (
  -- one sheet per analysis; the analysis id doubles as the sheet id
  analysis_id uuid primary key references public.analyses (id) on delete cascade,
  template    jsonb not null,
  answers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.tender_sheets enable row level security;

-- A sheet is readable/writable by whoever owns its analysis. Ownership lives on
-- analyses.user_id (see 0001_auth_ownership_rls.sql); an ownerless row stays
-- reachable so sessions predating the ownership column keep working.
drop policy if exists "tender_sheets owner access" on public.tender_sheets;
create policy "tender_sheets owner access" on public.tender_sheets
  for all
  using (
    exists (
      select 1 from public.analyses a
      where a.id = tender_sheets.analysis_id
        and (a.user_id = auth.uid() or a.user_id is null)
    )
  )
  with check (
    exists (
      select 1 from public.analyses a
      where a.id = tender_sheets.analysis_id
        and (a.user_id = auth.uid() or a.user_id is null)
    )
  );

create index if not exists tender_sheets_updated_at_idx
  on public.tender_sheets (updated_at desc);
