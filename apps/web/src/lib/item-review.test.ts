// Reviewer edits to the Technical Approval Form's comparison table.
//
// The contract: the ORIGINAL extracted value is never overwritten, the form prints
// `edited ?? original`, totals recompute from the reviewed lines, SAR/USD are
// derived from the edited price at the live rate, the "spec differs" flag survives
// an edit, a "Not Quoted" row never becomes quoted by accident — and none of it
// touches scoring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { applyFxRates, assembleAnalysis, scoreSuppliers } from './analysis-engine';
import { buildComparisonModel } from './pr-comparison';
import { matchQuotationsToPr, suggestTechnicalComments } from './item-matching';
import { toUsd, type FxRates } from './fx-rates';
import { DEFAULT_WEIGHTS } from './workspace-types';
import {
  applyItemReview,
  buildItemReview,
  cellEdited,
  cellKey,
  editedCount,
  isEdited,
  toStore,
  valueOf,
} from './item-review';

const fx: FxRates = { base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: 't', live: true, source: 'test' };

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for Kiln department',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', quantity: 2000, unit: 'EA' },
      { itemCode: '404602703033', description: 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', quantity: 1500, unit: 'EA' },
      { itemCode: '404602703042', description: 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 300, unit: 'EA' },
      { itemCode: '404602703043', description: 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 C. With Plastic Caps.', quantity: 700, unit: 'EA' },
    ],
  },
  'pr.pdf',
)!;

const QTY = [10000, 2000, 1500, 300, 700];
const line = (name: string, qty: number, unitPrice: number) =>
  ({ name, quantity: qty, unitPrice, totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null });
const freight = (name: string, amount: number) =>
  ({ name, quantity: 1, unitPrice: null, totalPrice: amount, category: 'freight' as const, uom: null, availableInDays: null });
const base = (o: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: '', reference: null, prNumber: '12601612', currency: 'SAR', totalAmount: null, vatAmount: null,
  totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null, deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [], ...o,
});

// KROSAKI quotes 4 of the 5 PR items (row 2 missing) → the only supplier with a
// not-quoted row. Alfran quotes all five cleanly. Supply Wave quotes all five but
// in the wrong grade → spec differs, never "not quoted".
const krosaki = base({
  supplierName: 'KROSAKI MEA Ltd.', reference: 'OFR26-0040', currency: 'EUR', countryOfOrigin: 'France',
  deliveryTime: '4 weeks', paymentTerms: 'CAD',
  lineItems: [
    line('TWS.10(60)-200(140)-45-253MA-C', 10000, 2.42),
    line('TWS.10(60)-250(140)-45-253MA-C', 1500, 2.93),
    line('TWS.10(60)-170(80)-45-253MA-C', 300, 2.24),
    line('TWS.10(60)-180(100)-45-253MA-C', 700, 2.33),
    freight('TRANSPORT PRICE CIF JEDDAH', 3590),
  ],
});
const alfran = base({
  supplierName: 'Alfran Saudi Arabia Co.', reference: 'Q-ASA-NCC-260603', supplierCountry: 'KSA',
  deliveryTime: '65 days',
  lineItems: pr.items.map((it, i) => line(it.description, QTY[i], [10.36, 4.67, 12.43, 9.12, 9.53][i])),
});
const supplyWave = base({
  supplierName: 'Supply Wave', reference: 'SW-2606082547', supplierCountry: 'Saudi Arabia', deliveryTime: '88 Days',
  lineItems: [
    line('Anchor Corrugated Type: TWS.10(60)-200(140)-40-310. Material GRADE - SS 310', 10000, 10.4),
    line('SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', 2000, 3),
    line('Anchor Corrugated Type: TWS.10(60)-250(140)-40-310. Material GRADE - SS 310', 1500, 12.1),
    line('Anchor Corrugated Type: TWS.10(60)-170(80)-40-310. Material GRADE - SS 310', 300, 9),
    line('Anchor Corrugated Type: TWS.10(60)-180(100)-40-310. Material GRADE - SS 310', 700, 9),
  ],
});

function fresh() {
  const qs = quotationsFromLlmSuppliers([krosaki, alfran, supplyWave], 'quotes.pdf', { currency: 'SAR', confidence: 0.9 });
  const analysis = applyFxRates(assembleAnalysis(qs, false, pr), fx);
  const model = buildComparisonModel(analysis.quotations, pr, analysis.prMatch, { prOnly: true, fx });
  return { analysis, model, review: buildItemReview(model, analysis.quotations) };
}

const idOf = (a: ReturnType<typeof fresh>['analysis'], name: string) =>
  a.quotations.find((q) => q.supplierName.startsWith(name))!.id;

