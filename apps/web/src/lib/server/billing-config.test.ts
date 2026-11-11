import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingConfig, parsePrices } from './billing-config';

test('prices and support email come from config', async () => {
  const r = buildBillingConfig({ config: () => ({ planPricesUsd: { plus: 6, pro: 12, max: 30 }, supportEmail: 's@x.test' }) });
  assert.deepEqual(await r.json(), { prices: { plus: 6, pro: 12, max: 30 }, supportEmail: 's@x.test' });
});

test('wrong-shape prices become null, not garbage', () => {
  assert.deepEqual(parsePrices(null), { plus: null, pro: null, max: null });
  assert.deepEqual(parsePrices([1, 2]), { plus: null, pro: null, max: null });
  assert.deepEqual(parsePrices({ plus: '6', pro: -1, max: 30 }), { plus: null, pro: null, max: 30 });
});

test('config error is 503 and does not leak the error text', async () => {
  const r = buildBillingConfig({
    config: () => {
      throw new Error('secret');
    },
  });
  assert.equal(r.status, 503);
  assert.ok(!JSON.stringify(await r.json()).includes('secret'));
});
