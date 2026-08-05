// One quotation offering several priced ALTERNATIVES → one supplier column each,
// decided against the company requisition.
//
// FAOZ INDUST'L. EQUIPS CO., quote QT 000030292 against PR 12602262. The Option
// column reads A, B, 2:
//
//   A  cover part no 866, ident no. 146328.02 … AISI 4140  1 PC  22,000.00
//   B  cover part no 866, ident no. 146328.02 … ST-52      1 PC   8,000.00
//   2  Bolt  part no 874, ident no. 146332.06 … 42CrMo4    1 PC      850.00
//
// A and B are alternatives for PR item 1. The 2 is the second ROW, answering PR
// item 2 — not an option. Comparing the supplier's lines to each other cannot
// tell those apart: cover and bolt share "for grinding roller stop - inside for
// VRM" and score 0.714 on terse wording, which produced a phantom third column.
// The requisition's part/ident numbers settle it.
//
// Fixture data through the real pipeline. No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { splitQuotationOptions } from './quote-options';
import { buildComparisonModel } from './pr-comparison';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import type { ExtractedQuotation } from './workspace-types';

const FAOZ = "FAOZ INDUST'L. EQUIPS CO.";
const REF = 'QT 000030292';

// The requisition's own wording — the authority on which items exist.
const PR_COVER = 'COVER (ROLLER STOP INSIDE), PART NO 866, IDENT NO. 146328.02 FOR GRINDING ROLLER STOP - INSIDE FOR VRM';
const PR_BOLT = 'BOLT, PART NO=874, IDENT NO=146332.06 FOR GRINDING ROLLER STOP - INSIDE FOR VRM';

const pr = purchaseRequisitionFromLlm(
  { requestNo: '12602262', description: 'COVER (ROLLER STOP INSIDE) and bolt for VRM 3', items: [
    { itemCode: '404602799866', description: PR_COVER, quantity: 1, unit: 'EA' },
    { itemCode: '404602799874', description: PR_BOLT, quantity: 1, unit: 'EA' },
  ] },
  'NCC_Print_Purchase_Requisition_050826.pdf',
)!;

const line = (o: Record<string, unknown>) => ({
  name: '', quantity: 1, unitPrice: null, totalPrice: null, category: 'product',
  uom: 'PC', availableInDays: null, ...o,
});

const base = (o: Partial<LlmSupplier> = {}): LlmSupplier => ({
  supplierName: FAOZ, reference: REF, prNumber: '12602262', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '35 Days', deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: 'Saudi Arabia', paymentTerms: '100% after completion',
  warranty: null, validUntil: null, lineItems: [], ...o,
});

/** FAOZ exactly as the page prints it — the Bolt carries the row number "2". */
const faoz = (coverA: string, coverB: string, bolt: string): LlmSupplier => base({
  lineItems: [
    line({ name: coverA, unitPrice: 22000, totalPrice: 22000, optionLabel: 'A' }),
    line({ name: coverB, unitPrice: 8000, totalPrice: 8000, optionLabel: 'B' }),
    line({ name: bolt, unitPrice: 850, totalPrice: 850, optionLabel: '2' }),
  ] as LlmSupplier['lineItems'],
});

const FULL = faoz(`${PR_COVER}, Material AISI 4140`, `${PR_COVER}, Material St-52`, `${PR_BOLT}, Mat. 42CrMo4`);
// The wording that defeated similarity matching: no codes, shared trailing phrase.
const TERSE = faoz(
  'Cover for grinding roller stop - inside for VRM, part no 866, AISI 4140',
  'Cover for grinding roller stop - inside for VRM, part no 866, ST-52',
  'Bolt for grinding roller stop - inside for VRM, part no 874, 42CrMo4',
);

const thwainy = base({
  supplierName: 'Thwainy Trading Est.', reference: 'TH-4471', totalAmount: 19500,
  lineItems: [
    line({ name: `${PR_COVER}, AISI 4140`, unitPrice: 18650, totalPrice: 18650 }),
    line({ name: `${PR_BOLT}, 42CrMo4`, unitPrice: 850, totalPrice: 850 }),
  ] as LlmSupplier['lineItems'],
});

