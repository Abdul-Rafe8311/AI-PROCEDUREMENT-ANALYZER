import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPdfUsage, releasePdfUsage, reservePdfQuota, sha256Hex } from './usage';

const W = new Date('2026-11-01T00:00:00Z');
const args = { userId: 'u', hashes: ['a'], windowStart: W, quota: 14, expectedPeriodId: null };
const rpc = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;

test('sha256Hex of known input', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('reserve maps OK, QUOTA_EXCEEDED, STALE', async () => {
  const ok = await reservePdfQuota(args, rpc({ status: 'OK', quota: 14, used: 1, remaining: 13, reserved: ['a'], free: [] }));
  assert.deepEqual(ok, { status: 'OK', quota: 14, used: 1, remaining: 13, reserved: ['a'], free: [] });
  const q = await reservePdfQuota(args, rpc({ status: 'QUOTA_EXCEEDED', quota: 14, used: 14, remaining: 0 }));
  assert.deepEqual(q, { status: 'QUOTA_EXCEEDED', quota: 14, used: 14, remaining: 0 });
  assert.deepEqual(await reservePdfQuota(args, rpc({ status: 'STALE' })), { status: 'STALE' });
});

test('reserve passes the SQL parameter names and the window as ISO', async () => {
  let seen: unknown;
  await reservePdfQuota({ ...args, expectedPeriodId: 'p1' }, { rpc: async (_f: string, p: unknown) => ((seen = p), { data: { status: 'STALE' }, error: null }) } as never);
  assert.deepEqual(seen, { p_user_id: 'u', p_hashes: ['a'], p_window_start: '2026-11-01T00:00:00.000Z', p_quota: 14, p_expected_period_id: 'p1' });
});

test('errors and unknown shapes throw DbUnavailableError', async () => {
  await assert.rejects(reservePdfQuota(args, rpc(null, { message: 'x' })), { name: 'DbUnavailableError' });
  await assert.rejects(reservePdfQuota(args, rpc({ status: 'WAT' })), { name: 'DbUnavailableError' });
  await assert.rejects(confirmPdfUsage({ userId: 'u', hash: 'a', windowStart: W }, rpc(null, { message: 'x' })), { name: 'DbUnavailableError' });
  await assert.rejects(releasePdfUsage({ userId: 'u', hash: 'a' }, rpc(null, { message: 'x' })), { name: 'DbUnavailableError' });
});
