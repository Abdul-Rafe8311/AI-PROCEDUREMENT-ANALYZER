// Acceptance for the Technical Approval Form against the REAL PR 12601612:
// the form is anchored to the 5 PR item rows (+ freight), one column per supplier,
// mapped by exact quantity, with grade conflicts tagged "spec differs" — and it
// NEVER falls back to a supplier-description union.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';
import { matchQuotationsToPr, suggestTechnicalComments } from './item-matching';
import { buildComparisonModel } from './pr-comparison';

const PR_QTYS = [10000, 2000, 1500, 300, 700];
// PR grades per the company sheet: item2 is an SS 310 anchor; items 4–5 are 253 C.
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for production department.',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', quantity: 2000, unit: 'EA' },
      { itemCode: '404602703033', description: 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 1500, unit: 'EA' },
      { itemCode: '404602703042', description: 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 300, unit: 'EA' },
      { itemCode: '404602703043', description: 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 700, unit: 'EA' },
    ],
  },
  'pr-12601612.pdf',
)!;

const partNos = (prefix: string, prices: number[]): LlmSupplier['lineItems'] =>
  PR_QTYS.map((qty, i) => ({ name: `${prefix}.${i + 1}`, quantity: qty, unitPrice: prices[i], totalPrice: Math.round(prices[i] * qty * 100) / 100, category: 'product', uom: 'EA', availableInDays: null }));
const freight = (name: string, amount: number): LlmSupplier['lineItems'][number] =>
  ({ name, quantity: 1, unitPrice: null, totalPrice: amount, category: 'freight', uom: null, availableInDays: null });

