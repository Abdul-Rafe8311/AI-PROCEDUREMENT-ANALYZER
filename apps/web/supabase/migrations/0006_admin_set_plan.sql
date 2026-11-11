-- Story 1.3: audited manual plan override (AD-6). Idempotent (create or replace).
-- Lock key must match later writers (decide_payment_request): hashtextextended(user_id::text, 0).

create or replace function public.admin_set_plan(
  p_user_id uuid,
  p_plan text,
  p_ends_at timestamptz,
  p_admin_email text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_voided uuid[];
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if p_plan is null or p_plan not in ('plus', 'pro', 'max') then
    raise exception 'invalid_plan';
  end if;
  if p_ends_at is null or p_ends_at <= v_now then
    raise exception 'ends_at_not_future';
  end if;

  with v as (
    update public.plan_periods
       set voided_at = v_now
     where user_id = p_user_id
       and voided_at is null
       and ends_at > v_now
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_voided from v;

  insert into public.plan_periods (user_id, plan, starts_at, ends_at, source, created_by)
  values (p_user_id, p_plan, v_now, p_ends_at, 'admin', p_admin_email)
  returning id into v_id;

  insert into public.audit_log (actor_email, action, subject_user_id, subject_id, detail)
  values (
    p_admin_email,
    'admin_set_plan',
    p_user_id,
    v_id::text,
    jsonb_build_object('plan', p_plan, 'ends_at', p_ends_at, 'voided_period_ids', to_jsonb(v_voided))
  );

  return v_id;
end;
$$;

revoke execute on function public.admin_set_plan(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_set_plan(uuid, text, timestamptz, text) to service_role;
