// Service-role DB access (AD-12). The only place the service-role client is built.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';
import type { PlanPeriod } from '../entitlements/effective-plan';
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
    .select('plan, starts_at, ends_at, voided_at')
    .eq('user_id', userId)
    .is('voided_at', null)
    .gte('ends_at', since)
    .order('starts_at', { ascending: true })
    .limit(500);
  if (error) throw new DbUnavailableError('plan_periods query failed');
  return (data ?? []).map((r) => ({
    plan: r.plan as PaidPlanId,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    voidedAt: (r.voided_at as string | null) ?? null,
  }));
}
