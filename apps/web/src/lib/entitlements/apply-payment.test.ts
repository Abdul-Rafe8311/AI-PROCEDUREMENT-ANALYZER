import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyApproval, planApproval } from './apply-payment';
import { effectivePlan, queuedPeriods, type PlanPeriod } from './effective-plan';
import type { PaidPlanId } from './plans';

interface WriterCase {
  name: string;
  now: string;
  periods: PlanPeriod[];
  approve?: { plan: PaidPlanId };
  after?: {
    voided: string[];
    inserts: Array<{ plan: string; startsAt: string; endsAt: string }>;
    plan: string;
    queued: string[];
  };
}
const cases = (JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8')) as WriterCase[]).filter((c) => c.approve);

test('cases.json has writer cases for renewal, upgrade, queue and after-expiry', () => {
  assert.ok(cases.length >= 8);
  for (const word of ['renewal', 'upgrade', 'queued', 'after expiry']) {
    assert.ok(cases.some((c) => c.name.includes(word)), `no writer case mentions "${word}"`);
  }
});

for (const c of cases) {
  test(`planApproval: ${c.name}`, () => {
    const now = new Date(c.now);
    const a = planApproval(c.periods, c.approve!.plan, now);
    assert.deepEqual(a.voidIds, c.after!.voided);
    const norm = (i: { plan: string; startsAt: string; endsAt: string }) => ({
      plan: i.plan,
      startsAt: new Date(i.startsAt).toISOString(),
      endsAt: new Date(i.endsAt).toISOString(),
    });
    assert.deepEqual(a.inserts, c.after!.inserts.map(norm));
  });

  test(`reader after approval agrees: ${c.name}`, () => {
    const now = new Date(c.now);
    const next = applyApproval(c.periods, c.approve!.plan, now);
    assert.equal(effectivePlan(next, now), c.after!.plan);
    assert.deepEqual(queuedPeriods(next, now).map((p) => p.plan), c.after!.queued);
    // no two non-voided periods overlap (the DB exclusion constraint)
    const live = next.filter((p) => !p.voidedAt).sort((x, y) => +new Date(x.startsAt) - +new Date(y.startsAt));
    for (let i = 1; i < live.length; i++) {
      assert.ok(+new Date(live[i - 1].endsAt) <= +new Date(live[i].startsAt), `overlap in "${c.name}"`);
    }
  });
}

test('every payment period is exactly 30 days', () => {
  for (const c of cases) {
    const first = planApproval(c.periods, c.approve!.plan, new Date(c.now)).inserts[0];
    assert.equal(+new Date(first.endsAt) - +new Date(first.startsAt), 30 * 864e5);
  }
});

test('an upgrade forfeits only the current period: paid queued days are kept', () => {
  const c = cases.find((x) => x.name.includes('shorter than 30 days'))!;
  const a = planApproval(c.periods, c.approve!.plan, new Date(c.now));
  const queuedLen = (p: { startsAt: string; endsAt: string }) => +new Date(p.endsAt) - +new Date(p.startsAt);
  assert.equal(queuedLen(a.inserts[1]), queuedLen(c.periods[1] as never));
});
