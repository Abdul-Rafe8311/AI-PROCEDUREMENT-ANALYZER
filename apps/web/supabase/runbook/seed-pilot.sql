-- Rollout step 5: seed pilot users on Pro before any quota is visible (SM-C3).
-- Run in the Supabase SQL editor AFTER 0005 and 0006 are applied.
-- Edit the two values below. Use real pilot emails here only; never commit them.
-- Re-running is safe: admin_set_plan voids the user's live period and writes a new one.
do $$
declare
  v_admin_email constant text := 'REPLACE_WITH_ADMIN_EMAIL';
  v_ends_at     constant timestamptz := now() + interval '90 days';
  v_emails      constant text[] := array['replace-pilot-1@example.com', 'replace-pilot-2@example.com'];
  r record;
begin
  if v_admin_email like 'REPLACE%' or v_emails[1] like 'replace-%' then
    raise exception 'edit the placeholders first';
  end if;
  for r in select id, email from auth.users where lower(email) = any (select lower(e) from unnest(v_emails) e) loop
    perform public.admin_set_plan(r.id, 'pro', v_ends_at, v_admin_email);
    raise notice 'seeded % on pro until %', r.email, v_ends_at;
  end loop;
end $$;

-- Verify: every pilot user shows pro with a future ends_at.
-- select u.email, p.plan, p.ends_at from public.plan_periods p join auth.users u on u.id = p.user_id
--  where p.voided_at is null and p.ends_at > now() order by u.email;
