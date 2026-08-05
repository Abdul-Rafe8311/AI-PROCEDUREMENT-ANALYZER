// One quotation offering several priced ALTERNATIVES → one supplier column each.
//
// FAOZ INDUST'L. EQUIPS CO., quote QT 000030292 against PR 12602262:
//
//   Option A  cover (roller stop inside) … Material: AISI 4140   1 PC  22,000.00
//   Option B  cover (roller stop inside) … Material: ST-52       1 PC   8,000.00
//   2         Bolt part no 874 …          Material: 42CrMo4      1 PC      850.00
//
// A and B are mutually exclusive; the Bolt is payable either way. The form must
// show "FAOZ …, OPTION # A" and "FAOZ …, OPTION # B" as separate supplier columns
// — same REF#, own totals (22,850 / 8,850), Bolt at 850 under both — and keep
// numbering them SUPPLIER #1, #2, with the next real supplier at #3.
//
// Fixture data through the real pipeline. No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { splitQuoteOptions, splitSupplierOptions } from './quote-options';
import { buildComparisonModel } from './pr-comparison';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';

const FAOZ = "FAOZ INDUST'L. EQUIPS CO.";
const REF = 'QT 000030292';
const COVER = 'Supply and fabrication of cover (roller stop inside) part no 866, ident no. 146328.02 for grinding roller stop-inside for VRM';
const BOLT = 'Bolt, Part No=874, ident No=146332.06 for grinding roller stop - inside for VRM, Material: 42CrMo4';

const line = (o: Record<string, unknown>) => ({
  name: '', quantity: 1, unitPrice: null, totalPrice: null, category: 'product',
  uom: 'PC', availableInDays: null, ...o,
});

const faoz = (): LlmSupplier => ({
  supplierName: FAOZ, reference: REF, prNumber: '12602262', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '35 Days', deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: 'Saudi Arabia', paymentTerms: '100% after completion',
  warranty: null, validUntil: null,
  lineItems: [
    line({ name: `${COVER}, Material: AISI 4140.`, unitPrice: 22000, totalPrice: 22000, optionLabel: 'A' }),
    line({ name: `${COVER}, Material: ST-52`, unitPrice: 8000, totalPrice: 8000, optionLabel: 'B' }),
    line({ name: BOLT, unitPrice: 850, totalPrice: 850 }),
  ] as LlmSupplier['lineItems'],
});

const thwainy = (): LlmSupplier => ({
  ...faoz(),
  supplierName: 'Thwainy Trading Est.', reference: 'TH-4471', totalAmount: 19500,
  lineItems: [
    line({ name: `${COVER}, Material: AISI 4140.`, unitPrice: 18650, totalPrice: 18650 }),
    line({ name: BOLT, unitPrice: 850, totalPrice: 850 }),
  ] as LlmSupplier['lineItems'],
});

const pr = purchaseRequisitionFromLlm(
  { requestNo: '12602262', description: 'COVER (ROLLER STOP INSIDE) and bolt for VRM 3', items: [
    { itemCode: '866', description: 'COVER (ROLLER STOP INSIDE), PART NO 866, IDENT NO. 146328.02 FOR GRINDING ROLLER STOP - INSIDE FOR VRM', quantity: 1, unit: 'EA' },
    { itemCode: '874', description: 'BOLT, PART NO=874, IDENT NO=146332.06 FOR GRINDING ROLLER STOP - INSIDE FOR VRM', quantity: 1, unit: 'EA' },
  ] },
  'requisition-12602262.pdf',
)!;

const analysisOf = (suppliers: LlmSupplier[]) =>
  applyFxRates(
    assembleAnalysis(quotationsFromLlmSuppliers(suppliers, 'QT_NO_30292.pdf', { currency: 'SAR', confidence: 0.99 }), false, pr),
    FX,
  );

// ── 1. the split itself ─────────────────────────────────────────────────────

test('SPLIT: two options become two suppliers, labelled as on the form', () => {
  const [a, b, ...rest] = splitSupplierOptions(faoz());
  assert.equal(rest.length, 0, 'exactly two');
  assert.equal(a.supplierName, `${FAOZ}, OPTION # A`);
  assert.equal(b.supplierName, `${FAOZ}, OPTION # B`);
});

test('SPLIT: both options carry the SAME reference — it is one document', () => {
  for (const s of splitSupplierOptions(faoz())) assert.equal(s.reference, REF);
});

test('SPLIT: each option gets its own item PLUS the shared, unlabelled ones', () => {
  const [a, b] = splitSupplierOptions(faoz());
  assert.deepEqual(a.lineItems.map((l) => l.unitPrice), [22000, 850], 'Option A: its cover + the bolt');
  assert.deepEqual(b.lineItems.map((l) => l.unitPrice), [8000, 850], 'Option B: its cover + the bolt');
});

