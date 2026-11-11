import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntitlements } from '../../../../lib/server/me-entitlements';
import type { PlanPeriod } from '../../../../lib/entitlements/effective-plan';

const now = new Date('2026-11-11T00:00:00Z');
const user = { userId: 'u1', email: 'a@b.c', via: 'jwt' as const };
const run = (periods: PlanPeriod[] | Error, principal = user) =>
  buildEntitlements(principal, {
    now: () => now,
    isAdmin: () => false,
    countUsed: async () => 0,
    loadPeriods: async () => {
      if (periods instanceof Error) throw periods;
      return periods;
    },
  });

test('no period -> free', async () => {
  const r = await run([]);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { plan: 'free', expiresAt: null, queued: [], lastExpired: null, used: 0, quota: 14, resetAt: '2026-11-30T21:00:00.000Z', isAdmin: false });
});

test('expired -> free', async () => {
  const r = await run([{ plan: 'pro', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-11-11T00:00:00Z' }]);
  const b = await r.json();
  assert.equal(b.plan, 'free');
  assert.deepEqual(b.lastExpired, { plan: 'pro', endedAt: '2026-11-11T00:00:00.000Z' });
});

test('active plus queued ordered', async () => {
  const r = await run([
    { plan: 'max', startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' },
    { plan: 'pro', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
    { plan: 'plus', startsAt: '2026-12-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
  ]);
  const b = await r.json();
  assert.equal(b.plan, 'pro');
  assert.equal(b.quota, 45);
  assert.equal(b.expiresAt, '2026-12-01T00:00:00.000Z');
  assert.deepEqual(b.queued.map((q: { plan: string }) => q.plan), ['plus', 'max']);
  assert.equal(b.used, 0);
  assert.equal(b.resetAt, '2026-12-01T00:00:00.000Z');
});

test('demo principal -> max without DB call', async () => {
  const r = await run(new Error('must not be called'), { ...user, demo: true } as never);
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.plan, 'max');
  assert.equal(b.quota, 100);
});

test('DB failure -> 503 SERVICE_UNAVAILABLE', async () => {
  const r = await run(new Error('boom secret'));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' });
});

test('isAdmin comes from the server rule', async () => {
  const r = await buildEntitlements(user, { now: () => now, loadPeriods: async () => [], countUsed: async () => 0, isAdmin: () => true });
  assert.equal((await r.json()).isAdmin, true);
});

test('demo principal gets isAdmin false by default', async () => {
  const r = await buildEntitlements({ ...user, demo: true } as never, { now: () => now });
  assert.equal((await r.json()).isAdmin, false);
});
