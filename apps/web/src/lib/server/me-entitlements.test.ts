import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntitlements } from './me-entitlements';

const NOW = new Date('2026-11-11T00:00:00Z');
const user = { userId: 'u1', email: 'a@b.test', via: 'jwt' as const };

test('Free: used, quota and resetAt come from quotaWindow and the same count rule', async () => {
  let seen: { windowStart: Date } | null = null;
  const res = await buildEntitlements(user, {
    now: () => NOW,
    loadPeriods: async () => [],
    countUsed: async (a) => ((seen = a), 9),
    isAdmin: () => false,
  });
  const b = await res.json();
  assert.equal(b.plan, 'free');
  assert.equal(b.used, 9);
  assert.equal(b.quota, 14);
  assert.equal(b.resetAt, '2026-11-30T21:00:00.000Z');
  assert.equal(seen!.windowStart.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.match(res.headers.get('Server-Timing') ?? '', /^plan;dur=/);
});

test('Paid: cycle window and quota of the plan', async () => {
  const res = await buildEntitlements(user, {
    now: () => NOW,
    loadPeriods: async () => [{ id: 'p', plan: 'pro', startsAt: '2026-11-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' }],
    countUsed: async (a) => (assert.equal(a.windowStart.toISOString(), '2026-11-01T00:00:00.000Z'), 20),
    isAdmin: () => false,
  });
  const b = await res.json();
  assert.deepEqual([b.plan, b.used, b.quota, b.resetAt], ['pro', 20, 45, '2026-12-01T00:00:00.000Z']);
  assert.equal(b.expiresAt, '2027-01-01T00:00:00.000Z');
});

test('count failure is 503, never used: 0', async () => {
  const res = await buildEntitlements(user, {
    now: () => NOW,
    loadPeriods: async () => [],
    countUsed: async () => {
      throw new Error('db');
    },
    isAdmin: () => false,
  });
  assert.equal(res.status, 503);
});

test('plan check overhead with fast deps is well under 100 ms', async () => {
  const t = performance.now();
  await buildEntitlements(user, { now: () => NOW, loadPeriods: async () => [], countUsed: async () => 0, isAdmin: () => false });
  assert.ok(performance.now() - t < 100);
});
