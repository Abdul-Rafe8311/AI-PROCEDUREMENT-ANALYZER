// Response builder for GET /api/me/entitlements, with injectable deps for tests.
import { NextResponse } from 'next/server';
import { activePeriod, effectivePlan, queuedPeriods, type PlanPeriod } from '../entitlements/effective-plan';
import { planQuota } from '../entitlements/plans';
import { quotaWindow } from '../entitlements/quota-window';
import { loadPeriods } from './db';
import { countUsed } from './usage';
import { getConfig } from './config';
import { isAdminPrincipal, type Principal } from './guard';

export interface EntitlementsDeps {
  loadPeriods?: (userId: string, now: Date) => Promise<PlanPeriod[]>;
  countUsed?: (args: { userId: string; windowStart: Date; now: Date }) => Promise<number>;
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

/** Most recent non-voided period that has already ended (for the one-time "plan ended" notice). */
function lastExpired(periods: PlanPeriod[], now: Date): { plan: string; endedAt: string } | null {
  let best: PlanPeriod | null = null;
  for (const p of periods) {
    if (p.voidedAt || new Date(p.endsAt).getTime() > now.getTime()) continue;
    if (!best || new Date(p.endsAt).getTime() > new Date(best.endsAt).getTime()) best = p;
  }
  return best ? { plan: best.plan, endedAt: new Date(best.endsAt).toISOString() } : null;
}

const iso = (d: string | Date) => new Date(d).toISOString();
const headers = { 'Cache-Control': 'no-store' };

export async function buildEntitlements(principal: Principal, deps: EntitlementsDeps = {}): Promise<Response> {
  const started = performance.now();
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
    // Same window and count rule as the gate in /api/extract (FR6).
    const win = quotaWindow(periods, now);
    const used = await (deps.countUsed ?? countUsed)({ userId: principal.userId, windowStart: win.windowStart, now });
    const ms = performance.now() - started;
    if (ms > 100) console.warn(`[entitlements] slow plan check: ${Math.round(ms)}ms`);
    return NextResponse.json(
      {
        plan,
        expiresAt: active ? iso(active.endsAt) : null,
        queued: queuedPeriods(periods, now).map((p) => ({
          plan: p.plan,
          startsAt: iso(p.startsAt),
          endsAt: iso(p.endsAt),
        })),
        lastExpired: lastExpired(periods, now),
        used,
        quota: win.quota,
        resetAt: win.resetAt.toISOString(),
        isAdmin,
      },
      { headers: { ...headers, 'Server-Timing': `plan;dur=${ms.toFixed(1)}` } },
    );
  } catch (err) {
    console.error('[entitlements] load failed:', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' },
      { status: 503, headers },
    );
  }
}
