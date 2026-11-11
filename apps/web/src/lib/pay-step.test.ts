import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyValue, displayValue, groupIban, payDisclosures, payHeading, refundPolicy } from './pay-step';

test('IBAN is grouped in fours, other values untouched', () => {
  assert.equal(groupIban('SA0380000000608010167519'), 'SA03 8000 0000 6080 1016 7519');
  assert.equal(groupIban('sa03 8000 0000 6080 1016 7519'), 'sa03 8000 0000 6080 1016 7519');
  assert.equal(groupIban('Example Bank'), 'Example Bank');
  assert.equal(displayValue('iban', 'SA0380000000608010167519'), 'SA03 8000 0000 6080 1016 7519');
  assert.equal(displayValue('account_number', '12345678901234'), '12345678901234');
});

test('copy value for IBAN is compact, others unchanged', () => {
  assert.equal(copyValue('iban', 'SA03 8000 0000'), 'SA0380000000');
  assert.equal(copyValue('bank_name', 'Example  Bank'), 'Example  Bank');
});

test('heading shows two-decimal USD', () => {
  assert.equal(payHeading(12), 'Pay $12.00 USD by bank transfer');
  assert.equal(payHeading(30), 'Pay $30.00 USD by bank transfer');
});

test('no disclosure when moving up from Free', () => {
  assert.deepEqual(payDisclosures({ current: 'free', target: 'pro', chainEnd: null }), []);
});

test('upgrade forfeiture is stated', () => {
  const [d] = payDisclosures({ current: 'plus', target: 'max', chainEnd: '2026-12-11T00:00:00Z' });
  assert.match(d, /not carried over/);
  assert.match(d, /Plus/);
});

test('downgrade states when it starts and what the user keeps', () => {
  const [d] = payDisclosures({ current: 'max', target: 'plus', chainEnd: '2026-12-11T12:00:00Z' });
  assert.match(d, /^Plus starts on /);
  assert.match(d, /You keep Max until then\.$/);
});

test('same-plan renewal adds 30 days and keeps usage', () => {
  const [d] = payDisclosures({ current: 'pro', target: 'pro', chainEnd: '2026-12-11T12:00:00Z' });
  assert.match(d, /adds 30 days/);
  assert.match(d, /not reset/);
});

test('refund policy names the support address, or a fallback', () => {
  assert.match(refundPolicy('help@example.test'), /email help@example\.test and/);
  assert.match(refundPolicy(null), /our support address/);
  assert.ok(!refundPolicy(null).includes('!'));
});
