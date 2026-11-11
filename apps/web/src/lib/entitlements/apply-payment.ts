// Writer-side approval rule (AD-3), mirrored from SQL decide_payment_request in 0011. Pure: the SQL
// function is the real writer; this exists so cases.json can pin both sides to the same expectations
// and so the Admin queue can preview the resulting expiry ("active from today until ...").
import type { PaidPlanId } from './plans';
import { PLAN_RANK } from './plans';
import { activePeriod, type PlanPeriod } from './effective-plan';

export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface PeriodInsert {
  plan: PaidPlanId;
  startsAt: string;
  endsAt: string;
}

export interface ApprovalPlan {
  /** ids of non-voided periods that get voided */
  voidIds: string[];
  /** rows inserted, in order: the new payment period first, then re-chained queued periods */
  inserts: PeriodInsert[];
  upgrade: boolean;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function planApproval(periods: PlanPeriod[], plan: PaidPlanId, now: Date): ApprovalPlan {
  const live = periods.filter((p) => !p.voidedAt);
  const nowMs = now.getTime();
  const cur = activePeriod(live, now);

  if (cur && PLAN_RANK[plan] > PLAN_RANK[cur.plan]) {
    const queued = live
      .filter((p) => new Date(p.startsAt).getTime() > nowMs)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const inserts: PeriodInsert[] = [{ plan, startsAt: iso(nowMs), endsAt: iso(nowMs + PERIOD_MS) }];
    let cursor = nowMs + PERIOD_MS;
    for (const q of queued) {
      const len = new Date(q.endsAt).getTime() - new Date(q.startsAt).getTime();
      inserts.push({ plan: q.plan, startsAt: iso(cursor), endsAt: iso(cursor + len) });
      cursor += len;
    }
    return { voidIds: [cur.id ?? "", ...queued.map((q) => q.id ?? "")], inserts, upgrade: true };
  }

  const chainEnd = Math.max(nowMs, ...live.map((p) => new Date(p.endsAt).getTime()));
  return { voidIds: [], inserts: [{ plan, startsAt: iso(chainEnd), endsAt: iso(chainEnd + PERIOD_MS) }], upgrade: false };
}

/** The period set after applying an approval, for reader-side assertions. */
export function applyApproval(periods: PlanPeriod[], plan: PaidPlanId, now: Date): PlanPeriod[] {
  const a = planApproval(periods, plan, now);
  const voided = new Set(a.voidIds);
  const kept = periods.map((p) => (p.id && voided.has(p.id) ? { ...p, voidedAt: now.toISOString() } : p));
  const added = a.inserts.map((i, n) => ({ id: `new-${n}`, plan: i.plan, startsAt: i.startsAt, endsAt: i.endsAt, voidedAt: null }));
  return [...kept, ...added];
}
