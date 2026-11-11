import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonRows, formatPrice, planColumns } from './plan-matrix';

const prices = { plus: 6, pro: 12, max: 30 };

test('cards: four plans with quotas and feature flags from the single matrix', () => {
  const cols = planColumns(prices);
  assert.deepEqual(cols.map((c) => [c.id, c.price, c.quota, c.chat, c.tender]), [
    ['free', '$0', 14, false, false],
    ['plus', '$6', 30, true, false],
    ['pro', '$12', 45, true, true],
    ['max', '$30', 100, true, true],
  ]);
});

test('missing or invalid price renders a dash, never a made-up number', () => {
  assert.equal(formatPrice('pro', null), '—');
  assert.equal(formatPrice('pro', { pro: null }), '—');
  assert.equal(formatPrice('pro', { pro: Number.NaN }), '—');
});

test('comparison rows are the five required rows in order; Max alone has 12h support', () => {
  const rows = comparisonRows(prices);
  assert.deepEqual(rows.map((r) => r.label), ['PDFs per month', 'Chatbox', 'Tender sheet', 'Priority Support', 'Price']);
  const support = rows[3].values;
  assert.deepEqual([support.free, support.plus, support.pro, support.max], ['48h reply', '48h reply', '48h reply', '12h reply (priority)']);
  assert.equal(rows[4].values.pro, '$12 / month');
});
