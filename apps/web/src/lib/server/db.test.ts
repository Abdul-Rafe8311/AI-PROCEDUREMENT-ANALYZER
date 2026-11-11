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

import { adminSetPlan, listUsersWithPlans, userExists, InvalidAdminPlanError } from './db';

test('adminSetPlan passes args to rpc and returns id', async () => {
  let seen: unknown[] = [];
  const client = { rpc: async (...a: unknown[]) => ((seen = a), { data: 'pid-1', error: null }) } as never;
  const id = await adminSetPlan({ userId: 'u', plan: 'pro', endsAt: '2027-01-01T00:00:00.000Z', adminEmail: 'a@b.test' }, client);
  assert.equal(id, 'pid-1');
  assert.deepEqual(seen, ['admin_set_plan', { p_user_id: 'u', p_plan: 'pro', p_ends_at: '2027-01-01T00:00:00.000Z', p_admin_email: 'a@b.test' }]);
});

test('adminSetPlan maps SQL exceptions', async () => {
  const mk = (message: string) => ({ rpc: async () => ({ data: null, error: { message } }) }) as never;
  const args = { userId: 'u', plan: 'pro', endsAt: 'x', adminEmail: 'a' };
  await assert.rejects(() => adminSetPlan(args, mk('invalid_plan')), InvalidAdminPlanError);
  await assert.rejects(() => adminSetPlan(args, mk('ends_at_not_future')), InvalidAdminPlanError);
  await assert.rejects(() => adminSetPlan(args, mk('boom')), DbUnavailableError);
});

test('userExists handles found, 404 and failure', async () => {
  const mk = (r: unknown) => ({ auth: { admin: { getUserById: async () => r } } }) as never;
  assert.equal(await userExists('u', mk({ data: { user: { id: 'u' } }, error: null })), true);
  assert.equal(await userExists('u', mk({ data: { user: null }, error: { status: 404 } })), false);
  await assert.rejects(() => userExists('u', mk({ data: null, error: { status: 500 } })), DbUnavailableError);
});

function listClient(users: unknown[], periods: unknown[], audit: unknown[], calls: unknown[][] = []) {
  const mk = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'is', 'gte', 'eq', 'order', 'limit']) {
      q[m] = (...a: unknown[]) => {
        calls.push([m, ...a]);
        return m === 'limit' ? Promise.resolve({ data: table === 'audit_log' ? audit : periods, error: null }) : q;
      };
    }
    return q;
  };
  return {
    auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
    from: (t: string) => (calls.push(['from', t]), mk(t)),
  } as never;
}

test('listUsersWithPlans filters by email, computes plan and lastChange with batched queries', async () => {
  const calls: unknown[][] = [];
  const client = listClient(
    [
      { id: 'u1', email: 'Najran@x.test', created_at: 'c1' },
      { id: 'u2', email: 'other@x.test', created_at: 'c2' },
    ],
    [{ user_id: 'u1', plan: 'pro', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', voided_at: null }],
    [
      { actor_email: 'boss@x.test', subject_user_id: 'u1', detail: { plan: 'pro', ends_at: '2026-12-01T00:00:00Z' }, created_at: '2026-11-02T00:00:00Z' },
      { actor_email: 'old@x.test', subject_user_id: 'u1', detail: { plan: 'plus', ends_at: '2026-10-01T00:00:00Z' }, created_at: '2026-10-02T00:00:00Z' },
    ],
    calls,
  );
  const out = await listUsersWithPlans('naj', NOW, client);
  assert.deepEqual(out, [
    {
      id: 'u1', email: 'Najran@x.test', createdAt: 'c1', plan: 'pro', expiresAt: '2026-12-01T00:00:00.000Z',
      lastChange: { adminEmail: 'boss@x.test', at: '2026-11-02T00:00:00.000Z', plan: 'pro', endsAt: '2026-12-01T00:00:00.000Z' },
    },
  ]);
  assert.deepEqual(calls.filter((c) => c[0] === 'from'), [['from', 'plan_periods'], ['from', 'audit_log']]);
  assert.deepEqual(calls.find((c) => c[0] === 'eq'), ['eq', 'action', 'admin_set_plan']);
  assert.deepEqual(calls.find((c) => c[0] === 'order'), ['order', 'created_at', { ascending: false }]);
  assert.ok(calls.some((c) => c[0] === 'in' && c[1] === 'subject_user_id' && JSON.stringify(c[2]) === '["u1"]'));
});

test('listUsersWithPlans: user without audit row has lastChange null', async () => {
  const out = await listUsersWithPlans('', NOW, listClient([{ id: 'u1', email: 'a@x.test' }], [], []));
  assert.equal(out[0].lastChange, null);
});

test('listUsersWithPlans caps at 50 and errors map to DbUnavailableError', async () => {
  const users = Array.from({ length: 80 }, (_, i) => ({ id: `u${i}`, email: `a${i}@x.test` }));
  assert.equal((await listUsersWithPlans('', NOW, listClient(users, [], []))).length, 50);
  const bad = { auth: { admin: { listUsers: async () => ({ data: null, error: { message: 'x' } }) } } } as never;
  await assert.rejects(() => listUsersWithPlans('', NOW, bad), DbUnavailableError);
});
