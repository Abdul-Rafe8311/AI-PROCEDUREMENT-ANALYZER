// Single reader-side definition of the effective plan (AD-3). Pure; `now` is a parameter.
import type { PaidPlanId, PlanId } from './plans';

export interface PlanPeriod {
  id?: string;
  plan: PaidPlanId;
  startsAt: string | Date;
  endsAt: string | Date;
  voidedAt?: string | Date | null;
}

const ms = (d: string | Date): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** The one non-voided period with starts_at <= now < ends_at, else null. */
export function activePeriod<T extends PlanPeriod>(periods: T[], now: Date): T | null {
  const t = now.getTime();
  return periods.find((p) => !p.voidedAt && ms(p.startsAt) <= t && t < ms(p.endsAt)) ?? null;
}

export function effectivePlan(periods: PlanPeriod[], now: Date): PlanId {
  return activePeriod(periods, now)?.plan ?? 'free';
}

/** Non-voided periods starting after now, ordered by starts_at ascending. */
export function queuedPeriods<T extends PlanPeriod>(periods: T[], now: Date): T[] {
  const t = now.getTime();
  return periods
    .filter((p) => !p.voidedAt && ms(p.startsAt) > t)
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}
