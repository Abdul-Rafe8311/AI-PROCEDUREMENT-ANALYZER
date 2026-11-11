import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProofFile, interpretSubmit, pageCount, statusBadge, underReviewText } from './payment-form';

const MB = 1024 * 1024;

test('file check: accepts png/jpg/pdf up to 5 MB, states the limit otherwise', () => {
  assert.equal(checkProofFile({ name: 'a.png', size: MB, type: 'image/png' }), null);
  assert.equal(checkProofFile({ name: 'a.JPG', size: MB, type: 'image/jpeg' }), null);
  assert.equal(checkProofFile({ name: 'a.pdf', size: 5 * MB, type: 'application/pdf' }), null);
  assert.equal(checkProofFile({ name: 'a.pdf', size: 1000, type: '' }), null);
  assert.match(checkProofFile({ name: 'a.png', size: 8 * MB, type: 'image/png' })!, /8\.0 MB\. The limit is 5 MB/);
  assert.match(checkProofFile({ name: 'a.gif', size: 10, type: 'image/gif' })!, /PNG, JPG or PDF/);
  assert.match(checkProofFile({ name: 'a.png', size: 0, type: 'image/png' })!, /empty/);
});

test('badges: word + icon + token pairing', () => {
  assert.deepEqual(statusBadge('pending'), { label: 'Pending review', icon: 'clock', className: 'bg-warning/10 text-warning' });
  assert.equal(statusBadge('approved').icon, 'check');
  assert.equal(statusBadge('approved').className, 'bg-success/10 text-success');
  assert.equal(statusBadge('rejected').icon, 'x');
  assert.equal(statusBadge('rejected').className, 'bg-danger/10 text-danger');
});

test('submit outcomes branch on code', () => {
  assert.deepEqual(interpretSubmit(201, {}), { kind: 'ok' });
  assert.deepEqual(interpretSubmit(409, { code: 'PENDING_REQUEST_EXISTS' }), { kind: 'pending' });
  assert.equal(interpretSubmit(409, { error: 'You already have a payment under review.' }).kind, 'error');
  const v = interpretSubmit(400, { code: 'VALIDATION', fields: { file: 'bad', transactionId: 'bad2', other: 'x' } });
  assert.equal(v.kind, 'fields');
  if (v.kind === 'fields') {
    assert.equal(v.first, 'transactionId'); // form order, not object order
    assert.deepEqual(Object.keys(v.fields).sort(), ['file', 'transactionId']);
  }
  assert.equal(interpretSubmit(503, { code: 'PAYMENTS_UNAVAILABLE' }).kind, 'error');
  assert.equal(interpretSubmit(500, null).kind, 'error');
  assert.equal(interpretSubmit(400, { code: 'VALIDATION', fields: {} }).kind, 'error');
});

test('under-review text', () => {
  assert.match(underReviewText('2026-11-12T10:41:00'), /^Payment under review\. Submitted \d\d:\d\d\. We'll email you when it's decided\.$/);
});

test('page count', () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
});
