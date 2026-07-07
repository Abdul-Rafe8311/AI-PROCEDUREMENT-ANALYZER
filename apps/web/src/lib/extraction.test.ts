import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';

// Models the buyer's "Technical Approval Form": ONE page comparing ACIS and
// Nanjing Sino side by side, each with product lines PLUS a "Sea freight" line
// (ACIS 300, Nanjing 350), its own reference no., delivery terms, and — for
// Nanjing — a total stated in both USD and SAR.
const acis: LlmSupplier = {
  supplierName: 'ACIS',
  reference: 'ACIS-2024-017',
  currency: 'USD',
  totalAmount: 9000, // BUG reproduction: the stated total EXCLUDES the 300 freight
  totalsByCurrency: null,
  deliveryTime: '60 days',
  deliveryTerms: 'CFR Jeddah',
  paymentTerms: '30 days credit',
  warranty: '12 months',
  validUntil: null,
  lineItems: [
    { name: 'Reinforcement Bars 12mm', quantity: 10, unitPrice: 500, totalPrice: 5000, category: 'product' },
    { name: 'Portland Cement', quantity: 20, unitPrice: 200, totalPrice: 4000, category: 'product' },
    { name: 'Sea freight', quantity: null, unitPrice: null, totalPrice: 300, category: 'freight' },
  ],
};

const nanjing: LlmSupplier = {
  supplierName: 'Nanjing Sino',
  reference: 'NJS-Q-88',
  currency: 'USD',
  totalAmount: 12350, // stated total already INCLUDES the 350 freight
  totalsByCurrency: [
    { amount: 12350, currency: 'USD' },
    { amount: 46312, currency: 'SAR' },
  ],
  deliveryTime: '40 days',
  deliveryTerms: 'CIF Jeddah',
  paymentTerms: '30 days credit',
  warranty: null,
  validUntil: null,
  lineItems: [
    { name: 'Reinforcement Bars 12mm', quantity: 10, unitPrice: 700, totalPrice: 7000, category: 'product' },
    { name: 'Portland Cement', quantity: 20, unitPrice: 250, totalPrice: 5000, category: 'product' },
    { name: 'Sea freight', quantity: null, unitPrice: null, totalPrice: 350, category: 'freight' },
  ],
};

const detected = { currency: 'USD', confidence: 0.8 };
const run = () => quotationsFromLlmSuppliers([acis, nanjing], 'technical-approval-form.pdf', detected);

test('BUG B: a multi-supplier document yields both suppliers separately', () => {
  const qs = run();
  assert.equal(qs.length, 2);
  assert.deepEqual(
    qs.map((q) => q.supplierName),
    ['ACIS', 'Nanjing Sino'],
  );
  assert.notEqual(qs[0].id, qs[1].id);
});

test('BUG A: ACIS total includes its 300 freight (even though the stated total omitted it)', () => {
  const [a] = run();
  assert.equal(a.totalCost, 9300); // 5000 + 4000 products + 300 freight
  const freight = a.lineItems.find((li) => li.category === 'freight');
  assert.ok(freight, 'freight appears as a visible line item');
  assert.equal(freight?.totalPrice, 300);
});

test('BUG A: Nanjing total includes its 350 freight', () => {
  const [, n] = run();
  assert.equal(n.totalCost, 12350); // includes the 350 freight
  const freight = n.lineItems.find((li) => li.category === 'freight');
  assert.ok(freight && freight.totalPrice === 350);
});

test('PHASE 4B: scanned/vision extraction caps confidence at medium but keeps values', () => {
  // Same suppliers, but read from a scan → confidence must be capped, values intact.
  const qs = quotationsFromLlmSuppliers([acis, nanjing], 'ta-12502270-scan.pdf', detected, {
    scanned: true,
  });
  assert.equal(qs.length, 2);
  const [a, n] = qs;
  // Values are identical to the digital-text path (freight included, both suppliers).
  assert.equal(a.totalCost, 9300);
  assert.equal(n.totalCost, 12350);
  assert.equal(a.deliveryTerms, 'CFR Jeddah');
  assert.deepEqual((n.statedTotals ?? []).map((t) => t.currency).sort(), ['SAR', 'USD']);
  // But no scanned field may claim high/full confidence (>0.7); present fields stay >0.
  for (const q of qs) {
    const fields = q.fields as Record<string, { confidence: number }>;
    for (const key of Object.keys(fields)) {
      assert.ok(fields[key].confidence <= 0.7, `${q.supplierName}.${key} confidence capped`);
    }
    assert.ok(q.currencyConfidence <= 0.7);
  }
  assert.ok(a.fields.totalCost.confidence > 0, 'a present field keeps a non-zero confidence');
});

test('BUG 1: a stated grand total is not inflated by an over-summed product column', () => {
  // Models Supply Wave: the document states SAR 137,980, but the product lines
  // (a misread column) sum to 158,677. The stated total must win.
  const supplyWave: LlmSupplier = {
    supplierName: 'Supply Wave', reference: 'SW-1', currency: 'SAR',
    totalAmount: 137980, totalsByCurrency: null,
    deliveryTime: '88 Days', deliveryTerms: 'CIF Jeddah', paymentTerms: '30 days credit',
    warranty: null, validUntil: null,
    lineItems: [
      { name: 'Item A', quantity: 1, unitPrice: 100000, totalPrice: 100000, category: 'product' },
      { name: 'Item B', quantity: 1, unitPrice: 58677, totalPrice: 58677, category: 'product' },
    ],
  };
  const [q] = quotationsFromLlmSuppliers([supplyWave], 'sw.pdf', { currency: 'SAR', confidence: 0.99 });
  assert.equal(q.totalCost, 137980); // not 158,677
  assert.equal(q.deliveryDays, 88); // "88 Days" parsed correctly
});

test('BUG 1: an omitted freight charge still lifts the total (freight fix preserved)', () => {
  const supplier: LlmSupplier = {
    supplierName: 'Freight Co', reference: null, currency: 'SAR',
    totalAmount: 137980, totalsByCurrency: null, // stated total EXCLUDES freight
    deliveryTime: '60 days', deliveryTerms: null, paymentTerms: null, warranty: null, validUntil: null,
    lineItems: [
      { name: 'Goods', quantity: 1, unitPrice: 137980, totalPrice: 137980, category: 'product' },
      { name: 'Sea freight', quantity: null, unitPrice: null, totalPrice: 2000, category: 'freight' },
    ],
  };
  const [q] = quotationsFromLlmSuppliers([supplier], 'f.pdf', { currency: 'SAR', confidence: 0.99 });
  assert.equal(q.totalCost, 139980); // 137,980 stated + 2,000 uncounted freight
});

test('mixed currencies, delivery terms and reference are captured per supplier', () => {
  const [a, n] = run();
  assert.equal(a.deliveryTerms, 'CFR Jeddah');
  assert.equal(a.reference, 'ACIS-2024-017');
  assert.equal(n.deliveryTerms, 'CIF Jeddah');
  assert.equal(n.reference, 'NJS-Q-88');
  // Both stated currencies are retained for audit (don't just grab the first).
  const currencies = (n.statedTotals ?? []).map((t) => t.currency).sort();
  assert.deepEqual(currencies, ['SAR', 'USD']);
});
