import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETENTION_BATCH,
  purgeOldScreenshots,
  retentionCutoff,
  runDailyJob,
  sendExpiryReminders,
  windowEnd,
  type ExpiringPeriod,
  type ExpiryStore,
  type RetentionStore,
  type SendFn,
} from './daily-job';
import { ALREADY_CLAIMED } from './email';

const NOW = new Date('2026-12-08T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const period = (id: string, userId: string, days: number): ExpiringPeriod => ({ id, userId, plan: 'pro', endsAt: at(days) });

function expiry(periods: ExpiringPeriod[], later: Array<{ userId: string; startsAt: string }> = [], emails: Record<string, string | null> = {}): ExpiryStore & { windows: Date[][] } {
  const windows: Date[][] = [];
  return {
    windows,
    async expiring(n, w) { windows.push([n, w]); return periods; },
    async renewedUsers() { return later; },
    async emailFor(u) { return u in emails ? emails[u] : `${u}@example.test`; },
  };
}
const ok: SendFn = async () => ({ ok: true, status: 'sent' });

test('window is now + 3 days', () => {
  assert.equal(windowEnd(NOW).toISOString(), '2026-12-11T06:00:00.000Z');
});

test('a qualifying period gets one expiry_reminder with its period id as subject', async () => {
  const calls: Array<{ t: string; to: string; subjectId: string; data: Record<string, unknown> }> = [];
  const send: SendFn = async (t, to, data, o) => { calls.push({ t, to, subjectId: o.subjectId, data: data as Record<string, unknown> }); return { ok: true, status: 'sent' }; };
  const s = await sendExpiryReminders(NOW, expiry([period('p1', 'u1', 2)]), send, 'https://app.example.test');
  assert.deepEqual(s, { considered: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(calls[0].t, 'expiry_reminder');
  assert.equal(calls[0].to, 'u1@example.test');
  assert.equal(calls[0].subjectId, 'p1');
  assert.equal(calls[0].data.plansUrl, 'https://app.example.test/plans');
  assert.equal(calls[0].data.plan, 'pro');
});

test('a period renewed (next period starts at or after ends_at) is skipped; an earlier-starting one is not a renewal', async () => {
  const p = period('p1', 'u1', 2);
  let sent = 0;
  const send: SendFn = async () => { sent++; return { ok: true, status: 'sent' }; };
  const renewed = await sendExpiryReminders(NOW, expiry([p], [{ userId: 'u1', startsAt: p.endsAt }]), send);
  assert.deepEqual(renewed, { considered: 1, sent: 0, failed: 0, skipped: 1 });
  const own = await sendExpiryReminders(NOW, expiry([p], [{ userId: 'u1', startsAt: at(-5) }]), send);
  assert.equal(own.sent, 1);
  const other = await sendExpiryReminders(NOW, expiry([p], [{ userId: 'u2', startsAt: p.endsAt }]), send);
  assert.equal(other.sent, 1);
  assert.equal(sent, 2);
});

test('already-claimed reminders are skipped, failed sends are counted and do not stop the rest', async () => {
  const outcomes = [
    { ok: false, status: 'failed' as const, error: ALREADY_CLAIMED },
    { ok: false, status: 'failed' as const, error: 'domain is not verified' },
    { ok: true, status: 'sent' as const },
  ];
  let i = 0;
  const send: SendFn = async () => outcomes[i++];
  const s = await sendExpiryReminders(NOW, expiry([period('a', 'u1', 1), period('b', 'u2', 1), period('c', 'u3', 1)]), send);
  assert.deepEqual(s, { considered: 3, sent: 1, failed: 1, skipped: 1 });
});

test('a user with no email is skipped; a throwing lookup or sender counts as failed and the run continues', async () => {
  const store = expiry([period('a', 'u1', 1), period('b', 'u2', 1), period('c', 'u3', 1)], [], { u1: null });
  store.emailFor = async (u) => { if (u === 'u2') throw new Error('boom'); return u === 'u1' ? null : 'u3@example.test'; };
  const s = await sendExpiryReminders(NOW, store, ok);
  assert.deepEqual(s, { considered: 3, sent: 1, failed: 1, skipped: 1 });
});

test('nothing expiring sends nothing and skips the renewal query', async () => {
  const store = expiry([]);
  store.renewedUsers = async () => { throw new Error('should not be called'); };
  assert.deepEqual(await sendExpiryReminders(NOW, store, ok), { considered: 0, sent: 0, failed: 0, skipped: 0 });
});

test('running twice relies on the claim: the second run reports skipped, not sent', async () => {
  const claimed = new Set<string>();
  const send: SendFn = async (_t, _to, _d, o) => {
    if (claimed.has(o.subjectId)) return { ok: false, status: 'failed', error: ALREADY_CLAIMED };
    claimed.add(o.subjectId);
    return { ok: true, status: 'sent' };
  };
  const store = expiry([period('p1', 'u1', 2)]);
  assert.equal((await sendExpiryReminders(NOW, store, send)).sent, 1);
  const again = await sendExpiryReminders(NOW, store, send);
  assert.deepEqual([again.sent, again.skipped], [0, 1]);
});

// ---- retention ----

function retention(rows: Array<{ id: string; path: string }>, opts: { failRemove?: string; failClear?: string } = {}) {
  const log: string[] = [];
  const cutoffs: Date[] = [];
  const store: RetentionStore = {
    async stale(c, limit) { cutoffs.push(c); assert.equal(limit, RETENTION_BATCH); return rows; },
    async removeObject(p) { log.push(`rm ${p}`); if (p === opts.failRemove) throw new Error('x'); },
    async clearPath(id) { log.push(`clear ${id}`); if (id === opts.failClear) throw new Error('x'); },
  };
  return { store, log, cutoffs };
}

test('cutoff is exactly 12 months back', () => {
  assert.equal(retentionCutoff(NOW).toISOString(), '2025-12-08T06:00:00.000Z');
});

test('old screenshots: object deleted first, then the path is nulled', async () => {
  const { store, log, cutoffs } = retention([{ id: 'r1', path: 'u/a.png' }, { id: 'r2', path: 'u/b.pdf' }]);
  assert.deepEqual(await purgeOldScreenshots(NOW, store), { deleted: 2, failed: 0 });
  assert.deepEqual(log, ['rm u/a.png', 'clear r1', 'rm u/b.pdf', 'clear r2']);
  assert.equal(cutoffs[0].toISOString(), '2025-12-08T06:00:00.000Z');
});

test('a failed delete leaves the path set (retried tomorrow) and does not stop the batch', async () => {
  const { store, log } = retention([{ id: 'r1', path: 'bad' }, { id: 'r2', path: 'good' }], { failRemove: 'bad' });
  assert.deepEqual(await purgeOldScreenshots(NOW, store), { deleted: 1, failed: 1 });
  assert.ok(!log.includes('clear r1'));
  assert.ok(log.includes('clear r2'));
});

test('a failed path-clear counts as failed; re-running an empty set is a no-op', async () => {
  const a = retention([{ id: 'r1', path: 'p' }], { failClear: 'r1' });
  assert.deepEqual(await purgeOldScreenshots(NOW, a.store), { deleted: 0, failed: 1 });
  const b = retention([]);
  assert.deepEqual(await purgeOldScreenshots(NOW, b.store), { deleted: 0, failed: 0 });
  assert.deepEqual(b.log, []);
});

test('runDailyJob: one task failing does not stop the other', async () => {
  const exp = expiry([]);
  exp.expiring = async () => { throw new Error('db down'); };
  const ret = retention([{ id: 'r1', path: 'p' }]);
  const r = await runDailyJob(NOW, { expiry: exp, retention: ret.store, send: ok });
  assert.deepEqual(r.reminders, { error: true });
  assert.deepEqual(r.retention, { deleted: 1, failed: 0 });
});

test('the job module never writes plan_periods and the db stores only read them', async () => {
  const { readFileSync } = await import('node:fs');
  const job = readFileSync(`${__dirname}/daily-job.ts`, 'utf8');
  const db = readFileSync(`${__dirname}/daily-job-db.ts`, 'utf8');
  assert.ok(!job.includes("from('plan_periods')"));
  for (const m of db.matchAll(/from\('plan_periods'\)\s*\.(\w+)/g)) assert.equal(m[1], 'select');
});
