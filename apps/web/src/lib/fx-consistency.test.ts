// One FX source: the Technical Approval Form and the comparison/dashboard view
// MUST convert to the SAME USD for the same amount (the earlier bug was a stale
// hardcoded EUR ~1.08 in the comparison path vs the live ~1.14 in the TA form).
// Also: unit-price USD must be EXACT to 2 decimals — never rounded to whole dollars.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type FxRates, toUsd } from './fx-rates';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { buildComparisonModel } from './pr-comparison';
import {
  matchQuotationsToPr,
} from './item-matching';
import {
  purchaseRequisitionFromLlm,
  quotationsFromLlmSuppliers,
  type LlmSupplier,
} from './extraction-server';

// Live-shaped rate (EUR ≈ 1.1418 USD, SAR ≈ 0.2667 USD) — the TA-form stamp's rate.
const FX: FxRates = {
  base: 'USD',
  rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 },
  asOf: 'Wed, 08 Jul 2026 00:00:00 +0000',
  live: true,
  source: 'test',
};
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

const supplier = (o: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: 'S', reference: null, prNumber: null, currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: null, deliveryTerms: null, paymentTerms: null, warranty: null, validUntil: null,
  lineItems: [], ...o,
});

test('FX: TA-form and comparison-view give the SAME USD for EUR 36,388 (live ~1.14, not stale 1.08 → 39,299)', () => {
  // TA-form path: MoneyDual converts with fx-rates.toUsd.
  const taFormUsd = toUsd(36388, 'EUR', FX)!;

  // Comparison/dashboard path: applyFxRates recomputes totalCostUsd from the SAME source.
  const [q] = quotationsFromLlmSuppliers(
    [supplier({ supplierName: 'KROSAKI', currency: 'EUR', totalAmount: 36388 })],
    'q.pdf',
    { currency: 'EUR', confidence: 0.9 },
  );
  const analysis = applyFxRates(assembleAnalysis([q], false), FX);
  const compUsd = analysis.quotations[0].totalCostUsd!;

  assert.equal(compUsd, taFormUsd, 'comparison total USD must equal the TA-form USD exactly');
  // ~41.5k at the live rate — and specifically NOT the stale-1.08 value of 39,299.
  assert.ok(compUsd > 41000 && compUsd < 42000, `expected ~41.5k, got ${compUsd}`);
  assert.notEqual(Math.round(compUsd), 39299);
});

test('FX: unit-price USD is exact to 2 decimals via the live rate (no whole-dollar rounding)', () => {
  const cases: [number, string, number][] = [
    [10.40, 'SAR', 2.77],
    [2.42, 'EUR', 2.76],
    [12.10, 'SAR', 3.23],
    [3.43, 'SAR', 0.91],
    [0.95, 'EUR', 1.08],
  ];
  for (const [amt, cur, expected] of cases) {
    assert.equal(round2(toUsd(amt, cur, FX)), expected, `${amt} ${cur} → USD ${expected}`);
    // The underlying value is NOT rounded to an integer.
    assert.notEqual(Math.round(toUsd(amt, cur, FX)!), toUsd(amt, cur, FX));
  }
});

test('FX: buildComparisonModel threads the live rate into unit-price cells; no fx ⇒ null (no stale guess)', () => {
  const pr = purchaseRequisitionFromLlm(
    { requestNo: 'X', items: [{ itemCode: 'A', description: 'Widget', quantity: 100, unit: 'EA' }] },
    'pr.pdf',
  )!;
  const [q] = quotationsFromLlmSuppliers(
    [supplier({ currency: 'SAR', lineItems: [{ name: 'Widget', quantity: 100, unitPrice: 10.40, totalPrice: 1040, category: 'product', uom: 'EA', availableInDays: null }] })],
    'q.pdf',
    { currency: 'SAR', confidence: 0.9 },
  );
  const prMatch = matchQuotationsToPr([q], pr);

  const withFx = buildComparisonModel([q], pr, prMatch, { prOnly: true, fx: FX });
  const cell = withFx.rows[0].cells[0]!;
  assert.equal(cell.unitPriceUsd, toUsd(10.40, 'SAR', FX), 'cell USD uses the live rate');
  assert.equal(round2(cell.unitPriceUsd), 2.77);

  // Without a rate we NEVER substitute a hardcoded guess.
  const noFx = buildComparisonModel([q], pr, prMatch, { prOnly: true });
  assert.equal(noFx.rows[0].cells[0]!.unitPriceUsd, null);
});
