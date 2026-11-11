import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminUsersGet, buildAdminUsersPost } from './admin-users';
import { DbUnavailableError, InvalidAdminPlanError } from './db';

const NOW = new Date('2026-11-11T00:00:00Z');
const UID = '11111111-1111-4111-8111-111111111111';
const principal = { userId: 'a', email: 'boss@x.test', via: 'jwt' as const };
const post = (body: unknown) =>
  new Request('http://x/api/admin/users', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const fail = async () => {
  throw new Error('db should not be called');
};

test('POST bad input gives 400 VALIDATION with fields and no DB call', async () => {
  for (const [body, field] of [
    [{ userId: UID, plan: 'pro', endsAt: '2020-01-01T00:00:00Z' }, 'endsAt'],
    [{ userId: UID, plan: 'free', endsAt: '2027-01-01T00:00:00Z' }, 'plan'],
    [{ userId: UID, plan: 'zzz', endsAt: '2027-01-01T00:00:00Z' }, 'plan'],
    [{ plan: 'pro', endsAt: '2027-01-01T00:00:00Z' }, 'userId'],
    [{ userId: UID, plan: 'pro', endsAt: 'nope' }, 'endsAt'],
    ['not json', 'userId'],
  ] as const) {
    const res = await buildAdminUsersPost(post(body), principal, { now: () => NOW, userExists: fail, setPlan: fail });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.code, 'VALIDATION');
    assert.ok(field in j.fields);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('POST success uses principal email, ignores body email', async () => {
  let seen: unknown;
  const res = await buildAdminUsersPost(
    post({ userId: UID, plan: 'pro', endsAt: '2027-01-01T00:00:00Z', adminEmail: 'evil@x.test' }),
    principal,
    { now: () => NOW, userExists: async () => true, setPlan: async (a) => ((seen = a), 'pid') },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { periodId: 'pid', plan: 'pro', endsAt: '2027-01-01T00:00:00.000Z' });
  assert.equal((seen as { adminEmail: string }).adminEmail, 'boss@x.test');
});

test('POST unknown user gives 404 NOT_FOUND', async () => {
  const res = await buildAdminUsersPost(post({ userId: UID, plan: 'pro', endsAt: '2027-01-01T00:00:00Z' }), principal, {
    now: () => NOW, userExists: async () => false, setPlan: fail,
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NOT_FOUND');
});

test('POST service failure gives 503, SQL exception maps to 400', async () => {
  const body = { userId: UID, plan: 'pro', endsAt: '2027-01-01T00:00:00Z' };
  const a = await buildAdminUsersPost(post(body), principal, {
    now: () => NOW, userExists: async () => true, setPlan: async () => { throw new DbUnavailableError('secret-detail'); },
  });
  assert.equal(a.status, 503);
  const j = await a.json();
  assert.equal(j.code, 'SERVICE_UNAVAILABLE');
  assert.ok(!JSON.stringify(j).includes('secret-detail'));
  const b = await buildAdminUsersPost(post(body), principal, {
    now: () => NOW, userExists: async () => true, setPlan: async () => { throw new InvalidAdminPlanError('ends_at_not_future'); },
  });
  assert.equal(b.status, 400);
  assert.equal((await b.json()).code, 'VALIDATION');
});

test('GET passes search and returns users with no-store', async () => {
  let s = '';
  const rows = [{ id: 'u1', email: 'n@x.test', createdAt: 'c', plan: 'pro', expiresAt: null, lastChange: { adminEmail: 'boss@x.test', at: '2026-11-02T00:00:00.000Z', plan: 'pro', endsAt: null } }];
  const res = await buildAdminUsersGet(new Request('http://x/api/admin/users?search=naj'), {
    now: () => NOW, listUsers: async (q) => ((s = q), rows),
  });
  assert.equal(s, 'naj');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { users: rows });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET failure gives 503', async () => {
  const res = await buildAdminUsersGet(new Request('http://x/api/admin/users'), {
    listUsers: async () => { throw new DbUnavailableError('x'); },
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'SERVICE_UNAVAILABLE');
});
