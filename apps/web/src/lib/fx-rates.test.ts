import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFxRates, toSar, toUsd, sarPerUnit, type FxStore, type FxRates } from './fx-rates';

// base=USD sample (shape of /api/fx): USD→SAR 3.7501, USD→EUR 0.8758.
const PAYLOAD = {
  base: 'USD',
  rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 },
  asOf: 'Wed, 08 Jul 2026 00:02:32 +0000',
  source: 'open.er-api.com',
};

function memStore(): FxStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}
const okFetch = (async () =>
  new Response(JSON.stringify(PAYLOAD), { status: 200 })) as unknown as typeof fetch;
const deadFetch = (async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;

test('FX: a live fetch returns live rates and caches them', async () => {
  const store = memStore();
  const r = await getFxRates({ fetchImpl: okFetch, store });
  assert.ok(r);
  assert.equal(r!.live, true);
  assert.equal(r!.rates.SAR, 3.7501);
  assert.ok(store.get('procurement:fx-rates:v1'), 'rate was cached');
});

test('FX: killing the network falls back to the cached rate (marked not-live)', async () => {
  const store = memStore();
  await getFxRates({ fetchImpl: okFetch, store }); // seed the cache
  const r = await getFxRates({ fetchImpl: deadFetch, store }); // network dead
  assert.ok(r, 'still returns a rate from cache');
  assert.equal(r!.live, false, 'flagged as cached, not live');
  assert.equal(r!.rates.SAR, 3.7501);
});

test('FX: no live rate and no cache → null (never a hardcoded guess)', async () => {
  const r = await getFxRates({ fetchImpl: deadFetch, store: memStore() });
  assert.equal(r, null);
});

test('FX: EUR and SAR amounts convert to SAR + USD correctly', () => {
  const r: FxRates = { ...PAYLOAD, base: 'USD', live: true };
  // EUR 2.42 → USD 2.76 → SAR 10.36 (matches the PR 12601612 reference).
  assert.equal(toUsd(2.42, 'EUR', r)!.toFixed(2), '2.76');
  assert.equal(toSar(2.42, 'EUR', r)!.toFixed(2), '10.36');
  // A SAR amount stays in SAR and gets a USD secondary.
  assert.equal(toSar(209525, 'SAR', r), 209525);
  assert.equal(toUsd(209525, 'SAR', r)!.toFixed(0), '55872');
  // Rate stamp: 1 USD = 3.75 SAR; 1 EUR = 4.28 SAR.
  assert.equal(sarPerUnit('USD', r)!.toFixed(2), '3.75');
  assert.equal(sarPerUnit('EUR', r)!.toFixed(2), '4.28');
});
