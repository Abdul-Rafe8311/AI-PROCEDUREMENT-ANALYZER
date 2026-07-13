// Acceptance tests against the REAL PR 12601612 (5 suppliers: Krosaki, AL-NAJIM,
// Alfran, Supply Wave, Refratechnik). They exercise the deterministic seams
// (extraction mapping + matching + scoring) with fixtures that mirror the real
// documents, so the Phase-1/2 fixes are pinned without needing a live LLM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';
import { applyFxRates, assembleAnalysis, scoreSuppliers } from './analysis-engine';
import type { FxRates } from './fx-rates';
import { matchQuotationsToPr } from './item-matching';
import { DEFAULT_WEIGHTS, formatUnitNumber } from './workspace-types';

// USD figures come from the single live FX source; inject a fixed rate in tests.
const FX: FxRates = {
  base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: 't', live: true, source: 'test',
};

// ── The company requisition: 5 anchor lines with DISTINCT quantities so the
// exact-quantity fallback can line up suppliers who quote by part number. ──
const PR_QTYS = [10000, 2000, 1500, 300, 700];
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for production department',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, Type Tws.10(60)-200(140)-40-253, Material Grade 253 Ma, with Plastic Caps', quantity: 10000, unit: 'NO' },
      { itemCode: '404602703005', description: 'Anchor, Corrugated, Type Tws.10(60)-070(050)-40-253, Grade 253 Ma', quantity: 2000, unit: 'NO' },
      { itemCode: '404602703006', description: 'Anchor, Corrugated, Type Tws.10(60)-250(180)-40-253, Grade 253 Ma', quantity: 1500, unit: 'NO' },
      { itemCode: '404602703007', description: 'Anchor, Corrugated, Type Tws.10(60)-170(120)-40-253, Grade 253 Ma', quantity: 300, unit: 'NO' },
      { itemCode: '404602703008', description: 'Anchor, Corrugated, Type Tws.10(60)-180(130)-40-253, Grade 253 Ma', quantity: 700, unit: 'NO' },
    ],
  },
  'pr-12601612.pdf',
)!;

// Suppliers who quote by internal part number (no strong description match) — they
// must still line up against the requisition via the exact-quantity fallback.
const partNos = (prefix: string, prices: number[]): LlmSupplier['lineItems'] =>
  PR_QTYS.map((qty, i) => ({
    name: `${prefix}.${i + 1}`,
    quantity: qty,
    unitPrice: prices[i],
    totalPrice: Math.round(prices[i] * qty * 100) / 100,
    category: 'product',
    uom: 'NO',
    availableInDays: null,
  }));

