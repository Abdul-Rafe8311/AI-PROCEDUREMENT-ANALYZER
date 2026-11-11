import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireFeature } from './guard';
import type { PlanPeriod } from '../entitlements/effective-plan';

const NOW = new Date('2026-11-11T12:00:00Z');
const configured = () => ({ production: true, allowDemo: false, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' });
const req = (auth = 'Bearer good') => new Request('http://localhost/api/x', { headers: { authorization: auth } });
const verify = async () => ({ user: { id: 'u1', email: 'a@b.test' }, error: null });
const period = (plan: PlanPeriod['plan'], startDay: number, endDay: number): PlanPeriod => ({
  id: `p-${plan}-${startDay}`,
  plan,
  startsAt: new Date(NOW.getTime() + startDay * 864e5).toISOString(),
  endsAt: new Date(NOW.getTime() + endDay * 864e5).toISOString(),
  voidedAt: null,
});
const run = (feature: 'chat' | 'tender_sheet', periods: PlanPeriod[]) =>
  requireFeature(req(), feature, { config: configured, verify, now: () => NOW, loadPeriods: async () => periods });

const matrix: Array<[string, PlanPeriod[], boolean, boolean]> = [
  ['free', [], false, false],
  ['plus', [period('plus', -5, 25)], true, false],
  ['pro', [period('pro', -5, 25)], true, true],
  ['max', [period('max', -5, 25)], true, true],
  ['expired pro falls to free', [period('pro', -40, -10)], false, false],
  ['queued pro not yet started', [period('plus', -5, 25), period('pro', 25, 55)], true, false],
];

for (const [name, periods, chat, tender] of matrix) {
  test(`${name}: chat=${chat} tender_sheet=${tender}`, async () => {
    assert.equal((await run('chat', periods)).ok, chat);
    assert.equal((await run('tender_sheet', periods)).ok, tender);
  });
}

test('denial is 403 PLAN_REQUIRED with feature and requiredPlan', async () => {
  const c = await run('chat', []);
  assert.ok(!c.ok);
  if (!c.ok) {
    assert.equal(c.response.status, 403);
    const b = await c.response.json();
    assert.equal(b.code, 'PLAN_REQUIRED');
    assert.equal(b.feature, 'chat');
    assert.equal(b.requiredPlan, 'plus');
  }
  const t = await run('tender_sheet', [period('plus', -1, 29)]);
  assert.ok(!t.ok);
  if (!t.ok) assert.deepEqual({ ...(await t.response.json()) }, {
    error: 'This feature needs the pro plan or higher.', code: 'PLAN_REQUIRED', feature: 'tender_sheet', requiredPlan: 'pro',
  });
});

test('no token gives 401 and never loads periods', async () => {
  let loaded = false;
  const r = await requireFeature(new Request('http://localhost/x'), 'chat', {
    config: configured, verify, loadPeriods: async () => { loaded = true; return []; },
  });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 401);
  assert.equal(loaded, false);
});

test('a plan change applies on the very next call (no cache)', async () => {
  let periods: PlanPeriod[] = [];
  const deps = { config: configured, verify, now: () => NOW, loadPeriods: async () => periods };
  assert.equal((await requireFeature(req(), 'chat', deps)).ok, false);
  periods = [period('plus', 0, 30)];
  assert.equal((await requireFeature(req(), 'chat', deps)).ok, true);
});

test('database failure fails closed with 503', async () => {
  const r = await requireFeature(req(), 'chat', {
    config: configured, verify, loadPeriods: async () => { throw new Error('db down'); },
  });
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 503);
});

test('demo principal passes without a database read', async () => {
  const r = await requireFeature(new Request('http://localhost/x'), 'tender_sheet', {
    config: () => ({ production: false, allowDemo: true, supabaseUrl: '', supabaseAnonKey: '' }),
    loadPeriods: async () => { throw new Error('should not run'); },
  });
  assert.ok(r.ok);
});
