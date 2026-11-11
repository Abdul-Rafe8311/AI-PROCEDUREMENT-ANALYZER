import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  receiptType,
  DecideInputError, decidePayment, emailFailedIds, listAdminPayments,
  type AdminPaymentsStore, type DecideResult,
} from './payments-admin';
import type { PaymentRow } from './payments';
import type { PlanPeriod } from '../entitlements/effective-plan';
import type { Principal } from './guard';

const NOW = new Date('2026-11-11T00:00:00Z');
const admin: Principal = { userId: '99999999-9999-9999-9999-999999999999', email: 'admin@example.test', via: 'jwt' };
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const ID1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ID2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const ID3 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';

const row = (o: Partial<PaymentRow> = {}): PaymentRow => ({
  id: ID1, user_id: U1, plan: 'pro', amount_usd: 12, transaction_id: 'TX1', screenshot_path: 'p', status: 'pending',
  decided_by: null, decided_at: null, reject_reason: null, created_at: '2026-11-10T10:00:00Z', ...o,
});

function store(o: Partial<AdminPaymentsStore> = {}) {
  const decided: unknown[] = [];
  const s: AdminPaymentsStore = {
    async listPending() { return [row()]; },
    async listDecided() { return { rows: [], total: 0 }; },
    async get(id) { return id === ID1 ? row() : null; },
    async userEmails(ids) { return new Map(ids.map((i) => [i, i === U1 ? 'farid@example.test' : 'other@example.test'])); },
    async byTransactionIds() { return []; },
    async periods() { return []; },
    async emailLog() { return []; },
    async decide(a) {
      decided.push(a);
      return a.decision === 'approve'
        ? { status: 'approved', plan: 'pro', starts_at: '2026-11-11T00:00:00Z', ends_at: '2026-12-11T00:00:00Z' }
        : { status: 'rejected' };
    },
    ...o,
  };
  return { s, decided };
}
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const body = async (r: Response) => (await r.json()) as Record<string, any>;

test('approve: decides, then emails the user plan and expiry date; response says emailSent', async () => {
  const { s, decided } = store();
  const sent: Array<{ tpl: string; to: string; data: any; opts: any }> = [];
  const r = await decidePayment(post({ decision: 'approve' }), ID1, admin, {
    store: s, siteUrl: 'https://app.example.test',
    send: async (tpl, to, data, opts) => { sent.push({ tpl, to, data, opts }); return { ok: true, status: 'sent' }; },
  });
  assert.equal(r.status, 200);
  const b = await body(r);
  assert.equal(b.status, 'approved');
  assert.equal(b.emailSent, true);
  assert.deepEqual(decided, [{ requestId: ID1, adminEmail: 'admin@example.test', decision: 'approve', reason: null }]);
  assert.equal(sent[0].tpl, 'payment_approved');
  assert.equal(sent[0].to, 'farid@example.test');
  assert.deepEqual(sent[0].data, { plan: 'pro', expiresOn: '11 Dec 2026' });
  assert.deepEqual(sent[0].opts, { subjectId: ID1 });
});

test('reject needs a reason: 400 VALIDATION and the database is not called', async () => {
  const { s, decided } = store();
  for (const reason of [undefined, '', '   ']) {
    const r = await decidePayment(post({ decision: 'reject', reason }), ID1, admin, { store: s });
    assert.equal(r.status, 400);
    assert.equal((await body(r)).code, 'VALIDATION');
  }
  assert.equal(decided.length, 0);
});

test('reject with a reason records it and emails the reason and how to resubmit', async () => {
  const { s, decided } = store();
  let sent: any;
  const r = await decidePayment(post({ decision: 'reject', reason: '  Amount does not match  ' }), ID1, admin, {
    store: s, siteUrl: 'https://app.example.test', supportEmail: 'help@example.test',
    send: async (tpl, to, data) => { sent = { tpl, to, data }; return { ok: true, status: 'sent' }; },
  });
  assert.equal(r.status, 200);
  assert.equal((decided[0] as any).reason, 'Amount does not match');
  assert.equal(sent.tpl, 'payment_rejected');
  assert.equal(sent.data.reason, 'Amount does not match');
  assert.equal(sent.data.plansUrl, 'https://app.example.test/plans');
  assert.equal(sent.data.supportEmail, 'help@example.test');
});

test('already decided is 409 ALREADY_DECIDED and no email is sent', async () => {
  const { s } = store({ async decide() { return { status: 'ALREADY_DECIDED' } as DecideResult; } });
  let mailed = false;
  const r = await decidePayment(post({ decision: 'approve' }), ID1, admin, { store: s, send: async () => { mailed = true; return { ok: true, status: 'sent' }; } });
  assert.equal(r.status, 409);
  assert.equal((await body(r)).code, 'ALREADY_DECIDED');
  assert.equal(mailed, false);
});

test('unknown or malformed id is 404', async () => {
  const { s } = store();
  assert.equal((await decidePayment(post({ decision: 'approve' }), ID2, admin, { store: s })).status, 404);
  assert.equal((await decidePayment(post({ decision: 'approve' }), 'nope', admin, { store: s })).status, 404);
  const gone = store({ async decide() { throw new DecideInputError('request_not_found'); } });
  assert.equal((await decidePayment(post({ decision: 'approve' }), ID1, admin, { store: gone.s })).status, 404);
});

test('bad decision value or body is 400', async () => {
  const { s } = store();
  assert.equal((await decidePayment(post({ decision: 'maybe' }), ID1, admin, { store: s })).status, 400);
  assert.equal((await decidePayment(new Request('http://x', { method: 'POST', body: 'not json' }), ID1, admin, { store: s })).status, 400);
});