test('ITEM REVIEW: the extracted original is kept beside every edit and is never overwritten', () => {
  const { analysis, review } = fresh();
  const key = cellKey('i1', idOf(analysis, 'Alfran'));
  const cell = review[key];
  assert.equal(cell.qty.original, '10,000');
  assert.equal(cell.qty.edited, null, 'untouched');
  assert.equal(isEdited(cell.qty), false);
  assert.equal(valueOf(cell.qty), '10,000', 'the form prints the original while untouched');

  const edited = { ...review, [key]: { ...cell, qty: { ...cell.qty, edited: '9,000' } } };
  assert.equal(edited[key].qty.original, '10,000', 'the original survives the edit');
  assert.equal(valueOf(edited[key].qty), '9,000', 'the form prints the edit');
  assert.equal(isEdited(edited[key].qty), true, 'badge flips to the reviewer state');

  // Reset restores from the original.
  const reset = { ...edited, [key]: { ...edited[key], qty: { ...edited[key].qty, edited: null } } };
  assert.equal(valueOf(reset[key].qty), '10,000');
  assert.equal(isEdited(reset[key].qty), false);
});

test('ITEM REVIEW: an edited quantity reaches the grid AND recomputes that supplier total', () => {
  const { analysis, model, review } = fresh();
  const alfranId = idOf(analysis, 'Alfran');
  const key = cellKey('i1', alfranId);
  const col = model.suppliers.findIndex((s) => s.quotationId === alfranId);

  const extractedTotal = 10000 * 10.36 + 2000 * 4.67 + 1500 * 12.43 + 300 * 9.12 + 700 * 9.53;
  const plain = applyItemReview(model, review, fx);
  assert.deepEqual(plain.totals, {}, 'no edits → no recomputed totals, the stated total stands');

  const edited = { ...review, [key]: { ...review[key], qty: { ...review[key].qty, edited: '9000' } } };
  const out = applyItemReview(model, edited, fx);
  assert.equal(out.model.rows[0].cells[col]!.qty, 9000, 'the grid carries the reviewed quantity');
  assert.equal(
    out.totals[alfranId],
    Math.round((extractedTotal - 1000 * 10.36) * 100) / 100,
    'the total recomputes from the reviewed lines',
  );
  // Every other supplier is untouched.
  assert.equal(out.totals[idOf(analysis, 'Supply Wave')], undefined);
});

test('ITEM REVIEW: an edited unit price recomputes SAR/USD at the live rate, never a typed conversion', () => {
  const { analysis, model, review } = fresh();
  const krosakiId = idOf(analysis, 'KROSAKI');
  const key = cellKey('i1', krosakiId);
  const col = model.suppliers.findIndex((s) => s.quotationId === krosakiId);
  assert.equal(review[key].currency, 'EUR', 'the price is edited in the quote currency');
  assert.equal(review[key].unitPrice.original, '2.42');

  const edited = { ...review, [key]: { ...review[key], unitPrice: { ...review[key].unitPrice, edited: '3.00' } } };
  const cell = applyItemReview(model, edited, fx).model.rows[0].cells[col]!;
  assert.equal(cell.unitPrice, 3);
  assert.equal(cell.currency, 'EUR');
  assert.equal(cell.unitPriceUsd, toUsd(3, 'EUR', fx), 'USD derived from the edit at the live rate');
});

test('ITEM REVIEW: freight stays its own row and stays inside the recomputed total', () => {
  const { analysis, model, review } = fresh();
  const krosakiId = idOf(analysis, 'KROSAKI');
  const col = model.suppliers.findIndex((s) => s.quotationId === krosakiId);
  const chargeRows = model.rows.filter((r) => r.kind === 'charge');
  assert.equal(chargeRows.length, 1, 'freight is its own line');

  const key = cellKey('i1', krosakiId);
  const edited = { ...review, [key]: { ...review[key], unitPrice: { ...review[key].unitPrice, edited: '3.00' } } };
  const out = applyItemReview(model, edited, fx);
  const expected = 3 * 10000 + 1500 * 2.93 + 300 * 2.24 + 700 * 2.33 + 3590;
  assert.equal(out.totals[krosakiId], Math.round(expected * 100) / 100, 'freight is included in the total');
  // …and the freight row is still a row of its own in the printed grid.
  assert.equal(out.model.rows.filter((r) => r.kind === 'charge').length, 1);
});

test('ITEM REVIEW: "spec differs" survives an edit and only an explicit clear removes it', () => {
  const { analysis, model, review } = fresh();
  const swId = idOf(analysis, 'Supply Wave');
  const col = model.suppliers.findIndex((s) => s.quotationId === swId);
  const key = cellKey('i1', swId);
  assert.equal(review[key].specDiff, true, 'Supply Wave row 1 differs on grade');

  const edited = { ...review, [key]: { ...review[key], description: { ...review[key].description, edited: 'Corrected description' } } };
  const afterEdit = applyItemReview(model, edited, fx).model.rows[0].cells[col]!;
  assert.equal(afterEdit.matchState, 'quoted_spec_diff', 'the finding is untouched by an edit');
  assert.notEqual(afterEdit.specDiffCleared, true, 'and still prints');

  const cleared = { ...edited, [key]: { ...edited[key], specDiffCleared: true } };
  assert.equal(applyItemReview(model, cleared, fx).model.rows[0].cells[col]!.specDiffCleared, true);
});