// Krosaki & Refratechnik quote by internal part number (EUR) → clean by qty.
const krosaki: LlmSupplier = {
  supplierName: 'KROSAKI', reference: 'OFR26-0040', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4 weeks after official order', deliveryTerms: 'CIF JEDDAH', paymentTerms: 'CAD', warranty: null, validUntil: null,
  lineItems: [...partNos('TWS.10(60)-200', [2.42, 0.95, 2.93, 2.26, 2.33]), freight('TRANSPORT PRICE CIF JEDDAH', 3590)],
};
const refratechnik: LlmSupplier = {
  supplierName: 'Refratechnik', reference: '9100147169', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4-5 weeks', deliveryTerms: 'FOB', paymentTerms: 'Cash against documents', warranty: null, validUntil: null,
  lineItems: [...partNos('REVA-W.10', [3.07, 3.21, 3.7, 4.12, 2.8]), freight('Freight and FOB charges', 870)],
};
// AL-NAJIM (SAR) quotes full descriptions that match the PR grades → all clean.
const alnajim: LlmSupplier = {
  supplierName: 'AL NAJIM', reference: 'WS/QM/06/26-117', prNumber: '12601612', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '08 - Weeks', deliveryTerms: 'by Naqel', paymentTerms: '100% Advance', warranty: null, validUntil: null,
  lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: it.quantity!, unitPrice: [16, 6, 19, 14, 15][i], totalPrice: null, category: 'product', uom: 'EA', availableInDays: null })),
};
// Alfran (SAR) quotes "253 MA" on EVERY row → items 4–5 conflict with PR "253 C".
const alfran: LlmSupplier = {
  supplierName: 'AlFRAN', reference: 'Q-ASA-NCC-260603', prNumber: '12601612', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '65 days after order confirmation', deliveryTerms: 'DDP', paymentTerms: '30 DAYS CREDIT', warranty: null, validUntil: null,
  lineItems: [
    { name: 'Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 10000, unitPrice: 10, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', quantity: 2000, unitPrice: 5, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 1500, unitPrice: 12, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 300, unitPrice: 9, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 700, unitPrice: 10, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    freight('Transportation', 7900),
  ],
};
// Supply Wave (SAR) quotes "SS 310" on every corrugated row (1,3,4,5) → those
// conflict with the PR's 253 grades; row 2 is the matching SS 310 anchor.
const supplyWave: LlmSupplier = {
  supplierName: 'Supply Wave', reference: 'SW-2606082547', prNumber: '12601612', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '88 Days', deliveryTerms: 'EX WORKS', paymentTerms: '30 Days', warranty: null, validUntil: null,
  lineItems: [
    { name: 'Anchor Corrugated Type: TWS.10(60)-200(140)-40-310. Material GRADE - SS 310', quantity: 10000, unitPrice: 10, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', quantity: 2000, unitPrice: 3, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor Corrugated Type: TWS.10(60)-250(140)-40-310. Material GRADE - SS 310', quantity: 1500, unitPrice: 12, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor Corrugated Type: TWS.10(60)-170(80)-40-310. Material GRADE - SS 310', quantity: 300, unitPrice: 9, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'Anchor Corrugated Type: TWS.10(60)-180(100)-40-310. Material GRADE - SS 310', quantity: 700, unitPrice: 9, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
  ],
};

const quotations = quotationsFromLlmSuppliers([krosaki, alnajim, alfran, supplyWave, refratechnik], 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
const prMatch = matchQuotationsToPr(quotations, pr);

test('TA FORM: exactly 5 PR rows + 1 freight row (NOT 23), anchored to the PR, no union', () => {
  const model = buildComparisonModel(quotations, pr, prMatch, { prOnly: true });
  assert.equal(model.hasPr, true);
  const productRows = model.rows.filter((r) => r.kind !== 'charge');
  const chargeRows = model.rows.filter((r) => r.kind === 'charge');
  // eslint-disable-next-line no-console
  console.log(`TA FORM row count → product=${productRows.length} charge=${chargeRows.length} total=${model.rows.length}`);
  assert.equal(productRows.length, 5);
  assert.equal(chargeRows.length, 1); // one collapsed Freight/Transport row
  assert.equal(model.rows.length, 6);
});

test('TA FORM: every supplier fills all 5 PR rows — ZERO "Not Quoted" cells', () => {
  const model = buildComparisonModel(quotations, pr, prMatch, { prOnly: true });
  const productRows = model.rows.filter((r) => r.kind !== 'charge');
  for (const row of productRows) {
    row.cells.forEach((cell, i) =>
      assert.ok(cell, `supplier ${model.suppliers[i].supplier} missing a cell on "${row.label.slice(0, 30)}"`),
    );
  }
});

test('TA FORM: grade conflicts tag "spec differs" — Supply Wave rows 1,3,4,5 and Alfran rows 4-5', () => {
  const sw = prMatch.bySupplier.find((s) => s.supplier === 'Supply Wave')!;
  for (const idx of [0, 2, 3, 4]) {
    assert.equal(sw.prItems[idx].state, 'quoted_spec_diff', `Supply Wave row ${idx + 1} (SS 310) spec differs`);
  }
  assert.equal(sw.prItems[1].state, 'quoted_match', 'Supply Wave row 2 (SS 310 anchor) matches');
  assert.equal(sw.specDiffCount, 4);

  const alf = prMatch.bySupplier.find((s) => s.supplier === 'AlFRAN')!;
  assert.equal(alf.prItems[3].state, 'quoted_spec_diff', 'Alfran row 4 (253 MA vs 253 C) spec differs');
  assert.equal(alf.prItems[4].state, 'quoted_spec_diff', 'Alfran row 5 (253 MA vs 253 C) spec differs');
  assert.equal(alf.specDiffCount, 2);

  // Everyone quoted everything → nobody has a not-quoted row.
  for (const sm of prMatch.bySupplier) assert.equal(sm.notQuotedCount, 0, `${sm.supplier} not-quoted`);
});

test('TA FORM: AI-SUGGESTED Technical Comment verdicts per supplier', () => {
  const comments = suggestTechnicalComments(prMatch, pr);
  const verdictFor = (name: string) =>
    comments[quotations.find((q) => q.supplierName === name)!.id]?.text;

  // AL-NAJIM quotes exact PR descriptions/grades → clean acceptance.
  assert.equal(verdictFor('AL NAJIM'), 'AI SUGGESTED: Technically Accepted');
  // Supply Wave: SS 310 grade conflicts on items 1,3,4,5.
  assert.equal(
    verdictFor('Supply Wave'),
    'AI SUGGESTED: Technically Accepted — spec differs on items 1,3,4,5, review grade',
  );
  // Alfran: 253 MA vs PR 253 C on items 4,5.
  assert.equal(
    verdictFor('AlFRAN'),
    'AI SUGGESTED: Technically Accepted — spec differs on items 4,5, review grade',
  );
  // Every verdict is AI-suggested and prefixed for the indigo/italic style.
  for (const q of quotations) {
    assert.equal(comments[q.id].aiSuggested, true);
    assert.ok(comments[q.id].text.startsWith('AI SUGGESTED: '), `${q.supplierName} prefixed`);
  }
});

test('TA FORM: PR Description prints the FULL text (not truncated to "Anchors")', () => {
  assert.equal(pr.description, 'Anchors for production department.');
});

test('TA FORM: the supplier-union fallback is GONE — no PR items ⇒ zero product rows', () => {
  const model = buildComparisonModel(quotations, null, null, { prOnly: true });
  assert.equal(model.hasPr, false);
  assert.equal(model.rows.filter((r) => r.kind !== 'charge').length, 0, 'never fabricates rows from supplier descriptions');
});

test('MATCHING: a PR qty different from the supplier qty NEVER causes "Not Quoted"', () => {
  // Reproduce the reported bug: PR row 1 qty is (wrongly) doubled to 20,000 while
  // every supplier quotes 10,000. Description/order matching must still fill row 1.
  const prDoubled = purchaseRequisitionFromLlm(
    {
      requestNo: '12601612',
      description: 'Anchors for production department.',
      items: pr.items.map((it, i) => ({
        itemCode: it.itemCode,
        description: it.description,
        quantity: i === 0 ? 20000 : it.quantity, // row 1 doubled
        unit: it.unit,
      })),
    },
    'pr.pdf',
  )!;
  assert.equal(prDoubled.items[0].quantity, 20000);

  const m2 = matchQuotationsToPr(quotations, prDoubled);
  for (const sm of m2.bySupplier) {
    assert.equal(sm.prItems[0].state !== 'not_quoted', true, `${sm.supplier} row 1 must be quoted despite qty mismatch`);
    // The cell keeps the supplier's OWN quantity (10,000), not the PR's 20,000.
    assert.equal(sm.prItems[0].supplierItem!.quantity, 10000, `${sm.supplier} shows its own qty`);
    assert.equal(sm.notQuotedCount, 0, `${sm.supplier} has zero not-quoted`);
  }
});
