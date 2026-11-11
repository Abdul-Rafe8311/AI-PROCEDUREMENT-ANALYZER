-- Story 2.2: PDF usage ledger and atomic quota functions (AD-5, AD-6, AD-12).
-- Idempotent. All writes go through the service-role client / functions below.
-- Lock key must match admin_set_plan: hashtextextended(user_id::text, 0).

create table if not exists public.pdf_usage (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status       text not null check (status in ('reserved', 'confirmed')),
  window_start timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists pdf_usage_user_created_idx on public.pdf_usage (user_id, created_at);
-- A file is confirmed at most once per user, ever (re-analysis is free).
create unique index if not exists pdf_usage_confirmed_once_idx
  on public.pdf_usage (user_id, file_sha256) where status = 'confirmed';

alter table public.pdf_usage enable row level security;

drop policy if exists "pdf_usage select own" on public.pdf_usage;
create policy "pdf_usage select own" on public.pdf_usage
  for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.pdf_usage from anon, authenticated;

-- Returns jsonb:
--   {status:'STALE'}                                   effective period id differs from expected
--   {status:'QUOTA_EXCEEDED', quota, used, remaining}  new files exceed what is left; nothing reserved
--   {status:'OK', quota, used, remaining, reserved:[hashes], free:[hashes]}
-- 'free' = hashes already confirmed ever, or already held by a fresh reservation (cost nothing).
create or replace function public.reserve_pdf_quota(
  p_user_id uuid,
  p_hashes text[],
  p_window_start timestamptz,
  p_quota integer,
  p_expected_period_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_period uuid;
  v_all text[];
  v_free text[];
  v_new text[];
  v_used integer;
  v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select id into v_period
    from public.plan_periods
   where user_id = p_user_id and voided_at is null and starts_at <= v_now and v_now < ends_at
   limit 1;
  if v_period is distinct from p_expected_period_id then
    return jsonb_build_object('status', 'STALE');
  end if;

  -- expired reservations never count; clear them so the hash can be reserved again
  delete from public.pdf_usage
   where user_id = p_user_id and status = 'reserved' and created_at < v_now - interval '10 minutes';

  select coalesce(array_agg(distinct h), '{}') into v_all from unnest(coalesce(p_hashes, '{}')) h;

  select coalesce(array_agg(h), '{}') into v_free
    from unnest(v_all) h
   where exists (select 1 from public.pdf_usage u
                  where u.user_id = p_user_id and u.file_sha256 = h
                    and (u.status = 'confirmed' or u.created_at >= v_now - interval '10 minutes'));
  select coalesce(array_agg(h), '{}') into v_new from unnest(v_all) h where not (h = any (v_free));

  select count(*) into v_used
    from public.pdf_usage
   where user_id = p_user_id
     and ((status = 'confirmed' and created_at >= p_window_start)
          or (status = 'reserved' and created_at >= v_now - interval '10 minutes'));
  v_remaining := greatest(p_quota - v_used, 0);

  if cardinality(v_new) > v_remaining then
    return jsonb_build_object('status', 'QUOTA_EXCEEDED', 'quota', p_quota, 'used', v_used, 'remaining', v_remaining);
  end if;

  insert into public.pdf_usage (user_id, file_sha256, status, window_start)
  select p_user_id, h, 'reserved', p_window_start from unnest(v_new) h;

  return jsonb_build_object(
    'status', 'OK', 'quota', p_quota, 'used', v_used + cardinality(v_new),
    'remaining', v_remaining - cardinality(v_new), 'reserved', to_jsonb(v_new), 'free', to_jsonb(v_free)
  );
end;
$$;

-- Always succeeds, even if the reservation expired or was cleared.
create or replace function public.confirm_pdf_usage(
  p_user_id uuid,
  p_hash text,
  p_window_start timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (select 1 from public.pdf_usage where user_id = p_user_id and file_sha256 = p_hash and status = 'confirmed') then
    delete from public.pdf_usage where user_id = p_user_id and file_sha256 = p_hash and status = 'reserved';
    return;
  end if;

  update public.pdf_usage
     set status = 'confirmed', created_at = now()
   where user_id = p_user_id and file_sha256 = p_hash and status = 'reserved';

  if not found then
    insert into public.pdf_usage (user_id, file_sha256, status, window_start)
    values (p_user_id, p_hash, 'confirmed', p_window_start);
  end if;
end;
$$;

-- Never touches confirmed rows.
create or replace function public.release_pdf_usage(
  p_user_id uuid,
  p_hash text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.pdf_usage where user_id = p_user_id and file_sha256 = p_hash and status = 'reserved';
end;
$$;

revoke execute on function public.reserve_pdf_quota(uuid, text[], timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.reserve_pdf_quota(uuid, text[], timestamptz, integer, uuid) to service_role;
revoke execute on function public.confirm_pdf_usage(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_pdf_usage(uuid, text, timestamptz) to service_role;
revoke execute on function public.release_pdf_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.release_pdf_usage(uuid, text) to service_role;
