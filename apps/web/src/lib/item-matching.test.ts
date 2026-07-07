import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_THRESHOLD,
  matchQuotationsToPr,
  matchSupplierItems,
  similarity,
} from './item-matching';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';

// The company's requisition: an anchor with a distinctive spec code + grade,
// a castable, and a ceramic-fibre blanket.
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: 'PR-2024-00817',
    items: [
      {
        itemCode: '1000123',
        description:
          'Anchor, Corrugated, Type. Tws.10(60)-200(140)-40-253, Material Grade 253 Ma. With Plastic Caps.',
        quantity: 200,
        unit: 'SET',
      },
      { itemCode: '1000124', description: 'Refractory Castable, 60% Alumina', quantity: 12, unit: 'BAG' },
      { itemCode: '1000130', description: 'Ceramic Fibre Blanket 128kg/m3, 25mm thick', quantity: 50, unit: 'ROLL' },
    ],
  },
  'pr.pdf',
)!;

const detected = { currency: 'SAR', confidence: 0.99 };

test('similarity: same anchor spec matches strongly despite different wording', () => {
  const a = pr.items[0].description;
  const b = 'Corrugated Anchor Tws.10(60)-200(140)-40-253, Grade 253 Ma, incl plastic caps';
  assert.ok(similarity(a, b) >= 0.8, `expected strong match, got ${similarity(a, b)}`);
});

test('similarity: a WRONG grade drops below the match threshold', () => {
  const a = pr.items[0].description;
  const wrongGrade = 'Corrugated Anchor Tws.10(60)-200(140)-40-304, Grade 304 SS';
  assert.ok(
    similarity(a, wrongGrade) < MATCH_THRESHOLD,
    `wrong-grade should not match, got ${similarity(a, wrongGrade)}`,
  );
});

test('similarity: unrelated items score near zero', () => {
  assert.ok(similarity('Portland Cement 50kg', pr.items[0].description) < 0.2);
});

// Supplier A quotes the anchor (reworded) + the castable, plus sea freight, but
// does NOT quote the ceramic blanket.
const supplierA: LlmSupplier = {
  supplierName: 'Gulf Refractory',
  reference: 'GRT-1',
  currency: 'SAR',
  totalAmount: 41180,
  totalsByCurrency: null,
  deliveryTime: '45 days',
  deliveryTerms: 'CIF Jeddah',
  paymentTerms: '30 days credit',
  warranty: '12 months',
  validUntil: null,
  lineItems: [
    { name: 'Corrugated Anchor Tws.10(60)-200(140)-40-253, Grade 253 Ma, incl plastic caps', quantity: 200, unitPrice: 160, totalPrice: 32000, category: 'product' },
    { name: '60% Alumina Refractory Castable', quantity: 12, unitPrice: 640, totalPrice: 7680, category: 'product' },
    { name: 'Sea freight to Jeddah', quantity: null, unitPrice: null, totalPrice: 1500, category: 'freight' },
  ],
};

// Supplier B quotes a WRONG-grade anchor (304) + the blanket; skips the castable.
const supplierB: LlmSupplier = {
  supplierName: 'Delta Traders',
  reference: 'DT-9',
  currency: 'USD',
  totalAmount: 12000,
  totalsByCurrency: null,
  deliveryTime: '30 days',
  deliveryTerms: 'EXW',
  paymentTerms: '100% advance',
  warranty: null,
  validUntil: null,
  lineItems: [
    { name: 'Stainless Corrugated Anchor Tws.10(60)-200(140)-40-304, Grade 304 SS', quantity: 200, unitPrice: 40, totalPrice: 8000, category: 'product' },
    { name: 'Ceramic Fibre Blanket 128kg/m3 25mm', quantity: 50, unitPrice: 80, totalPrice: 4000, category: 'product' },
  ],
};

const [qa, qb] = quotationsFromLlmSuppliers([supplierA, supplierB], 'compare.pdf', detected);

test('PHASE 2: approved items, freight excluded, and not-quoted item detected', () => {
  const m = matchSupplierItems(qa, pr.items);
  // Only the 2 PRODUCT lines are matched (freight is excluded from matching).
  assert.equal(m.items.length, 2);
  assert.equal(m.approvedCount, 2);
  assert.equal(m.mismatchCount, 0);
  // The anchor and castable map to PR items 0 and 1 respectively.
  const prIndexes = m.items.map((i) => i.prIndex).sort();
  assert.deepEqual(prIndexes, [0, 1]);
  // The ceramic blanket (PR item 2) was not quoted → missing.
  assert.deepEqual(m.missingPrIndexes, [2]);
  assert.equal(m.allMatched, false);
});

test('PHASE 2: a wrong-grade quote is a mismatch, not an approval', () => {
  const m = matchSupplierItems(qb, pr.items);
  const anchor = m.items.find((i) => /304/.test(i.supplierItem.name))!;
  assert.equal(anchor.status, 'mismatch');
  assert.equal(anchor.prIndex, null);
  // Its closest requisition item is still the 253 anchor (for requested-vs-quoted).
  assert.equal(anchor.closestPrIndex, 0);
  // The blanket matched PR item 2.
  const blanket = m.items.find((i) => /blanket/i.test(i.supplierItem.name))!;
  assert.equal(blanket.status, 'approved');
  assert.equal(blanket.prIndex, 2);
  assert.equal(m.mismatchCount, 1);
  // Castable (1) and the anchor's PR item (0) are not covered.
  assert.deepEqual(m.missingPrIndexes.sort(), [0, 1]);
});

test('PHASE 2: matchQuotationsToPr covers every supplier', () => {
  const result = matchQuotationsToPr([qa, qb], pr);
  assert.equal(result.bySupplier.length, 2);
  assert.equal(result.threshold, MATCH_THRESHOLD);
  assert.deepEqual(
    result.bySupplier.map((s) => s.supplier),
    ['Gulf Refractory', 'Delta Traders'],
  );
});
