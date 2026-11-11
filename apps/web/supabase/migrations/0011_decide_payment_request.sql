-- Story 4.5: approve or reject a payment request in one transaction (AD-3, AD-6).
-- Idempotent (create or replace). Takes the same per-user lock as admin_set_plan and
-- reserve_pdf_quota: hashtextextended(user_id::text, 0). Never deletes rows; periods are only voided.
--
-- Approve:
--   * target ranks higher than the plan effective now (upgrade): void the current period and every
--     not-yet-started period, insert the target starting now for 30 days, then re-insert the voided
--     queued periods unchanged in length, chained after it. Remaining days of the current period are forfeited.
--   * otherwise (renewal, lower plan, after expiry, free user): append 30 days at
--     plan_chain_end = greatest(now, max(ends_at) of non-voided periods).
-- Reject: a non-empty reason is required.
-- Returns jsonb: {status: 'approved'|'rejected'|'ALREADY_DECIDED', ...}. Raises on bad input:
--   invalid_decision, request_not_found, reason_required.

create or replace function public.decide_payment_request(
  p_request_id uuid,
  p_admin_email text,
  p_decision text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_ranks text[] := array['free', 'plus', 'pro', 'max'];
  v_user uuid;
  v_req public.payment_requests%rowtype;
  v_cur public.plan_periods%rowtype;
  v_has_cur boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_voided uuid[] := '{}';
  v_queued uuid[] := '{}';
  v_q public.plan_periods%rowtype;
  v_cursor timestamptz;
  v_requeued uuid[] := '{}';
  v_new uuid;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision';
  end if;

  select user_id into v_user from public.payment_requests where id = p_request_id;
  if v_user is null then
    raise exception 'request_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select * into v_req from public.payment_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then
    return jsonb_build_object('status', 'ALREADY_DECIDED');
  end if;

  if p_decision = 'reject' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason_required';
    end if;
    update public.payment_requests
       set status = 'rejected', decided_by = p_admin_email, decided_at = v_now, reject_reason = btrim(p_reason)
     where id = p_request_id;
    insert into public.audit_log (actor_email, action, subject_user_id, subject_id, detail)
    values (p_admin_email, 'payment_rejected', v_user, p_request_id::text,
            jsonb_build_object('plan', v_req.plan, 'reason', btrim(p_reason)));
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into v_cur
    from public.plan_periods
   where user_id = v_user and voided_at is null and starts_at <= v_now and v_now < ends_at
   limit 1;
  v_has_cur := found;

  if v_has_cur and array_position(v_ranks, v_req.plan) > array_position(v_ranks, v_cur.plan) then
    -- Upgrade: void current and not-yet-started periods first so the overlap constraint never trips.
    select coalesce(array_agg(id order by starts_at), '{}') into v_queued
      from public.plan_periods
     where user_id = v_user and voided_at is null and starts_at > v_now;
    v_voided := array[v_cur.id] || v_queued;
    update public.plan_periods set voided_at = v_now where id = any(v_voided);

    v_start := v_now;
    v_end := v_now + interval '30 days';
    insert into public.plan_periods (user_id, plan, starts_at, ends_at, source, payment_request_id, created_by)
    values (v_user, v_req.plan, v_start, v_end, 'payment', p_request_id, p_admin_email)
    returning id into v_id;

    v_cursor := v_end;
    for v_q in select * from public.plan_periods where id = any(v_queued) order by starts_at loop
      insert into public.plan_periods (user_id, plan, starts_at, ends_at, source, payment_request_id, created_by)
      values (v_user, v_q.plan, v_cursor, v_cursor + (v_q.ends_at - v_q.starts_at), v_q.source, v_q.payment_request_id, v_q.created_by)
      returning id into v_new;
      v_requeued := v_requeued || v_new;
      v_cursor := v_cursor + (v_q.ends_at - v_q.starts_at);
    end loop;
  else
    select greatest(v_now, coalesce(max(ends_at), v_now)) into v_start
      from public.plan_periods
     where user_id = v_user and voided_at is null;
    v_end := v_start + interval '30 days';
    insert into public.plan_periods (user_id, plan, starts_at, ends_at, source, payment_request_id, created_by)
    values (v_user, v_req.plan, v_start, v_end, 'payment', p_request_id, p_admin_email)
    returning id into v_id;
  end if;

  update public.payment_requests
     set status = 'approved', decided_by = p_admin_email, decided_at = v_now
   where id = p_request_id;

  insert into public.audit_log (actor_email, action, subject_user_id, subject_id, detail)
  values (p_admin_email, 'payment_approved', v_user, p_request_id::text,
          jsonb_build_object('plan', v_req.plan, 'period_id', v_id, 'starts_at', v_start, 'ends_at', v_end,
                             'voided_period_ids', to_jsonb(v_voided), 'requeued_period_ids', to_jsonb(v_requeued)));

  return jsonb_build_object('status', 'approved', 'plan', v_req.plan, 'period_id', v_id,
                            'starts_at', v_start, 'ends_at', v_end);
end;
$$;

revoke execute on function public.decide_payment_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_payment_request(uuid, text, text, text) to service_role;
