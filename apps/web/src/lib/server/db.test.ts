import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPeriods, DbUnavailableError } from './db';

function fakeClient(result: { data?: unknown; error?: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) {
    q[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return m === 'limit' ? Promise.resolve(result) : q;
    };
  }
  return { calls, client: { from: (t: string) => (calls.push(['from', t]), q) } as never };
}

const NOW = new Date('2026-11-11T00:00:00Z');

test('loadPeriods maps rows and filters voided and old periods', async () => {
  const { calls, client } = fakeClient({
    data: [{ plan: 'pro', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', voided_at: null }],
  });
  const out = await loadPeriods('u1', NOW, client);
  assert.deepEqual(out, [
    { plan: 'pro', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', voidedAt: null },
  ]);
  assert.deepEqual(calls.find((c) => c[0] === 'from'), ['from', 'plan_periods']);
  assert.deepEqual(calls.find((c) => c[0] === 'eq'), ['eq', 'user_id', 'u1']);
  assert.deepEqual(calls.find((c) => c[0] === 'is'), ['is', 'voided_at', null]);
  assert.deepEqual(calls.find((c) => c[0] === 'gte'), ['gte', 'ends_at', '2026-09-10T00:00:00.000Z']);
});

test('loadPeriods maps a query error to DbUnavailableError', async () => {
  const { client } = fakeClient({ error: { message: 'boom' } });
  await assert.rejects(() => loadPeriods('u1', NOW, client), DbUnavailableError);
});
