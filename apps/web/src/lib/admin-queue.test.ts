import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveSummary, decidedLine, interpretDecision, receiptAlt, rejectDisabled } from './admin-queue';
import type { AdminPaymentDto } from './payments-types';

const p = (o: Partial<AdminPaymentDto> = {}): AdminPaymentDto => ({
  id: 'a', userId: 'u', userEmail: 'farid@example.test', plan: 'pro', amountUsd: 12, transactionId: 'TX1',
  createdAt: '2026-11-10T10:00:00Z', hasScreenshot: true, receiptType: 'image', status: 'pending', duplicateOf: [],
  resulting: { startsAt: new Date().toISOString(), endsAt: '2026-12-11T00:00:00Z', upgrade: false },
  decidedBy: null, decidedAt: null, rejectReason: null, emailFailed: false, ...o,
});

test('approve summary restates user, plan, amount and the resulting expiry', () => {
  assert.equal(approveSummary(p()), 'Approve Pro for farid@example.test ($12.00 USD). Active from today until 11 Dec 2026.');
});

test('a queued approval says when it starts instead of "from today"', () => {
  const later = new Date(Date.now() + 10 * 864e5).toISOString();
  const s = approveSummary(p({ resulting: { startsAt: later, endsAt: '2027-01-30T00:00:00Z', upgrade: false } }));
  assert.match(s, /It starts on /);
  assert.ok(!s.includes('from today'));
});

test('summary tolerates a missing email', () => {
  assert.match(approveSummary(p({ userEmail: null })), /for Unknown user/);
});

test('receipt alt text names the submitter', () => {
  assert.equal(receiptAlt(p()), 'Payment receipt submitted by farid@example.test');
});

test('reject stays disabled until the reason has non-space text', () => {
  assert.equal(rejectDisabled(''), true);
  assert.equal(rejectDisabled('   \n'), true);
  assert.equal(rejectDisabled('Amount mismatch'), false);
});

test('decision outcomes branch on code', () => {
  assert.deepEqual(interpretDecision(200, { emailSent: true }, 'approve'), { kind: 'done', warn: false, message: 'Approved. The user has been emailed.' });
  const w = interpretDecision(200, { emailSent: false }, 'reject');
  assert.equal(w.kind, 'done');
  if (w.kind === 'done') {
    assert.equal(w.warn, true);
    assert.match(w.message, /Decision saved\. The email could not be sent\./);
  }
  assert.deepEqual(interpretDecision(409, { code: 'ALREADY_DECIDED' }, 'approve'), { kind: 'stale', message: 'This request was already decided.' });
  assert.equal(interpretDecision(409, { error: 'x' }, 'approve').kind, 'error');
  assert.equal(interpretDecision(400, { code: 'VALIDATION', fields: { reason: 'need it' } }, 'reject').kind, 'invalid');
  assert.equal(interpretDecision(503, null, 'approve').kind, 'error');
});

test('decided line shows who and when', () => {
  assert.equal(decidedLine(p({ status: 'approved', decidedBy: 'admin@example.test', decidedAt: '2026-11-11T08:00:00Z' })), 'Approved by admin@example.test, 11 Nov 2026');
  assert.match(decidedLine(p({ status: 'rejected' })), /^Rejected by an admin$/);
});