const quotesOf = (suppliers: LlmSupplier[]): ExtractedQuotation[] =>
  quotationsFromLlmSuppliers(suppliers, 'QT_NO_30292.pdf', { currency: 'SAR', confidence: 0.99 });

const analysisOf = (suppliers: LlmSupplier[], withPr = true) =>
  applyFxRates(assembleAnalysis(quotesOf(suppliers), false, withPr ? pr : null), FX);

// ── 1. the requisition decides: two options, and a Bolt that is not one ─────

test('PR-ANCHORED: the two covers split; the Bolt’s "2" is row numbering', () => {
  const out = splitQuotationOptions(quotesOf([FULL]), pr);
  assert.deepEqual(out.map((q) => q.supplierName), [`${FAOZ}, OPTION # A`, `${FAOZ}, OPTION # B`]);
});

test('PR-ANCHORED: it holds on the TERSE wording that defeated similarity', () => {
  // Cover-vs-bolt scores 0.714 here — above any usable text threshold. The part
  // numbers 866 / 874 in the requisition are what keep them apart.
  const out = splitQuotationOptions(quotesOf([TERSE]), pr);
  assert.equal(out.length, 2, 'still two columns, never three');
  assert.deepEqual(out.map((q) => q.supplierName), [`${FAOZ}, OPTION # A`, `${FAOZ}, OPTION # B`]);
});

test('PR-ANCHORED: the Bolt is shared into BOTH option columns at 850', () => {
  for (const src of [FULL, TERSE]) {
    const out = splitQuotationOptions(quotesOf([src]), pr);
    for (const q of out) {
      const bolt = q.lineItems.find((l) => /bolt/i.test(l.name));
      assert.ok(bolt, `${q.supplierName} carries the Bolt`);
      assert.equal(bolt!.unitPrice, 850);
    }
  }
});

test('PR-ANCHORED: each column totals only its own option plus the shared lines', () => {
  const out = splitQuotationOptions(quotesOf([FULL]), pr);
  assert.deepEqual(out.map((q) => q.totalCost), [22850, 8850], '22,000+850 and 8,000+850');
});

test('PR-ANCHORED: both options keep the one REF# — it is a single document', () => {
  for (const q of splitQuotationOptions(quotesOf([FULL]), pr)) assert.equal(q.reference, REF);
});

test('PR-ANCHORED: two lines on one PR item at the SAME price are not options', () => {
  const same = faoz(`${PR_COVER}, AISI 4140`, `${PR_COVER}, ST-52`, `${PR_BOLT}, 42CrMo4`);
  same.lineItems[1].unitPrice = 22000;
  same.lineItems[1].totalPrice = 22000;
  const out = splitQuotationOptions(quotesOf([same]), pr);
  assert.equal(out.length, 1, 'no price difference ⇒ no choice to make');
});

test('PR-ANCHORED: UNLABELLED lines on one PR item are additive, not alternatives', () => {
  // Saudi Fal's S1262128249 shape: two differently-priced lines on ONE requisition
  // item, but both payable — a product plus a reactivation fee, summing to the
  // quote's own total. Structurally identical to an option pair; only the absence
  // of labels tells them apart, and the additive reading is the one that preserves
  // the money. (The combining itself is pinned in multi-position-item.test.ts.)
  const additive = base({ lineItems: [
    line({ name: `${PR_COVER}, AISI 4140`, unitPrice: 16430, totalPrice: 16430 }),
    line({ name: `${PR_COVER} — reactivation fee`, unitPrice: 6735, totalPrice: 6735 }),
  ] as LlmSupplier['lineItems'] });
  assert.equal(splitQuotationOptions(quotesOf([additive]), pr).length, 1, 'no labels ⇒ no split');
});

// ── 2. the no-PR fallback ───────────────────────────────────────────────────

