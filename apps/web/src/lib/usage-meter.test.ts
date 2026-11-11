import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterModel } from './usage-meter';

test('text and wording per plan', () => {
  assert.equal(meterModel({ plan: 'free', used: 3, quota: 14 }).text, '3 / 14 PDFs used this month');
  assert.equal(meterModel({ plan: 'pro', used: 3, quota: 45 }).text, '3 / 45 PDFs used this period');
});

test('tone thresholds: ok below 80%, warning at 80%, danger at 100%', () => {
  assert.equal(meterModel({ plan: 'free', used: 11, quota: 14 }).tone, 'ok'); // 79%
  assert.equal(meterModel({ plan: 'free', used: 12, quota: 14 }).tone, 'warning'); // 86%
  assert.equal(meterModel({ plan: 'pro', used: 36, quota: 45 }).tone, 'warning'); // exactly 80%
  assert.equal(meterModel({ plan: 'free', used: 14, quota: 14 }).tone, 'danger');
});

test('aria values are clamped and consistent', () => {
  const m = meterModel({ plan: 'free', used: 20, quota: 14 });
  assert.deepEqual([m.now, m.max, m.pct, m.tone], [14, 14, 100, 'danger']);
});
