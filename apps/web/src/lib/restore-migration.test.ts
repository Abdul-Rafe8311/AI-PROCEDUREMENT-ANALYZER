// Regression: a session persisted BEFORE the PR-item match refactor stores the
// OLD SupplierMatch shape (items / mismatchCount / missingPrIndexes, no prItems).
// Restoring it must NOT crash the new UI, and normalizeRestoredAnalysis must
// upgrade it to the current shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';
import { normalizeRestoredAnalysis } from './analysis-engine';
import { buildComparisonModel } from './pr-comparison';
import { suggestTechnicalComments } from './item-matching';
import type { AnalysisResult, PrMatchResult } from './workspace-types';

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for production department',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated Tws.10(60)-200(140)-40-253, Grade 253 Ma', quantity: 10000, unit: 'NO' },
      { itemCode: '404602703005', description: 'Anchor, Corrugated Tws.10(60)-070(050)-40-253', quantity: 2000, unit: 'NO' },
    ],
  },
  'pr.pdf',
)!;

const sup: LlmSupplier = {
  supplierName: 'Krosaki', reference: 'KR-77', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4 to 5 weeks', deliveryTerms: 'FOB', paymentTerms: '30 days', warranty: null, validUntil: null,
  lineItems: [
    { name: 'REVA-W.10-200', quantity: 10000, unitPrice: 2.42, totalPrice: 24200, category: 'product', uom: 'NO', availableInDays: null },
    { name: 'REVA.10-070', quantity: 2000, unitPrice: 1.9, totalPrice: 3800, category: 'product', uom: 'NO', availableInDays: null },
  ],
};
const quotations = quotationsFromLlmSuppliers([sup], 'q.pdf', { currency: 'EUR', confidence: 0.9 });

// A persisted analysis in the OLD shape — prMatch.bySupplier[].items exists but
// prItems / specDiffCount / extraLines do NOT (they read back as undefined).
const oldPrMatch = {
  threshold: 0.5,
  bySupplier: [
    {
      supplier: 'Krosaki',
      quotationId: quotations[0].id,
      items: [
        { supplierItem: quotations[0].lineItems[0], prIndex: null, closestPrIndex: 0, status: 'mismatch', score: 0.2 },
        { supplierItem: quotations[0].lineItems[1], prIndex: null, closestPrIndex: 1, status: 'mismatch', score: 0.2 },
      ],
      missingPrIndexes: [0, 1],
      approvedCount: 0,
      mismatchCount: 2,
      allMatched: false,
    },
  ],
} as unknown as PrMatchResult;

const restored: AnalysisResult = {
  quotations,
  recommendation: {},
  risks: [],
  simulated: false,
  purchaseRequisition: pr,
  prMatch: oldPrMatch,
};

test('RESTORE: old-shape prMatch does NOT crash the comparison builder or comment suggester', () => {
  // These are the exact call sites that previously threw on `sm.prItems`.
  assert.doesNotThrow(() => buildComparisonModel(quotations, pr, oldPrMatch));
  assert.doesNotThrow(() => suggestTechnicalComments(oldPrMatch, pr));
});

test('RESTORE: normalizeRestoredAnalysis upgrades prMatch to the current shape', () => {
  const fixed = normalizeRestoredAnalysis(restored);
  const sm = fixed.prMatch!.bySupplier[0];
  assert.ok(Array.isArray(sm.prItems), 'prItems is rebuilt as an array');
  assert.equal(sm.prItems.length, pr.items.length);
  assert.equal(sm.matchCount + sm.specDiffCount + sm.notQuotedCount, pr.items.length);
  // Both part-number lines map to the PR by exact quantity → quoted (not missing).
  assert.equal(sm.notQuotedCount, 0);
  // After the upgrade the comparison shows the quoted items (not blank).
  const model = buildComparisonModel(quotations, pr, fixed.prMatch);
  assert.ok(model.rows[0].cells[0], 'PR row 1 is filled after migration');
  assert.equal(model.rows[0].cells[0]!.unitPrice, 2.42);
});

test('RESTORE: an analysis with no PR normalizes to prMatch = null', () => {
  const noPr = normalizeRestoredAnalysis({ ...restored, purchaseRequisition: undefined, prMatch: oldPrMatch });
  assert.equal(noPr.prMatch, null);
});
