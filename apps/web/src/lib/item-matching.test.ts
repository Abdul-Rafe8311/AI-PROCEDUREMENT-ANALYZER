import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePrSubject,
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

test('PHASE 2: clean matches, freight excluded, and a not-quoted item detected', () => {
  const m = matchSupplierItems(qa, pr.items);
  // anchor→PR0 and castable→PR1 are clean description matches.
  assert.equal(m.prItems[0].state, 'quoted_match');
  assert.equal(m.prItems[1].state, 'quoted_match');
  // The ceramic blanket (PR item 2) was not quoted at all.
  assert.equal(m.prItems[2].state, 'not_quoted');
  assert.equal(m.prItems[2].supplierItem, null);
  assert.equal(m.matchCount, 2);
  assert.equal(m.specDiffCount, 0);
  assert.equal(m.notQuotedCount, 1);
  // Freight is not a product line → never a PR match or an extra line.
  assert.equal(m.extraLines.length, 0);
  assert.equal(m.allMatched, false);
  // States cover every PR item exactly once.
  assert.equal(m.matchCount + m.specDiffCount + m.notQuotedCount, pr.items.length);
});

test('PHASE 2: a wrong-grade quote maps by DIMENSION as "quoted, spec differs"', () => {
  const m = matchSupplierItems(qb, pr.items);
  // The 304 anchor has no clean description match (wrong grade), but its dimensions
  // (200/140) uniquely identify PR item 0 → mapped by dimension → quoted_spec_diff
  // (shown & flagged, never dropped). Quantity is never a gate.
  const anchorPr = m.prItems[0];
  assert.equal(anchorPr.state, 'quoted_spec_diff');
  assert.equal(anchorPr.mappedBy, 'dimension');
  assert.ok(/304/.test(anchorPr.supplierItem!.name));
  // The blanket is a clean description match and its spec agrees → not flagged.
  assert.equal(m.prItems[2].state, 'quoted_match');
  assert.equal(m.prItems[2].mappedBy, 'description');
  // The castable (PR item 1) was not quoted at all.
  assert.equal(m.prItems[1].state, 'not_quoted');
  assert.equal(m.matchCount, 1);
  assert.equal(m.specDiffCount, 1);
  assert.equal(m.notQuotedCount, 1);
  assert.equal(m.matchCount + m.specDiffCount + m.notQuotedCount, pr.items.length);
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

// Fallback PR subject when the requisition has no header description of its own:
// the dominant item NOUN across the line items (ignoring adjectives/spec codes).
test('SUBJECT: derives dominant noun across items (anchors → "Anchors")', () => {
  assert.equal(
    derivePrSubject([
      'Anchor, Corrugated, Type Tws.10(60)-200(140)-40-253, Grade 253 Ma',
      'Corrugated Anchor 253 c/w plastic caps',
      'Anchor Corrugated, 304 SS',
    ]),
    'Anchors',
  );
});

test('SUBJECT: leads on the noun, not a leading adjective ("Refractory" → "Castables")', () => {
  assert.equal(
    derivePrSubject(['Refractory Castable, 60% Alumina', 'Refractory Castable 1600C']),
    'Castables',
  );
});

test('SUBJECT: heterogeneous items with no majority noun → blank (never a wrong guess)', () => {
  assert.equal(derivePrSubject(['Anchor 253', 'Refractory Castable', 'Gate Valve DN50']), '');
  assert.equal(derivePrSubject([]), '');
});
