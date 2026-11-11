import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveForExtract, settleExtract } from './extract-quota';
import type { ReserveResult } from './usage';

const NOW = new Date('2026-11-11T00:00:00Z');
const user = { userId: 'u1', email: null, via: 'api_key' as const };
const base = { now: () => NOW, loadPeriods: async () => [] };

test('Free user with room: reserves, passes window and quota 14 to SQL', async () => {
  let seen: Record<string, unknown> = {};
  const r = await reserveForExtract(user, ['a'], {
    ...base,
    reserve: async (a) => ((seen = a as never), { status: 'OK', quota: 14, used: 14, remaining: 0, reserved: ['a'], free: [] }),
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.ticket?.reserved, ['a']);
  assert.equal(seen.quota, 14);
  assert.equal(seen.expectedPeriodId, null);
  assert.equal((seen.windowStart as Date).toISOString(), '2026-10-31T21:00:00.000Z');
});

test('quota exceeded: 429 QUOTA_EXCEEDED with plan, quota, remaining, resetAt', async () => {
  const r = await reserveForExtract(user, ['a', 'b', 'c', 'd', 'e'], {
    ...base,
    reserve: async () => ({ status: 'QUOTA_EXCEEDED', quota: 14, used: 13, remaining: 1 }),
  });
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.response.status, 429);
    assert.deepEqual(await r.response.json(), {
      error: 'Upload limit reached for your plan.',
      code: 'QUOTA_EXCEEDED',
      plan: 'free',
      quota: 14,
      remaining: 1,
      resetAt: '2026-11-30T21:00:00.000Z',
    });
  }
});

test('paid plan uses its period id and quota', async () => {
  let seen: Record<string, unknown> = {};
  await reserveForExtract(user, ['a'], {
    now: () => NOW,
    loadPeriods: async () => [{ id: 'p1', plan: 'pro', startsAt: '2026-11-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' }],
    reserve: async (a) => ((seen = a as never), { status: 'OK', quota: 45, used: 1, remaining: 44, reserved: ['a'], free: [] }),
  });
  assert.equal(seen.quota, 45);
  assert.equal(seen.expectedPeriodId, 'p1');
});

test('STALE is retried once with recomputed window, then succeeds', async () => {
  let calls = 0;
  let loads = 0;
  const r = await reserveForExtract(user, ['a'], {
    now: () => NOW,
    loadPeriods: async () => (++loads, []),
    reserve: async (): Promise<ReserveResult> =>
      ++calls === 1 ? { status: 'STALE' } : { status: 'OK', quota: 14, used: 1, remaining: 13, reserved: ['a'], free: [] },
  });
  assert.ok(r.ok);
  assert.equal(calls, 2);
  assert.equal(loads, 2);
});

test('STALE twice gives 503, never a free pass', async () => {
  const r = await reserveForExtract(user, ['a'], { ...base, reserve: async () => ({ status: 'STALE' }) });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 503);
});

test('database failure fails closed with 503', async () => {
  const r = await reserveForExtract(user, ['a'], {
    ...base,
    reserve: async () => {
      throw new Error('db');
    },
  });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 503);
});

test('demo principal and empty hash list skip quota entirely', async () => {
  const never = async () => {
    throw new Error('must not run');
  };
  const d = await reserveForExtract({ userId: 'demo-user', email: null, via: 'jwt', demo: true }, ['a'], { reserve: never });
  assert.ok(d.ok && d.ticket === null);
  const e = await reserveForExtract(user, [], { reserve: never });
  assert.ok(e.ok && e.ticket === null);
});

test('settle confirms successes and releases failures; free hashes untouched', async () => {
  const log: string[] = [];
  await settleExtract(
    { userId: 'u1', windowStart: NOW, reserved: ['ok', 'bad'] },
    new Set(['ok', 'other']),
    { confirm: async (a) => void log.push(`confirm:${a.hash}`), release: async (a) => void log.push(`release:${a.hash}`) },
  );
  assert.deepEqual(log.sort(), ['confirm:ok', 'release:bad']);
});

test('settle never throws when an RPC fails, and null ticket is a no-op', async () => {
  await settleExtract({ userId: 'u', windowStart: NOW, reserved: ['a'] }, new Set(), {
    release: async () => {
      throw new Error('x');
    },
  });
  await settleExtract(null, new Set(), {});
});
