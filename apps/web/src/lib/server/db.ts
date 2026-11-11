// Service-role DB access (AD-12). The only place the service-role client is built.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';
import { effectivePlan, activePeriod, type PlanPeriod } from '../entitlements/effective-plan';
import type { PaidPlanId } from '../entitlements/plans';

export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

export function serviceClient(): SupabaseClient {
  const cfg = getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new DbUnavailableError('service-role configuration missing');
  }
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const LOOKBACK_MS = 62 * 24 * 60 * 60 * 1000;

/** Non-voided periods with ends_at >= now - 62 days, ordered by starts_at. */
export async function loadPeriods(
  userId: string,
  now: Date,
  client: Pick<SupabaseClient, 'from'> = serviceClient(),
): Promise<PlanPeriod[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const { data, error } = await client
    .from('plan_periods')
    .select('id, plan, starts_at, ends_at, voided_at')
    .eq('user_id', userId)
    .is('voided_at', null)
    .gte('ends_at', since)
    .order('starts_at', { ascending: true })
    .limit(500);
  if (error) throw new DbUnavailableError('plan_periods query failed');
  return (data ?? []).map((r) => ({
    id: r.id as string,
    plan: r.plan as PaidPlanId,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    voidedAt: (r.voided_at as string | null) ?? null,
  }));
}

export class InvalidAdminPlanError extends Error {
  constructor(public readonly reason: 'invalid_plan' | 'ends_at_not_future') {
    super(reason);
    this.name = 'InvalidAdminPlanError';
  }
}

/** Returns true if the auth user exists, false if not found. Throws DbUnavailableError on failure. */
export async function userExists(
  userId: string,
  client: Pick<SupabaseClient, 'auth'> = serviceClient(),
): Promise<boolean> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) {
    const e = error as { status?: number };
    if (e.status === 404) return false;
    throw new DbUnavailableError('auth getUserById failed');
  }
  return Boolean(data?.user);
}

/** Calls the admin_set_plan SQL function; returns the new period id. */
export async function adminSetPlan(
  args: { userId: string; plan: string; endsAt: string; adminEmail: string },
  client: Pick<SupabaseClient, 'rpc'> = serviceClient(),
): Promise<string> {
  const { data, error } = await client.rpc('admin_set_plan', {
    p_user_id: args.userId,
    p_plan: args.plan,
    p_ends_at: args.endsAt,
    p_admin_email: args.adminEmail,
  });
  if (error) {
    const msg = String((error as { message?: string }).message ?? '');
    if (msg.includes('invalid_plan')) throw new InvalidAdminPlanError('invalid_plan');
    if (msg.includes('ends_at_not_future')) throw new InvalidAdminPlanError('ends_at_not_future');
    throw new DbUnavailableError('admin_set_plan failed');
  }
  if (typeof data !== 'string') throw new DbUnavailableError('admin_set_plan returned no id');
  return data;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string | null;
  plan: string;
  expiresAt: string | null;
  lastChange: AdminLastChange | null;
}

export interface AdminLastChange {
  adminEmail: string | null;
  at: string;
  plan: string | null;
  endsAt: string | null;
}

const MAX_USERS = 50;
const PAGE = 200;
const MAX_PAGES = 50;

/** Lists auth users (email filtered in code), with effective plan from one batched periods query. */
export async function listUsersWithPlans(
  search: string,
  now: Date,
  client: Pick<SupabaseClient, 'auth' | 'from'> = serviceClient(),
): Promise<AdminUserRow[]> {
  const needle = search.trim().toLowerCase();
  const matched: Array<{ id: string; email: string | null; created_at?: string }> = [];
  for (let page = 1; page <= MAX_PAGES && matched.length < MAX_USERS; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new DbUnavailableError('auth listUsers failed');
    const users = data?.users ?? [];
    for (const u of users) {
      const email = u.email ?? null;
      if (needle && !(email ?? '').toLowerCase().includes(needle)) continue;
      matched.push({ id: u.id, email, created_at: u.created_at });
      if (matched.length >= MAX_USERS) break;
    }
    if (users.length < PAGE) break;
  }
  if (matched.length === 0) return [];

  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const { data: rows, error } = await client
    .from('plan_periods')
    .select('user_id, plan, starts_at, ends_at, voided_at')
    .in('user_id', matched.map((u) => u.id))
    .is('voided_at', null)
    .gte('ends_at', since)
    .limit(5000);
  if (error) throw new DbUnavailableError('plan_periods query failed');
  const byUser = new Map<string, PlanPeriod[]>();
  for (const r of rows ?? []) {
    const list = byUser.get(r.user_id as string) ?? [];
    list.push({
      plan: r.plan as PaidPlanId,
      startsAt: r.starts_at as string,
      endsAt: r.ends_at as string,
      voidedAt: (r.voided_at as string | null) ?? null,
    });
    byUser.set(r.user_id as string, list);
  }

  const ids = matched.map((u) => u.id);
  const { data: audit, error: auditErr } = await client
    .from('audit_log')
    .select('actor_email, subject_user_id, detail, created_at')
    .eq('action', 'admin_set_plan')
    .in('subject_user_id', ids)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (auditErr) throw new DbUnavailableError('audit_log query failed');
  const lastBy = new Map<string, AdminLastChange>();
  for (const a of audit ?? []) {
    const uid = a.subject_user_id as string;
    if (lastBy.has(uid)) continue;
    const d = (a.detail ?? {}) as { plan?: unknown; ends_at?: unknown };
    lastBy.set(uid, {
      adminEmail: (a.actor_email as string | null) ?? null,
      at: new Date(a.created_at as string).toISOString(),
      plan: typeof d.plan === 'string' ? d.plan : null,
      endsAt: typeof d.ends_at === 'string' ? new Date(d.ends_at).toISOString() : null,
    });
  }
  return matched.map((u) => {
    const periods = byUser.get(u.id) ?? [];
    const active = activePeriod(periods, now);
    return {
      id: u.id,
      email: u.email,
      createdAt: u.created_at ?? null,
      plan: effectivePlan(periods, now),
      expiresAt: active ? new Date(active.endsAt).toISOString() : null,
      lastChange: lastBy.get(u.id) ?? null,
    };
  });
}
