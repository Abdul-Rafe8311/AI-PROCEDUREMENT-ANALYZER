import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanPeriod } from './effective-plan';
import { quotaWindow } from './quota-window';

interface Case {
  name: string;
  now: string;
  periods: PlanPeriod[];
  expected: { periodId: string | null; plan: string; quota: number; windowStart: string; resetAt: string };
}
const cases: Case[] = JSON.parse(readFileSync(join(__dirname, 'quota-window-cases.json'), 'utf8'));

for (const c of cases) {
  test(`quotaWindow: ${c.name}`, () => {
    const w = quotaWindow(c.periods, new Date(c.now));
    assert.equal(w.periodId, c.expected.periodId);
    assert.equal(w.plan, c.expected.plan);
    assert.equal(w.quota, c.expected.quota);
    assert.equal(w.windowStart.toISOString(), new Date(c.expected.windowStart).toISOString());
    assert.equal(w.resetAt.toISOString(), new Date(c.expected.resetAt).toISOString());
  });
}