test('a failed or throwing email never rolls back the decision', async () => {
  for (const send of [
    async () => ({ ok: false, status: 'failed' as const, error: 'down' }),
    async () => { throw new Error('boom'); },
  ]) {
    const { s, decided } = store();
    const r = await decidePayment(post({ decision: 'approve' }), ID1, admin, { store: s, send });
    assert.equal(r.status, 200);
    const b = await body(r);
    assert.equal(b.status, 'approved');
    assert.equal(b.emailSent, false);
    assert.equal(decided.length, 1);
  }
});

test('user without an address: decision stands, emailSent false', async () => {
  const { s } = store({ async userEmails() { return new Map([[U1, null]]); } });
  const r = await decidePayment(post({ decision: 'approve' }), ID1, admin, { store: s, send: async () => ({ ok: true, status: 'sent' }) });
  assert.equal((await body(r)).emailSent, false);
});

test('database failure is 503', async () => {
  const { s } = store({ async decide() { throw new Error('db'); } });
  assert.equal((await decidePayment(post({ decision: 'approve' }), ID1, admin, { store: s })).status, 503);
});

test('pending list: oldest first as given, user email, duplicate flag, resulting period', async () => {
  const rows = [row({ id: ID1, created_at: '2026-11-09T00:00:00Z' }), row({ id: ID2, user_id: U2, created_at: '2026-11-10T00:00:00Z', plan: 'max' })];
  const { s } = store({
    async listPending() { return rows; },
    async byTransactionIds() { return [{ id: ID1, transaction_id: 'TX1' }, { id: ID2, transaction_id: 'TX1' }, { id: ID3, transaction_id: 'TX1' }]; },
    async periods(uid): Promise<PlanPeriod[]> {
      return uid === U2 ? [{ id: 'p', plan: 'plus', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }] : [];
    },
  });
  const r = await listAdminPayments(new Request('http://x/api/admin/payments'), s, () => NOW);
  const b = await body(r);
  assert.equal(b.view, 'pending');
  assert.deepEqual(b.requests.map((x: any) => x.id), [ID1, ID2]);
  assert.equal(b.requests[0].userEmail, 'farid@example.test');
  assert.deepEqual(b.requests[0].duplicateOf.sort(), [ID2, ID3]);
  // free user: starts now for 30 days
  assert.deepEqual(b.requests[0].resulting, { startsAt: '2026-11-11T00:00:00.000Z', endsAt: '2026-12-11T00:00:00.000Z', upgrade: false });
  // plus -> max is an upgrade: starts now
  assert.equal(b.requests[1].resulting.upgrade, true);
  assert.equal(b.requests[1].resulting.startsAt, '2026-11-11T00:00:00.000Z');
});

test('pending request with no duplicates has an empty duplicateOf', async () => {
  const { s } = store({ async byTransactionIds() { return [{ id: ID1, transaction_id: 'TX1' }]; } });
  const b = await body(await listAdminPayments(new Request('http://x/api/admin/payments'), s, () => NOW));
  assert.deepEqual(b.requests[0].duplicateOf, []);
});

test('history: decided rows with decider, reason and emailFailed; paginated', async () => {
  let seen: [number, number] = [0, 0];
  const decided = [
    row({ id: ID1, status: 'approved', decided_by: 'admin@example.test', decided_at: '2026-11-11T08:00:00Z' }),
    row({ id: ID2, status: 'rejected', decided_by: 'admin@example.test', decided_at: '2026-11-11T07:00:00Z', reject_reason: 'No match' }),
  ];
  const { s } = store({
    async listDecided(o, l) { seen = [o, l]; return { rows: decided, total: 45 }; },
    async emailLog() {
      return [
        { subject_id: ID1, template: 'payment_approved', status: 'failed' },
        { subject_id: ID2, template: 'payment_rejected', status: 'failed' },
        { subject_id: ID2, template: 'payment_rejected', status: 'sent' },
      ];
    },
  });
  const b = await body(await listAdminPayments(new Request('http://x/api/admin/payments?view=history&page=3'), s));
  assert.deepEqual(seen, [40, 20]);
  assert.equal(b.total, 45);
  assert.equal(b.requests[0].emailFailed, true);
  assert.equal(b.requests[0].status, 'approved'); // the decision still shows as made
  assert.equal(b.requests[1].emailFailed, false); // a later retry was sent
  assert.equal(b.requests[1].rejectReason, 'No match');
});

test('emailFailedIds ignores other templates and unrelated rows', () => {
  const s = emailFailedIds([
    { subject_id: 'a', template: 'payment_submitted_admin', status: 'failed' },
    { subject_id: null, template: 'payment_approved', status: 'failed' },
    { subject_id: 'b', template: 'payment_approved', status: 'pending' },
    { subject_id: 'c', template: 'payment_approved', status: 'failed' },
  ]);
  assert.deepEqual([...s], ['c']);
});

test('receipt type comes from the extension; the storage path is not in the response', async () => {
  assert.equal(receiptType('u/x.pdf'), 'pdf');
  assert.equal(receiptType('u/x.PNG'), 'image');
  assert.equal(receiptType(null), null);
  const { s } = store({ async listPending() { return [row({ screenshot_path: 'secret-user/abc.pdf' })]; } });
  const raw = JSON.stringify(await body(await listAdminPayments(new Request('http://x/api/admin/payments'), s, () => NOW)));
  assert.ok(raw.includes('"receiptType":"pdf"'));
  assert.ok(!raw.includes('secret-user'));
});
