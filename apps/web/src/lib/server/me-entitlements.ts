// Response builder for GET /api/me/entitlements, with injectable deps for tests.
import { NextResponse } from 'next/server';
import { activePeriod, effectivePlan, queuedPeriods, type PlanPeriod } from '../entitlements/effective-plan';
import { planQuota } from '../entitlements/plans';
import { loadPeriods } from './db';
import { getConfig } from './config';
import { isAdminPrincipal, type Principal } from './guard';

export interface EntitlementsDeps {
  loadPeriods?: (userId: string, now: Date) => Promise<PlanPeriod[]>;
  now?: () => Date;
  isAdmin?: (principal: Principal) => boolean;
}

function defaultIsAdmin(principal: Principal): boolean {
  try {
    return isAdminPrincipal(principal, getConfig());
  } catch {
    return false;
  }
}

const iso = (d: string | Date) => new Date(d).toISOString();
const headers = { 'Cache-Control': 'no-store' };

export async function buildEntitlements(principal: Principal, deps: EntitlementsDeps = {}): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))();
  const isAdmin = (deps.isAdmin ?? defaultIsAdmin)(principal);
  if (principal.demo) {
    return NextResponse.json(
      { plan: 'max', expiresAt: null, queued: [], used: 0, quota: planQuota('max'), resetAt: null, isAdmin },
      { headers },
    );
  }
  try {
    const periods = await (deps.loadPeriods ?? loadPeriods)(principal.userId, now);
    const plan = effectivePlan(periods, now);
    const active = activePeriod(periods, now);
    return NextResponse.json(
      {
        plan,
        expiresAt: active ? iso(active.endsAt) : null,
        queued: queuedPeriods(periods, now).map((p) => ({
          plan: p.plan,
          startsAt: iso(p.startsAt),
          endsAt: iso(p.endsAt),
        })),
        used: 0,
        quota: planQuota(plan),
        resetAt: null,
        isAdmin,
      },
      { headers },
    );
  } catch (err) {
    console.error('[entitlements] load failed:', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' },
      { status: 503, headers },
    );
  }
}
