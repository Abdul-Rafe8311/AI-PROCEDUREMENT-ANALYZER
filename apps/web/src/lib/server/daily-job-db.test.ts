import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseExpiryStore, supabaseRetentionStore } from './daily-job-db';
import { supabaseEmailLog, STALE_PENDING_MS } from './email';

type Call = [string, ...unknown[]];

/** Chainable, thenable fake of a PostgREST query builder that records every call. */
function fakeClient(resolve: (table: string, calls: Call[]) => { data: unknown; error?: unknown }) {
  const log: Array<{ table: string; calls: Call[] }> = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [];
      log.push({ table, calls });
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'gt', 'lte', 'lt', 'gte', 'in', 'order', 'range', 'limit', 'not', 'neq', 'eq', 'update', 'insert']) {
        q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
      }
      q.single = () => Promise.resolve(resolve(table, calls));
      q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve(table, calls)).then(ok, bad);
      return q;
    },
  };
  return { client: client as never, log };
}

test('expiring() pages through more than 1000 periods until a short page', async () => {
  const row = (i: number) => ({ id: `p${i}`, user_id: `u${i}`, plan: 'pro', ends_at: '2026-12-09T00:00:00Z' });
  const { client, log } = fakeClient((_t, calls) => {
    const r = calls.find((c) => c[0] === 'range')!;
    const from = r[1] as number;
    const n = from === 0 ? 1000 : from === 1000 ? 1000 : 250;
    return { data: Array.from({ length: n }, (_, i) => row(from + i)) };
  });
  const out = await supabaseExpiryStore(client).expiring(new Date('2026-12-08T00:00:00Z'), new Date('2026-12-11T00:00:00Z'));
  assert.equal(out.length, 2250);
  assert.deepEqual(log.map((l) => l.calls.find((c) => c[0] === 'range')!.slice(1)), [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('renewedUsers() chunks the user list so no single in() is oversized and merges results', async () => {
  const sizes: number[] = [];
  const { client } = fakeClient((_t, calls) => {
    const ids = calls.find((c) => c[0] === 'in')![2] as string[];
    sizes.push(ids.length);
    return { data: [{ user_id: ids[0], starts_at: '2026-12-10T00:00:00Z' }] };
  });
  const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
  const out = await supabaseExpiryStore(client).renewedUsers(ids, new Date());
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(out.length, 3);
});

test('retention never selects a request that is still pending', async () => {
  const { client, log } = fakeClient(() => ({ data: [] }));
  await supabaseRetentionStore(client).stale(new Date('2025-12-08T00:00:00Z'), 200);
  const calls = log[0].calls;
  assert.ok(calls.some((c) => c[0] === 'neq' && c[1] === 'status' && c[2] === 'pending'));
  assert.ok(calls.some((c) => c[0] === 'lt' && c[1] === 'created_at'));
});

test('email_log: a stale pending reminder claim is reclaimed via failed -> pending; a fresh one is not', async () => {
  const dup = { code: '23505' };
  const seen: Call[][] = [];
  let reclaimed = false;
  const { client, log } = fakeClient((_t, calls) => {
    seen.push(calls);
    if (calls.some((c) => c[0] === 'insert')) return { data: null, error: dup };
    const upd = calls.find((c) => c[0] === 'update')![1] as { status: string };
    if (upd.status === 'failed') return { data: null };
    reclaimed = true;
    return { data: [{ id: 'log1' }] };
  });
  {
    const before = Date.now();
    const id = await supabaseEmailLog(() => client).start({ template: 'expiry_reminder', to: 'a@b.test', subjectId: 'p1' });
    assert.equal(id, 'log1');
    assert.ok(reclaimed);
    const stale = log[1].calls; // 0 insert, 1 pending->failed
    const lt = stale.find((c) => c[0] === 'lt')!;
    assert.equal(lt[1], 'created_at');
    assert.ok(Date.parse(lt[2] as string) <= before - STALE_PENDING_MS + 1000);
    assert.ok(stale.some((c) => c[0] === 'eq' && c[1] === 'status' && c[2] === 'pending'));
  }
});
