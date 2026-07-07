import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonModel } from './pr-comparison';
import { matchQuotationsToPr } from './item-matching';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: 'PR-1',
    items: [
      { itemCode: '1000123', description: 'Anchor, Corrugated, Type. Tws.10(60)-200(140)-40-253, Grade 253 Ma. With Plastic Caps.', quantity: 200, unit: 'SET' },
      { itemCode: '1000124', description: 'Refractory Castable, 60% Alumina', quantity: 12, unit: 'BAG' },
      { itemCode: '1000130', description: 'Ceramic Fibre Blanket 128kg/m3, 25mm', quantity: 50, unit: 'ROLL' },
    ],
  },
  'pr.pdf',
)!;

const gulf: LlmSupplier = {
  supplierName: 'Gulf', reference: 'G1', currency: 'SAR', totalAmount: 41180, totalsByCurrency: null,
  deliveryTime: '45 days', deliveryTerms: 'CIF Jeddah', paymentTerms: '30 days', warranty: '12m', validUntil: null,
  lineItems: [
    { name: 'Corrugated Anchor Tws.10(60)-200(140)-40-253, Grade 253 Ma, incl plastic caps', quantity: 200, unitPrice: 160, totalPrice: 32000, category: 'product' },
    { name: '60% Alumina Refractory Castable', quantity: 12, unitPrice: 640, totalPrice: 7680, category: 'product' },
    { name: 'Sea freight to Jeddah', quantity: null, unitPrice: null, totalPrice: 1500, category: 'freight' },
  ],
};
const delta: LlmSupplier = {
  supplierName: 'Delta', reference: 'D9', currency: 'USD', totalAmount: 12000, totalsByCurrency: null,
  deliveryTime: '30 days', deliveryTerms: 'EXW', paymentTerms: '100% advance', warranty: null, validUntil: null,
  lineItems: [
    { name: 'Stainless Corrugated Anchor Tws.10(60)-200(140)-40-304, Grade 304 SS', quantity: 200, unitPrice: 40, totalPrice: 8000, category: 'product' },
    { name: 'Ceramic Fibre Blanket 128kg/m3 25mm', quantity: 50, unitPrice: 80, totalPrice: 4000, category: 'product' },
  ],
};

// Euro quotes all three correctly (in EUR) → gives PR rows with multiple bids.
const euro: LlmSupplier = {
  supplierName: 'Euro', reference: 'E7', currency: 'EUR', totalAmount: 9700, totalsByCurrency: null,
  deliveryTime: '60 days', deliveryTerms: 'FOB Hamburg', paymentTerms: '50% advance', warranty: null, validUntil: null,
  lineItems: [
    { name: 'Corrugated Anchor Tws.10(60)-200(140)-40-253 Grade 253 Ma with plastic caps', quantity: 200, unitPrice: 35, totalPrice: 7000, category: 'product' },
    { name: 'Refractory Castable 60% Alumina', quantity: 12, unitPrice: 150, totalPrice: 1800, category: 'product' },
    { name: 'Ceramic Fibre Blanket 128kg/m3 25mm', quantity: 50, unitPrice: 18, totalPrice: 900, category: 'product' },
  ],
};

const qs = quotationsFromLlmSuppliers([gulf, delta, euro], 'c.pdf', { currency: 'SAR', confidence: 0.99 });

test('PHASE 3: PR rows use the COMPANY description/qty/uom, in PR order', () => {
  const model = buildComparisonModel(qs, pr, matchQuotationsToPr(qs, pr));
  assert.equal(model.hasPr, true);
  const prRows = model.rows.filter((r) => r.kind === 'pr');
  assert.equal(prRows.length, 3);
  assert.match(prRows[0].label, /^Anchor, Corrugated/); // company wording, not "Corrugated Anchor"
  assert.equal(prRows[0].qty, 200);
  assert.equal(prRows[0].uom, 'SET');
});

test('PHASE 3: approved cell fills; a mismatched supplier item does NOT fill a PR row', () => {
  const model = buildComparisonModel(qs, pr, matchQuotationsToPr(qs, pr));
  const anchor = model.rows[0];
  // Gulf (col 0) approved → filled with its quoted qty & price.
  assert.ok(anchor.cells[0]);
  assert.equal(anchor.cells[0]!.unitPrice, 160);
  assert.equal(anchor.cells[0]!.currency, 'SAR');
  // Delta (col 1) quoted a WRONG-grade anchor → mismatch → cell stays null.
  assert.equal(anchor.cells[1], null);
});

test('PHASE 3: freight collapses into one Freight / Transport charge row', () => {
  const model = buildComparisonModel(qs, pr, matchQuotationsToPr(qs, pr));
  const charges = model.rows.filter((r) => r.kind === 'charge');
  const freight = charges.find((r) => r.label === 'Freight / Transport');
  assert.ok(freight, 'a freight row exists');
  assert.equal(freight!.cells[0]!.unitPrice, 1500); // Gulf's freight
  assert.equal(freight!.cells[1], null); // Delta folded freight into terms → no separate line
});

test('PHASE 3: lowestUsd marks the cheapest present cell (compared in USD across currencies)', () => {
  const model = buildComparisonModel(qs, pr, matchQuotationsToPr(qs, pr));
  // Anchor row: Gulf (SAR) approved + Euro (EUR) approved; Delta (wrong grade) excluded.
  const anchor = model.rows[0];
  const present = anchor.cells.filter((c) => c && c.unitPriceUsd != null).map((c) => c!.unitPriceUsd!);
  assert.ok(present.length >= 2, `expected ≥2 bids, got ${present.length}`);
  assert.equal(anchor.lowestUsd, Math.min(...present));
});

test('PHASE 3: with no PR, falls back to a union of supplier items', () => {
  const model = buildComparisonModel(qs, null, null);
  assert.equal(model.hasPr, false);
  const productRows = model.rows.filter((r) => r.kind === 'product');
  // Union of distinct product lines across both suppliers (anchor253, castable, anchor304, blanket).
  assert.ok(productRows.length >= 3);
});
