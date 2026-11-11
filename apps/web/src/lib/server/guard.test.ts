import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirePrincipal } from './guard';

const configured = () => ({ production: true, allowDemo: false, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' });
const req = (auth?: string) =>
  new Request('http://localhost/api/x', { headers: auth ? { authorization: auth } : {} });
const never = async () => {
  throw new Error('verify should not run');
};

test('valid token returns principal from verified user only', async () => {
  const r = await requirePrincipal(req('Bearer good'), {
    config: configured,
    verify: async (t) => ({ user: t === 'good' ? { id: 'u1', email: 'a@b.test' } : null, error: null }),
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.principal, { userId: 'u1', email: 'a@b.test', via: 'jwt' });
});

for (const [name, header] of [['missing', undefined], ['malformed', 'Token abc'], ['empty bearer', 'Bearer ']] as const) {
  test(`${name} header gives 401 UNAUTHENTICATED`, async () => {
    const r = await requirePrincipal(req(header), { config: configured, verify: never });
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.response.status, 401);
      assert.equal((await r.response.json()).code, 'UNAUTHENTICATED');
    }
  });
}

test('getUser error or no user gives 401', async () => {
  for (const res of [{ user: null, error: new Error('bad') }, { user: null, error: null }]) {
    const r = await requirePrincipal(req('Bearer t'), { config: configured, verify: async () => res });
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.response.status, 401);
  }
});

test('demo principal only when Supabase env absent and ALLOW_DEMO is set', async () => {
  const r = await requirePrincipal(req(), {
    config: () => ({ production: false, allowDemo: true, supabaseUrl: null, supabaseAnonKey: null }),
    verify: never,
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.principal.demo, true);
});

test('production without Supabase env returns 503, never a principal', async () => {
  const r = await requirePrincipal(req('Bearer anything'), {
    config: () => ({ production: true, allowDemo: false, supabaseUrl: null, supabaseAnonKey: null }),
    verify: never,
  });
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.response.status, 503);
    assert.equal((await r.response.json()).code, 'SERVICE_UNAVAILABLE');
  }
});

test('production config error returns 503', async () => {
  const { ConfigError } = await import('./config');
  const r = await requirePrincipal(req(), {
    config: () => {
      throw new ConfigError('boom');
    },
  });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 503);
});

test('verifier throwing, 5xx and transport errors give 503; invalid token stays 401', async () => {
  const cases: [() => Promise<{ user: null; error: unknown }>, number][] = [
    [async () => { throw new Error('net'); }, 503],
    [async () => ({ user: null, error: { status: 502, name: 'AuthApiError' } }), 503],
    [async () => ({ user: null, error: { name: 'AuthRetryableFetchError' } }), 503],
    [async () => ({ user: null, error: { status: 401, name: 'AuthApiError' } }), 401],
  ];
  for (const [verify, status] of cases) {
    const r = await requirePrincipal(req('Bearer t'), { config: configured, verify });
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.response.status, status);
      assert.equal((await r.response.json()).code, status === 503 ? 'SERVICE_UNAVAILABLE' : 'UNAUTHENTICATED');
    }
  }
});

test('no ALLOW_DEMO means no demo principal, whatever NODE_ENV is', async () => {
  for (const production of [false, true]) {
    const r = await requirePrincipal(req(), {
      config: () => ({ production, allowDemo: false, supabaseUrl: null, supabaseAnonKey: null }),
      verify: never,
    });
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.response.status, 503);
  }
});

test('partial Supabase config gives 503 even with ALLOW_DEMO; demo only when both missing and allowed', async () => {
  const mk = (allowDemo: boolean, supabaseUrl: string | null, supabaseAnonKey: string | null) =>
    requirePrincipal(req(), { config: () => ({ production: false, allowDemo, supabaseUrl, supabaseAnonKey }), verify: never });
  for (const r of [
    await mk(true, 'https://x.supabase.co', null),
    await mk(true, null, 'k'),
    await mk(false, null, null),
  ]) {
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.response.status, 503);
  }
  const demo = await mk(true, null, null);
  assert.ok(demo.ok);
  if (demo.ok) assert.equal(demo.principal.demo, true);
});