const krosaki: LlmSupplier = {
  supplierName: 'Krosaki', reference: 'KR-77', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4 to 5 weeks', deliveryTerms: 'FOB Hamburg', paymentTerms: '30 days net', warranty: '12 months', validUntil: null,
  lineItems: partNos('REVA-W.10-200', [2.42, 1.9, 2.1, 3.4, 3.0]),
};
const refratechnik: LlmSupplier = {
  supplierName: 'Refratechnik', reference: 'RT-5591', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '08 - Weeks', deliveryTerms: 'EXW Onnaing (France)', paymentTerms: '50% advance', warranty: null, validUntil: null,
  lineItems: [
    { name: 'REVA-W.10-200', quantity: 10000, unitPrice: 3.07, totalPrice: 30700, category: 'product', uom: 'NO', availableInDays: null },
    { name: 'REVA.10-070', quantity: 2000, unitPrice: 2.6, totalPrice: 5200, category: 'product', uom: 'NO', availableInDays: null },
    { name: 'REVA-W.10-250', quantity: 1500, unitPrice: 3.2, totalPrice: 4800, category: 'product', uom: 'NO', availableInDays: null },
    { name: 'REVA-W.10-170', quantity: 300, unitPrice: 4.1, totalPrice: 1230, category: 'product', uom: 'NO', availableInDays: null },
    { name: 'REVA-W.10-180', quantity: 700, unitPrice: 3.9, totalPrice: 2730, category: 'product', uom: 'NO', availableInDays: null },
  ],
};
// AL-NAJIM quotes with descriptions + decimals: item1 15.50, item3 18.50.
const alnajim: LlmSupplier = {
  supplierName: 'AL-NAJIM', reference: 'AN-12', prNumber: '12601612', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '60 days', deliveryTerms: 'DDP Riyadh', paymentTerms: '30 days', warranty: '12 months', validUntil: null,
  lineItems: partNos('AN-Anchor', [15.5, 12.0, 18.5, 20.0, 17.0]),
};
// Alfran: item1 10.36, item2 4.67.
const alfran: LlmSupplier = {
  supplierName: 'Alfran', reference: 'AF-9', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '45 days', deliveryTerms: 'CIF Jeddah', paymentTerms: 'Net 30', warranty: '24 months', validUntil: null,
  lineItems: partNos('ALF', [10.36, 4.67, 6.2, 7.1, 5.9]),
};
// Supply Wave: VAT-inclusive final 158,677 + VAT 20,697 → without-VAT 137,980. A
// per-line "Available in Days: 88" is the delivery; the "15 days" in deliveryTime
// is the OFFER VALIDITY leaking in and must be ignored. Grade SS 310 ≠ PR 253 Ma.
const supplyWave: LlmSupplier = {
  supplierName: 'Supply Wave', reference: 'SW-2606082547', prNumber: '12601612', currency: 'SAR',
  totalAmount: 158677, vatAmount: 20697, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '15 days', deliveryTerms: 'EXW', paymentTerms: '30 days', warranty: null, validUntil: '2026-08-15',
  lineItems: [
    { name: 'Anchor, Corrugated, Type Tws.10(60)-200(140)-40-310, Grade SS 310', quantity: 10000, unitPrice: 13.798, totalPrice: 137980, category: 'product', uom: 'NO', availableInDays: 88 },
  ],
};

const suppliers = [krosaki, alnajim, alfran, supplyWave, refratechnik];
const quotations = quotationsFromLlmSuppliers(suppliers, 'quotes-12601612.pdf', { currency: 'SAR', confidence: 0.6 });
const byName = (n: string) => quotations.find((q) => q.supplierName === n)!;

test('PR 12601612: PR line-1 quantity is 10,000 (never doubled)', () => {
  assert.equal(pr.items.length, 5);
  assert.equal(pr.items[0].itemCode, '404602703004');
  assert.equal(pr.items[0].quantity, 10000);
});

test('PR 12601612: a repeated (bilingual/echoed) requisition row is de-duplicated, not summed', () => {
  const doubled = purchaseRequisitionFromLlm(
    {
      requestNo: '12601612',
      items: [
        { itemCode: '404602703004', description: 'Anchor ...200(140)... 253 Ma', quantity: 10000, unit: 'NO' },
        { itemCode: '404602703004', description: 'مرساة ...200(140)... 253', quantity: 10000, unit: 'NO' }, // same code echoed
      ],
    },
    'pr.pdf',
  )!;
  assert.equal(doubled.items.length, 1);
  assert.equal(doubled.items[0].quantity, 10000); // NOT 20,000
});

test('PR 12601612 · Supply Wave: delivery is 88 days (Available in Days), NOT 15 (validity)', () => {
  const q = byName('Supply Wave');
  assert.equal(q.deliveryRaw, '88 days');
  assert.equal(q.deliveryDays, 88);
  assert.equal(q.validUntil, '2026-08-15'); // validity is preserved separately
});

test('PR 12601612 · Supply Wave: compared total is SAR 137,980 without VAT (158,677 kept for reference)', () => {
  const q = byName('Supply Wave');
  assert.equal(q.currency, 'SAR');
  assert.equal(q.totalCost, 137980);
  assert.equal(q.totalCostInclVat, 158677);
});

test('PR 12601612 · Supply Wave item 1 is QUOTED, spec differs (SS 310 vs 253 Ma) — not "not quoted"', () => {
  const match = matchQuotationsToPr(quotations, pr);
  const sw = match.bySupplier.find((s) => s.supplier === 'Supply Wave')!;
  assert.equal(sw.prItems[0].state, 'quoted_spec_diff');
  assert.equal(sw.prItems[0].mappedBy, 'order');
  assert.ok(/310/.test(sw.prItems[0].supplierItem!.name));
});