test('SPLIT: totals are recomputed per option, never the document’s single total', () => {
  const [a, b] = splitSupplierOptions(faoz());
  assert.equal(a.totalAmount, 22850, '22,000 + 850');
  assert.equal(b.totalAmount, 8850, '8,000 + 850');
});

test('SPLIT: terms that describe the QUOTE are shared by both options', () => {
  for (const s of splitSupplierOptions(faoz())) {
    assert.equal(s.deliveryTime, '35 Days');
    assert.equal(s.paymentTerms, '100% after completion');
    assert.equal(s.currency, 'SAR');
  }
});

// ── 2. detection: labels, and the absence of them ───────────────────────────

test('DETECT: an option label written into the NAME is found and stripped', () => {
  const s = faoz();
  s.lineItems = s.lineItems.map((l, i) => ({
    ...l, optionLabel: null,
    name: i === 0 ? `Option A — ${COVER}, AISI 4140` : i === 1 ? `OPTION # B: ${COVER}, ST-52` : l.name,
  })) as LlmSupplier['lineItems'];
  const out = splitSupplierOptions(s);
  assert.equal(out.length, 2, 'split on the in-name labels');
  assert.equal(out[0].supplierName, `${FAOZ}, OPTION # A`);
  assert.ok(!out[0].lineItems[0].name.startsWith('Option A'), 'the label is stripped from the description');
  assert.ok(out[0].lineItems[0].name.startsWith('Supply and fabrication'), 'the description survives intact');
});

test('DETECT: "option a" and "OPTION # A" are the SAME option, not two', () => {
  const s = faoz();
  s.lineItems[0].optionLabel = 'option a';
  s.lineItems[1].optionLabel = 'OPTION # a';
  assert.equal(splitSupplierOptions(s).length, 1, 'one label ⇒ no split');
});

test('DETECT: an ordinary quotation is passed through untouched', () => {
  const t = thwainy();
  const out = splitSupplierOptions(t);
  assert.equal(out.length, 1);
  assert.equal(out[0], t, 'the very same object — nothing rebuilt');
});

test('DETECT: the 5-supplier fixture still yields exactly 5 columns', () => {
  assert.equal(buildFreshAnalysis().quotations.length, 5, 'no existing quote is split');
});

// ── 3. the form: columns, numbering, pricing ────────────────────────────────

test('FORM: the options occupy real supplier slots, and the next supplier follows', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  assert.deepEqual(
    analysis.quotations.map((q) => q.supplierName),
    [`${FAOZ}, OPTION # A`, `${FAOZ}, OPTION # B`, 'Thwainy Trading Est.'],
    'SUPPLIER #1, #2, #3 — numbering is positional',
  );
});

test('FORM: each option column prices its own cover, and BOTH show the bolt', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });
  const [cover, bolt] = model.rows.filter((r) => r.kind === 'pr');
  assert.deepEqual(cover.cells.map((c) => c?.unitPrice), [22000, 8000, 18650], 'the cover differs per option');
  assert.deepEqual(bolt.cells.map((c) => c?.unitPrice), [850, 850, 850], 'the bolt is 850 under both options');
});

test('FORM: both PR items are quoted in BOTH option columns', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  for (const sm of analysis.prMatch!.bySupplier) {
    assert.equal(sm.notQuotedCount, 0, `${sm.supplier} quotes every PR item`);
  }
});

test('FORM: the two options carry their own totals', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  const [a, b] = analysis.quotations;
  assert.equal(a.totalCost, 22850);
  assert.equal(b.totalCost, 8850);
});

// ── 4. scoring: options compete like any other supplier ─────────────────────

test('SCORE: the cheaper option wins the row highlight against ALL suppliers', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });
  const cover = model.rows.filter((r) => r.kind === 'pr')[0];
  // Option B (8,000) is the cheapest cover across every column, including Thwainy's
  // 18,650 — so it takes the "lowest" highlight exactly as a third supplier would.
  assert.equal(cover.lowestUsd, cover.cells[1]!.unitPriceUsd, 'Option B is the lowest on the row');
  assert.ok(cover.cells[1]!.unitPriceUsd! < cover.cells[0]!.unitPriceUsd!, 'and it is cheaper than Option A');
});

test('SCORE: the options are ranked as separate suppliers overall', () => {
  const analysis = analysisOf([faoz(), thwainy()]);
  const names = analysis.quotations.map((q) => q.supplierName);
  assert.equal(new Set(names).size, 3, 'three distinct supplier identities');
  assert.equal(analysis.recommendation.lowestCost?.supplier, `${FAOZ}, OPTION # B`, 'the cheapest total wins on cost');
});

// ── 5. the batch helper ─────────────────────────────────────────────────────

test('BATCH: splitting is idempotent — an already-split set is left alone', () => {
  const once = splitQuoteOptions([faoz(), thwainy()]);
  const twice = splitQuoteOptions(once);
  assert.deepEqual(twice.map((s) => s.supplierName), once.map((s) => s.supplierName));
  assert.equal(once.length, 3);
});
