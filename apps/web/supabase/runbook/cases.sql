-- GENERATED from src/lib/entitlements/cases.json by scripts/gen-cases-sql.mjs. Do not edit by hand.
-- Run in the Supabase SQL editor after applying 0005. Touches only a temp table; rolls back.
-- Passes silently with a final NOTICE; any mismatch raises an exception.
begin;
create temp table t_periods (like public.plan_periods including all) on commit drop;
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-000000000001';
  v_now timestamptz;
  v_plan text;
  v_queued text;
  n int := 0;
begin
  -- no periods
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'no periods';
  end if;
  n := n + 1;
  -- expired period
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'expired period';
  end if;
  n := n + 1;
  -- voided active period
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', '2026-11-05T00:00:00Z'::timestamptz);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'voided active period';
  end if;
  n := n + 1;
  -- active period
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'plus' or v_queued <> '' then
    raise exception 'case failed: %', 'active period';
  end if;
  n := n + 1;
  -- starts_at equals now is active
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-11-11T00:00:00Z', '2026-12-11T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'pro' or v_queued <> '' then
    raise exception 'case failed: %', 'starts_at equals now is active';
  end if;
  n := n + 1;
  -- ends_at equals now is expired
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-10-11T00:00:00Z', '2026-11-11T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'ends_at equals now is expired';
  end if;
  n := n + 1;
  -- active with queued ordered by start
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2027-02-01T00:00:00Z', '2027-03-01T00:00:00Z', 'admin', '2026-11-02T00:00:00Z'::timestamptz);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'pro' or v_queued <> 'plus,max' then
    raise exception 'case failed: %', 'active with queued ordered by start';
  end if;
  n := n + 1;
  -- approve: first purchase from Free starts now
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: first purchase from Free starts now';
  end if;
  n := n + 1;
  -- approve: early same-plan renewal appends after current expiry
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-10-21T00:00:00Z', '2026-11-20T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'pro' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: early same-plan renewal appends after current expiry';
  end if;
  n := n + 1;
  -- approve: renewal after expiry starts now
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: renewal after expiry starts now';
  end if;
  n := n + 1;
  -- approve: lower plan is queued after the higher one
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'max' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: lower plan is queued after the higher one';
  end if;
  n := n + 1;
  -- approve: upgrade voids current, starts now, re-chains queued periods keeping length
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'plus' or v_queued <> 'pro' then
    raise exception 'case failed: %', 'approve: upgrade voids current, starts now, re-chains queued periods keeping length';
  end if;
  n := n + 1;
  -- approve: same-plan renewal chains after the last queued period
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-10-21T00:00:00Z', '2026-11-20T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-11-20T00:00:00Z', '2026-12-20T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'pro' or v_queued <> 'plus' then
    raise exception 'case failed: %', 'approve: same-plan renewal chains after the last queued period';
  end if;
  n := n + 1;
  -- approve: voided periods are ignored
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2026-11-20T00:00:00Z', '2026-12-20T00:00:00Z', 'admin', '2026-11-05T00:00:00Z'::timestamptz);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'free' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: voided periods are ignored';
  end if;
  n := n + 1;
  -- approve: a queued period shorter than 30 days keeps its length on upgrade
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'pro', '2026-12-01T00:00:00Z', '2026-12-11T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'plus' or v_queued <> 'pro' then
    raise exception 'case failed: %', 'approve: a queued period shorter than 30 days keeps its length on upgrade';
  end if;
  n := n + 1;
  -- approve: upgrading to a plan equal to the queued one is still an upgrade of the current
  delete from t_periods;
  v_now := '2026-11-11T00:00:00Z'::timestamptz;
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'plus', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'admin', null);
  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> 'plus' or v_queued <> '' then
    raise exception 'case failed: %', 'approve: upgrading to a plan equal to the queued one is still an upgrade of the current';
  end if;
  n := n + 1;

  -- overlap of two live periods must be rejected by the exclusion constraint
  delete from t_periods;
  insert into t_periods (user_id, plan, starts_at, ends_at, source) values (u, 'pro', '2026-11-01', '2026-12-01', 'admin');
  begin
    insert into t_periods (user_id, plan, starts_at, ends_at, source) values (u, 'max', '2026-11-15', '2026-12-15', 'admin');
    raise exception 'overlap was NOT rejected';
  exception when exclusion_violation then
    null;
  end;
  -- a voided overlapping period is allowed
  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, 'max', '2026-11-15', '2026-12-15', 'admin', now());
  n := n + 2;
  raise notice 'all % checks passed (expected 18)', n;
end $$;
rollback;
