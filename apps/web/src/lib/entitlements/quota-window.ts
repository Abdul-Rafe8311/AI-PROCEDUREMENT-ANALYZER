// The only quota-window definition (AD-5). Pure: `now` is a parameter. Riyadh time
// (UTC+3, no DST) appears only in this module.
import { activePeriod, type PlanPeriod } from './effective-plan';
import { planQuota, type PlanId } from './plans';

export interface QuotaWindow {
  /** id of the active paid period; null on Free. Passed to reserve_pdf_quota as expected_period_id. */
  periodId: string | null;
  plan: PlanId;
  quota: number;
  windowStart: Date;
  resetAt: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const CYCLE = 30 * DAY;
const RIYADH_OFFSET = 3 * 60 * 60 * 1000;
const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Start (UTC instant) of the Riyadh calendar month containing `t`, plus `monthsAhead` months. */
function riyadhMonthStart(t: number, monthsAhead = 0): number {
  const local = new Date(t + RIYADH_OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + monthsAhead, 1) - RIYADH_OFFSET;
}

export function quotaWindow(periods: PlanPeriod[], now: Date): QuotaWindow {
  const t = now.getTime();
  const active = activePeriod(periods, now);
  if (active) {
    const start = ms(active.startsAt);
    const cycle = Math.floor((t - start) / CYCLE);
    const windowStart = start + cycle * CYCLE;
    return {
      periodId: active.id ?? null,
      plan: active.plan,
      quota: planQuota(active.plan),
      windowStart: new Date(windowStart),
      resetAt: new Date(Math.min(windowStart + CYCLE, ms(active.endsAt))),
    };
  }
  const monthStart = riyadhMonthStart(t);
  let windowStart = monthStart;
  for (const p of periods) {
    if (p.voidedAt) continue;
    const end = ms(p.endsAt);
    if (end <= t && end >= monthStart && end > windowStart) windowStart = end;
  }
  return {
    periodId: null,
    plan: 'free',
    quota: planQuota('free'),
    windowStart: new Date(windowStart),
    resetAt: new Date(riyadhMonthStart(t, 1)),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Dec 2026", the calendar date in Riyadh time (the quota calendar), for reset and expiry copy. */
export function formatQuotaDate(d: string | Date): string {
  const local = new Date((d instanceof Date ? d.getTime() : new Date(d).getTime()) + RIYADH_OFFSET);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}
