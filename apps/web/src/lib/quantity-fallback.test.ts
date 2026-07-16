// Quantity-fallback matching: a genuinely-quoted free-text line with no code and
// no dimension to match on must still land on its PR row (by quantity), flagged
// "spec differs" with a short note — never a false "Not quoted". Opaque part-number
// quotes that line up by quantity stay CLEAN, and a genuinely-unquoted item stays
// "not quoted".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { matchSupplierItems, specDiffNote } from './item-matching';

const pr = purchaseRequisitionFromLlm({
  requestNo: '12601612', description: 'Anchors',
  items: [
    { itemCode: '404602703004', description: 'Anchor, Corrugated, TWS.10(60)-200(140)-40-253, Grade 253 MA', quantity: 10000, unit: 'EA' },
    { itemCode: '404602701007', description: 'Stainless steel V-type anchor as per drawing NCC-KL-42', quantity: 2000, unit: 'EA' },
    { itemCode: '404602703033', description: 'Anchor, Corrugated, TWS.10(60)-250(140)-40-253, Grade 253 MA', quantity: 1500, unit: 'EA' },
    { itemCode: '404602703042', description: 'Anchor, Corrugated, TWS.10(60)-170(80)-40-253, Grade 253 MA', quantity: 300, unit: 'EA' },
    { itemCode: '404602703043', description: 'Anchor, Corrugated, TWS.10(60)-180(100)-40-253, Grade 253 MA', quantity: 700, unit: 'EA' },
  ],
}, 'pr.pdf')!;

const mk = (name: string, lineItems: LlmSupplier['lineItems']): LlmSupplier => ({
  supplierName: name, reference: 'R', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4 weeks', deliveryTerms: 'CIF', countryOfOrigin: 'France', paymentTerms: 'CAD', warranty: null, validUntil: null,
  lineItems,
});
const prod = (name: string, qty: number, price: number): LlmSupplier['lineItems'][number] =>
  ({ name, quantity: qty, unitPrice: price, totalPrice: Math.round(price * qty * 100) / 100, category: 'product', uom: 'EA', availableInDays: null });

test('Krosaki: free-text item 2 (no code/dimension) maps by QUANTITY → "spec differs", NOT "not quoted"', () => {
  // 4 TWS part codes + item 2 as free text whose size/material digits don't line up
  // with the PR row on dimension → must fall back to the exact-quantity match.
  const krosaki = mk('KROSAKI', [
    prod('TWS.10(60)-200(140)-40-253', 10000, 2.42),
    prod('V DIA 10MM H=70MM AISI 310 CAPPED ACC DRWG', 2000, 0.95),
    prod('TWS.10(60)-250(140)-40-253', 1500, 2.93),
    prod('TWS.10(60)-170(80)-40-253', 300, 2.26),
    prod('TWS.10(60)-180(100)-40-253', 700, 2.33),
  ]);
  const [q] = quotationsFromLlmSuppliers([krosaki], 'k.pdf', { currency: 'EUR', confidence: 0.6 });
  const m = matchSupplierItems(q, pr.items);

  assert.equal(m.notQuotedCount, 0, 'zero false Not Quoted');
  const item2 = m.prItems[1];
  assert.equal(item2.state, 'quoted_spec_diff', 'item 2 is Quoted · spec differs');
  assert.equal(item2.mappedBy, 'quantity', 'placed by exact quantity (2,000)');
  assert.equal(item2.supplierItem!.quantity, 2000);
  assert.ok(item2.note && /size|drawing/i.test(item2.note), `note explains the difference: ${item2.note}`);
  // The other 4 (part codes) remain clean matches.
  assert.equal(m.specDiffCount, 1);
  assert.equal(m.matchCount, 4);
});

test('opaque part-number quotes lining up by quantity stay CLEAN (no false spec-differs)', () => {
  // Bare codes with distinct quantities and no dimension overlap → quantity fallback,
  // but they carry NO descriptive words that disagree, so they are clean matches.
  const supplier = mk('PartCo', [
    prod('XR-1', 10000, 2.0), prod('XR-2', 2000, 2.0), prod('XR-3', 1500, 2.0),
    prod('XR-4', 300, 2.0), prod('XR-5', 700, 2.0),
  ]);
  const [q] = quotationsFromLlmSuppliers([supplier], 'p.pdf', { currency: 'EUR', confidence: 0.6 });
  const m = matchSupplierItems(q, pr.items);
  assert.equal(m.notQuotedCount, 0);
  assert.equal(m.specDiffCount, 0, 'opaque codes are not flagged spec-differs');
  assert.ok(m.prItems.every((p) => p.mappedBy === 'quantity'));
});

test('a genuinely-unquoted item (no matching line) still shows "not quoted"', () => {
  // Supplier quotes only 3 of the 5 items → the 2 missing rows have no line to map.
  const supplier = mk('Partial', [
    prod('TWS.10(60)-200(140)-40-253', 10000, 2.0),
    prod('TWS.10(60)-250(140)-40-253', 1500, 2.0),
    prod('TWS.10(60)-180(100)-40-253', 700, 2.0),
  ]);
  const [q] = quotationsFromLlmSuppliers([supplier], 'x.pdf', { currency: 'EUR', confidence: 0.6 });
  const m = matchSupplierItems(q, pr.items);
  assert.equal(m.notQuotedCount, 2, 'the 2,000 and 300 rows are genuinely not quoted');
  assert.equal(m.prItems[1].state, 'not_quoted');
  assert.equal(m.prItems[3].state, 'not_quoted');
});

test('specDiffNote names a real grade conflict specifically', () => {
  assert.match(specDiffNote('Grade SS 310 anchor', 'Anchor Grade 253 MA'), /grade differs.*SS 310.*253 MA/);
  assert.equal(specDiffNote('V DIA 10MM AISI 310 CAPPED DRWG', 'SS 310 anchor 10x70 DRG NCC-KL-42'), 'size/drawing described differently');
});