test('NO PR: labelled alternatives still split when no requisition was uploaded', () => {
  const out = splitQuotationOptions(quotesOf([FULL]), null);
  assert.equal(out.length, 2, 'the document’s own A/B labels are used');
  assert.deepEqual(out.map((q) => q.totalCost), [22850, 8850]);
});

test('NO PR: a lone row number is not treated as an alternative', () => {
  // Only the Bolt is labelled — one label, nothing to choose between.
  const s = base({ lineItems: [
    line({ name: `${PR_COVER}, AISI 4140`, unitPrice: 22000, totalPrice: 22000 }),
    line({ name: `${PR_BOLT}, 42CrMo4`, unitPrice: 850, totalPrice: 850, optionLabel: '2' }),
  ] as LlmSupplier['lineItems'] });
  assert.equal(splitQuotationOptions(quotesOf([s]), null).length, 1);
});

// ── 3. nothing else is disturbed ────────────────────────────────────────────

test('PASS-THROUGH: an ordinary quotation is returned by identity', () => {
  const qs = quotesOf([thwainy]);
  const out = splitQuotationOptions(qs, pr);
  assert.equal(out.length, 1);
  assert.equal(out[0], qs[0], 'the very same object — nothing rebuilt');
});

test('PASS-THROUGH: the 5-supplier fixture still yields exactly 5 columns', () => {
  assert.equal(buildFreshAnalysis().quotations.length, 5);
});

test('PASS-THROUGH: extraction alone no longer splits — the PR decides, later', () => {
  assert.equal(quotesOf([FULL]).length, 1, 'one document, one quotation at extraction');
});

// ── 4. the form ─────────────────────────────────────────────────────────────

test('FORM: options take real supplier slots, and the next supplier follows', () => {
  const analysis = analysisOf([FULL, thwainy]);
  assert.deepEqual(
    analysis.quotations.map((q) => q.supplierName),
    [`${FAOZ}, OPTION # A`, `${FAOZ}, OPTION # B`, 'Thwainy Trading Est.'],
    'SUPPLIER #1, #2, #3 — numbering is positional',
  );
});

test('FORM: the grid prices each option separately and the Bolt identically', () => {
  const analysis = analysisOf([FULL, thwainy]);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });
  const [cover, bolt] = model.rows.filter((r) => r.kind === 'pr');
  assert.deepEqual(cover.cells.map((c) => c?.unitPrice), [22000, 8000, 18650]);
  assert.deepEqual(bolt.cells.map((c) => c?.unitPrice), [850, 850, 850]);
});

test('FORM: exactly two PR rows — the Bolt never becomes a third item', () => {
  const analysis = analysisOf([FULL, thwainy]);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });
  assert.equal(model.rows.filter((r) => r.kind === 'pr').length, 2);
});

test('FORM: every PR item is quoted in every column', () => {
  for (const sm of analysisOf([FULL, thwainy]).prMatch!.bySupplier) {
    assert.equal(sm.notQuotedCount, 0, `${sm.supplier} quotes both PR items`);
  }
});

// ── 5. scoring: options compete as separate suppliers ───────────────────────

test('SCORE: the cheaper option takes the row highlight against ALL columns', () => {
  const analysis = analysisOf([FULL, thwainy]);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });
  const cover = model.rows.filter((r) => r.kind === 'pr')[0];
  assert.equal(cover.lowestUsd, cover.cells[1]!.unitPriceUsd, 'Option B at 8,000 is lowest');
  assert.ok(cover.cells[1]!.unitPriceUsd! < cover.cells[0]!.unitPriceUsd!);
});

test('SCORE: the options are ranked as separate suppliers overall', () => {
  const analysis = analysisOf([FULL, thwainy]);
  assert.equal(new Set(analysis.quotations.map((q) => q.supplierName)).size, 3);
  assert.equal(analysis.recommendation.lowestCost?.supplier, `${FAOZ}, OPTION # B`);
});

test('SCORE: each option column gets its own distinct id', () => {
  const ids = analysisOf([FULL, thwainy]).quotations.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique — id-keyed joins stay sound');
});
