import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingConfig, parseBankDetails, parsePrices } from './billing-config';

test('prices and support email come from config', async () => {
  const r = buildBillingConfig({ config: () => ({ planPricesUsd: { plus: 6, pro: 12, max: 30 }, supportEmail: 's@x.test' }) });
  assert.deepEqual(await r.json(), { prices: { plus: 6, pro: 12, max: 30 }, supportEmail: 's@x.test', bank: [] });
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

test('bank details are served from config as label/value rows', async () => {
  const r = buildBillingConfig({
    config: () => ({
      planPricesUsd: null,
      supportEmail: null,
      bankDetails: { bank_name: 'Example Bank', iban: 'SA0380000000608010167519', swift: 'EXAMSARI' },
    }),
  });
  const body = await r.json();
  assert.deepEqual(body.bank, [
    { key: 'bank_name', label: 'Bank name', value: 'Example Bank' },
    { key: 'iban', label: 'IBAN', value: 'SA0380000000608010167519' },
    { key: 'swift', label: 'SWIFT', value: 'EXAMSARI' },
  ]);
});

test('parseBankDetails accepts arrays, drops empty or wrong-typed values and wrong shapes', () => {
  assert.deepEqual(parseBankDetails([{ label: 'Account name', value: 'Fake Trading Co' }, { label: 'x' }, null, { label: 'Ref', value: 12 }]), [
    { key: 'account_name', label: 'Account name', value: 'Fake Trading Co' },
    { key: 'ref', label: 'Ref', value: '12' },
  ]);
  assert.deepEqual(parseBankDetails({ iban: '  ', nested: { a: 1 }, ok: 'yes' }), [{ key: 'ok', label: 'Ok', value: 'yes' }]);
  for (const bad of [null, undefined, 'text', 5, true]) assert.deepEqual(parseBankDetails(bad), []);
});