test('ITEM REVIEW: a "Not Quoted" row only becomes quoted by a deliberate action', () => {
  const { analysis, model, review } = fresh();
  const krosakiId = idOf(analysis, 'KROSAKI');
  const col = model.suppliers.findIndex((s) => s.quotationId === krosakiId);
  const row = model.rows.findIndex((r) => r.kind !== 'charge' && r.cells[col] == null);
  assert.ok(row >= 0, 'KROSAKI has a not-quoted row');
  const key = cellKey(`i${model.rows[row].index}`, krosakiId);
  assert.equal(review[key].quoted, false);

  // Typing into it alone does NOT invent a quotation.
  const typed = { ...review, [key]: { ...review[key], unitPrice: { ...review[key].unitPrice, edited: '5.00' } } };
  assert.equal(applyItemReview(model, typed, fx).model.rows[row].cells[col], null, 'still Not Quoted');

  // Only the explicit "add a quoted line" turns it into one.
  const added = { ...typed, [key]: { ...typed[key], added: true } };
  const cell = applyItemReview(model, added, fx).model.rows[row].cells[col];
  assert.ok(cell, 'the deliberate action adds the line');
  assert.equal(cell!.unitPrice, 5);
});

test('ITEM REVIEW: only the overrides are persisted, and they round-trip', () => {
  const { analysis, review } = fresh();
  const key = cellKey('i1', idOf(analysis, 'Alfran'));
  assert.deepEqual(toStore(review), {}, 'a pristine review stores nothing');
  const edited = { ...review, [key]: { ...review[key], qty: { ...review[key].qty, edited: '9000' }, specDiffCleared: true } };
  assert.deepEqual(toStore(edited), { [key]: { qty: '9000', specDiffCleared: true } });
  assert.equal(editedCount(edited), 1);
  assert.equal(cellEdited(edited[key]), true);
});

test('ITEM REVIEW: reviewer edits never move the score — scoring reads the extracted values', () => {
  const { analysis, model, review } = fresh();
  const before = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS).map(
    (s) => `${s.quotation.supplierName}:${Math.round(s.overall * 1000)}`,
  );
  const key = cellKey('i1', idOf(analysis, 'Alfran'));
  const edited = { ...review, [key]: { ...review[key], unitPrice: { ...review[key].unitPrice, edited: '0.01' } } };
  applyItemReview(model, edited, fx); // the form model changes…
  const after = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS).map(
    (s) => `${s.quotation.supplierName}:${Math.round(s.overall * 1000)}`,
  );
  assert.deepEqual(after, before, '…the score does not');
});

// ── the mis-assigned technical comment ──────────────────────────────────────

test('COMMENTS: each supplier gets the verdict derived from ITS OWN row statuses', () => {
  const { analysis } = fresh();
  const comments = suggestTechnicalComments(analysis.prMatch, pr, analysis.quotations);
  const match = matchQuotationsToPr(analysis.quotations, pr);
  for (const q of analysis.quotations) {
    const sm = match.bySupplier.find((s) => s.quotationId === q.id)!;
    const text = comments[q.id]!.text;
    const notQuoted = sm.prItems.filter((p) => p.state === 'not_quoted').map((p) => p.prIndex + 1);
    const specDiff = sm.prItems.filter((p) => p.state === 'quoted_spec_diff').map((p) => p.prIndex + 1);
    // GUARD: no not-quoted rows ⇒ the phrase must not appear at all.
    if (!notQuoted.length) {
      assert.ok(!/items not quoted/i.test(text), `${q.supplierName} has no not-quoted rows but says: ${text}`);
    } else {
      assert.ok(text.includes(`items not quoted: ${notQuoted.join(',')}`), `${q.supplierName}: ${text}`);
    }
    if (specDiff.length) {
      assert.ok(text.includes(`spec differs on items ${specDiff.join(',')}`), `${q.supplierName}: ${text}`);
    } else {
      assert.ok(!/spec differs on items/.test(text), `${q.supplierName} has no spec diffs but says: ${text}`);
    }
  }
});

test('COMMENTS: a supplier that quoted everything is never handed another supplier’s "not quoted" text', () => {
  const { analysis } = fresh();
  const comments = suggestTechnicalComments(analysis.prMatch, pr, analysis.quotations);
  const alfran = comments[idOf(analysis, 'Alfran')]!.text;
  const krosaki = comments[idOf(analysis, 'KROSAKI')]!.text;
  assert.ok(!/items not quoted/i.test(alfran), `Alfran quoted all 5 items: ${alfran}`);
  assert.ok(/items not quoted/i.test(krosaki), `KROSAKI is the one with a missing item: ${krosaki}`);
  assert.notEqual(alfran, krosaki);
});