test('PR 12601612 · Krosaki & Refratechnik: 5/5 items QUOTED (0 not quoted); chip counts sum to 5', () => {
  const match = matchQuotationsToPr(quotations, pr);
  for (const name of ['Krosaki', 'Refratechnik']) {
    const sm = match.bySupplier.find((s) => s.supplier === name)!;
    assert.equal(sm.notQuotedCount, 0, `${name} should have 0 not-quoted`);
    assert.equal(sm.matchCount + sm.specDiffCount + sm.notQuotedCount, 5, `${name} states must sum to 5`);
    assert.ok(sm.prItems.every((p) => p.state !== 'not_quoted'), `${name} every PR item is quoted`);
    // Part-number quotes line up by line ORDER (description inconclusive) and, having
    // no conflicting grade, show as CLEAN matches (not "spec differs").
    assert.equal(sm.specDiffCount, 0, `${name} part-number quotes should be clean matches`);
    assert.ok(sm.prItems.every((p) => p.mappedBy === 'order'), `${name} mapped by order`);
  }
});

test('PR 12601612 · Supply Wave is the ONLY supplier flagged spec-differs (grade SS 310)', () => {
  const match = matchQuotationsToPr(quotations, pr);
  const flagged = match.bySupplier.filter((s) => s.specDiffCount > 0).map((s) => s.supplier);
  assert.deepEqual(flagged, ['Supply Wave']);
});

test('PR 12601612: unit prices keep 2 decimals (never rounded to integers)', () => {
  const an = byName('AL-NAJIM');
  assert.equal(an.lineItems[0].unitPrice, 15.5);
  assert.equal(an.lineItems[2].unitPrice, 18.5);
  const af = byName('Alfran');
  assert.equal(af.lineItems[0].unitPrice, 10.36);
  assert.equal(af.lineItems[1].unitPrice, 4.67);
  assert.equal(byName('Krosaki').lineItems[0].unitPrice, 2.42);
  assert.equal(byName('Refratechnik').lineItems[0].unitPrice, 3.07);
  // Display formatter renders 2 decimals.
  assert.equal(formatUnitNumber(15.5), '15.50');
  assert.equal(formatUnitNumber(10.36), '10.36');
  assert.equal(formatUnitNumber(2.42), '2.42');
});

test('PR 12601612: scoring runs and produces a full ranking + badges (printed to eyeball)', () => {
  // USD totals are derived at the live rate (applyFxRates), like the app does at render.
  const analysis = applyFxRates(assembleAnalysis(quotations, false, pr), FX);
  const scored = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS);
  assert.equal(scored.length, 5);

  const rec = analysis.recommendation;
  // eslint-disable-next-line no-console
  console.log('\n── PR 12601612 · scoring after fixes ─────────────────────────');
  scored.forEach((s, i) => {
    // eslint-disable-next-line no-console
    console.log(
      `  ${i + 1}. ${s.quotation.supplierName.padEnd(14)} score ${Math.round(s.overall * 100)
        .toString()
        .padStart(3)}/100 · ${s.quotation.currency} ${s.quotation.totalCost?.toLocaleString('en-US') ?? '—'}` +
        ` · ${s.quotation.deliveryRaw ?? '—'}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log(`  Lowest cost : ${rec.lowestCost?.supplier ?? '—'}`);
  // eslint-disable-next-line no-console
  console.log(`  Fastest     : ${rec.fastestDelivery?.supplier ?? '—'}`);
  // eslint-disable-next-line no-console
  console.log(`  Recommended : ${scored[0]?.quotation.supplierName ?? '—'}`);
  console.log('──────────────────────────────────────────────────────────────\n');

  // Sanity (not hardcoding the winner): a recommended supplier exists and the
  // lowest-cost badge points at the genuinely cheapest USD total.
  assert.ok(scored[0]);
  const cheapest = [...analysis.quotations]
    .filter((q) => q.totalCostUsd != null)
    .sort((a, b) => a.totalCostUsd! - b.totalCostUsd!)[0];
  assert.equal(rec.lowestCost?.supplier, cheapest.supplierName);
});
