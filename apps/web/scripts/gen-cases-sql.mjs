// Regenerates supabase/runbook/cases.sql from src/lib/entitlements/cases.json.
// Run: node scripts/gen-cases-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const cases = JSON.parse(readFileSync(new URL('../src/lib/entitlements/cases.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let out = `-- GENERATED from src/lib/entitlements/cases.json by scripts/gen-cases-sql.mjs. Do not edit by hand.
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
`;
for (const c of cases) {
  out += `  -- ${c.name.replace(/\n/g, ' ')}\n  delete from t_periods;\n  v_now := ${q(c.now)}::timestamptz;\n`;
  for (const p of c.periods) {
    out += `  insert into t_periods (user_id, plan, starts_at, ends_at, source, voided_at) values (u, ${q(p.plan)}, ${q(p.startsAt)}, ${q(p.endsAt)}, 'admin', ${p.voidedAt ? q(p.voidedAt) + '::timestamptz' : 'null'});\n`;
  }
  out += `  select coalesce((select plan from t_periods where voided_at is null and starts_at <= v_now and v_now < ends_at), 'free') into v_plan;
  select coalesce(string_agg(plan, ',' order by starts_at), '') into v_queued from t_periods where voided_at is null and starts_at > v_now;
  if v_plan <> ${q(c.expected.plan)} or v_queued <> ${q(c.expected.queued.join(','))} then
    raise exception 'case failed: %', ${q(c.name)};
  end if;
  n := n + 1;
`;
}
out += `
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
  raise notice 'all % checks passed (expected ${cases.length + 2})', n;
end $$;
rollback;
`;
writeFileSync(new URL('../supabase/runbook/cases.sql', import.meta.url), out);
