// Regression tests for the three reported TA-form / pipeline bugs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAnalysis, ensureUniqueQuotationIds } from './analysis-engine';
import { matchSupplierItems, suggestTechnicalComments } from './item-matching';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import type { ExtractedQuotation, PrItem } from './workspace-types';

// ── BUG 3: a duplicate quotation id must never collapse two suppliers' data ──
test('BUG3: ensureUniqueQuotationIds de-duplicates colliding ids', () => {
  const q = [
    { id: 'q_0_0', supplierName: 'Supply Wave' },
    { id: 'q_0_0', supplierName: 'Krosaki' },
    { id: 'q_0_1', supplierName: 'Al Najim' },
  ] as unknown as ExtractedQuotation[];
  const out = ensureUniqueQuotationIds(q);
  assert.equal(new Set(out.map((x) => x.id)).size, 3, 'all ids unique');
  assert.equal(out[0].id, 'q_0_0');
  assert.notEqual(out[1].id, out[0].id, 'the collision was reassigned');
  assert.equal(out[2].id, 'q_0_1');
});

test('BUG3: per-supplier technical comments are not cross-contaminated by a dup id', () => {
  const pr = purchaseRequisitionFromLlm(
    {
      requestNo: '1',
      description: 'Anchors for Kiln department',
      items: [
        { itemCode: 'A', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', quantity: 2000, unit: 'EA' },
        { itemCode: 'B', description: 'Anchor Corrugated TWS.10(60)-200(140)-40-253 Grade 253 MA', quantity: 10000, unit: 'EA' },
      ],
    },
    'pr.pdf',
  )!;
  const mk = (name: string, price: number): LlmSupplier => ({
    supplierName: name, reference: null, prNumber: null, currency: 'SAR', totalAmount: null, vatAmount: null,
    totalWithoutVat: null, totalsByCurrency: null, deliveryTime: '2 weeks', deliveryTerms: null,
    countryOfOrigin: 'Saudi Arabia', paymentTerms: null, warranty: null, validUntil: null,
    lineItems: pr.items.map((it) => ({ name: it.description, quantity: it.quantity!, unitPrice: price, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null })),
  });
  const q = quotationsFromLlmSuppliers([mk('Supply Wave', 3), mk('Krosaki', 5)], 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
  // Force the collision the real extraction produced.
  (q[1] as { id: string }).id = q[0].id;
  const analysis = assembleAnalysis(q, false, pr);
  const comments = suggestTechnicalComments(analysis.prMatch, pr);
  const ids = analysis.quotations.map((x) => x.id);
  assert.equal(new Set(ids).size, 2, 'ids de-duplicated by assembleAnalysis');
  // Each column resolves to its OWN comment (no last-write-wins collapse).
  const c0 = comments[analysis.quotations[0].id];
  const c1 = comments[analysis.quotations[1].id];
  assert.ok(c0 && c1, 'both comments present');
});

// ── BUG 1 #3: AISI 310 / SUS 310 / SS310 are the SAME material as PR "SS 310" ──
// Two PR rows so the V-anchor is placed by its distinctive 10×70 dimension (a real
// match, not the weak quantity fallback) and the GRADE equivalence is what decides
// clean-vs-spec-diff — which is exactly what the AISI↔SS unification fixes.
const prTwo: PrItem[] = [
  { itemCode: '404602703004', description: 'Anchor, Corrugated, TWS.10(60)-200(140)-40-253, Grade 253 MA', descriptionArabic: null, quantity: 10000, unit: 'EA' },
  { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', descriptionArabic: null, quantity: 2000, unit: 'EA' },
];
const anchorSupplier = (vAnchorName: string): ExtractedQuotation =>
  ({ id: 'k', supplierName: 'Krosaki', currency: 'EUR', lineItems: [
    { name: 'Corrugated anchor TWS.10(60)-200(140)-40-253 Grade 253 MA', quantity: 10000, unitPrice: 2.42, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: vAnchorName, quantity: 2000, unitPrice: 0.95, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
  ] }) as unknown as ExtractedQuotation;

test('BUG1: AISI 310 matches the PR SS 310 anchor cleanly (not a spec difference)', () => {
  const m = matchSupplierItems(anchorSupplier('V DIA 10MM H=70MM AISI 310 CAPPED'), prTwo);
  assert.equal(m.prItems[1].state, 'quoted_match', 'AISI 310 == SS 310 → clean match on the V-anchor row');
  assert.notEqual(m.prItems[1].state, 'not_quoted', 'the SS 310 V-anchor is quoted, never dropped');
});

test('BUG1: a genuinely different grade still separates (SS 304 ≠ SS 310)', () => {
  const m = matchSupplierItems(anchorSupplier('V DIA 10MM H=70MM AISI 304 CAPPED'), prTwo);
  assert.equal(m.prItems[1].state, 'quoted_spec_diff', 'AISI 304 vs SS 310 → spec differs (grades really differ)');
});
