import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectivePlan, queuedPeriods, type PlanPeriod } from './effective-plan';
import { hasChatAccess, hasTenderSheetAccess, planQuota, planRank } from './plans';

interface Case {
  name: string;
  now: string;
  periods: PlanPeriod[];
  expected: { plan: string; queued: string[] };
}
const cases: Case[] = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));

for (const c of cases) {
  test(`effectivePlan: ${c.name}`, () => {
    const now = new Date(c.now);
    assert.equal(effectivePlan(c.periods, now), c.expected.plan);
    assert.deepEqual(queuedPeriods(c.periods, now).map((p) => p.plan), c.expected.queued);
  });
}

test('plans matrix', () => {
  assert.deepEqual(['free', 'plus', 'pro', 'max'].map((p) => planQuota(p as never)), [14, 30, 45, 100]);
  assert.ok(planRank('free') < planRank('plus') && planRank('plus') < planRank('pro') && planRank('pro') < planRank('max'));
  assert.deepEqual(['free', 'plus', 'pro', 'max'].map((p) => hasChatAccess(p as never)), [false, true, true, true]);
  assert.deepEqual(['free', 'plus', 'pro', 'max'].map((p) => hasTenderSheetAccess(p as never)), [false, false, true, true]);
});
