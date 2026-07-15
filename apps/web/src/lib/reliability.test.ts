// The scored criterion "Risk" is reframed as "Reliability" (positive: High = safest,
// fewer/less-severe flags → higher). The math is unchanged — reliabilityLevelFor is
// the exact inverse of riskLevelFor — so a low-risk supplier now reads HIGH.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reliabilityLevelFor, riskLevelFor, scoreSuppliers } from './analysis-engine';
import { DEFAULT_WEIGHTS, type RiskFlag, type RiskType } from './workspace-types';
import { quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';

const flag = (supplier: string, type: RiskType): RiskFlag => ({
  supplier, type, severity: 'high', message: 'm', explanation: 'why',
});

test('reliabilityLevelFor is the exact positive inverse of riskLevelFor', () => {
  // no flags → Low risk → High reliability
  assert.equal(riskLevelFor('A', []), 'Low');
  assert.equal(reliabilityLevelFor('A', []), 'High');
  // one severity-3 flag (score 3) → Medium risk → Medium reliability
  const mid = [flag('A', 'risky_payment_terms')];
  assert.equal(riskLevelFor('A', mid), 'Medium');
  assert.equal(reliabilityLevelFor('A', mid), 'Medium');
  // two severity-3 flags (score 6 ≥ 4) → High risk → Low reliability
  const high = [flag('A', 'risky_payment_terms'), flag('A', 'missing_delivery')];
  assert.equal(riskLevelFor('A', high), 'High');
  assert.equal(reliabilityLevelFor('A', high), 'Low');
});

// Two suppliers, identical except one carries risk flags. Reliability label must
// agree with the score direction: the clean (low-risk) supplier reads HIGH and
// scores at least as high on the reliability criterion.
const q = (name: string): LlmSupplier => ({
  supplierName: name, reference: null, prNumber: '1', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4 weeks', deliveryTerms: 'CIF', countryOfOrigin: 'Saudi Arabia',
  paymentTerms: '30 days', warranty: '12 months', validUntil: null,
  lineItems: [{ name: 'Anchor', quantity: 10, unitPrice: 5, totalPrice: 50, category: 'product', uom: 'EA', availableInDays: null }],
});
const quotations = quotationsFromLlmSuppliers([q('Alfran'), q('Risky Co')], 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
const [ALFRAN] = quotations;
const risks: RiskFlag[] = [
  flag('Risky Co', 'risky_payment_terms'),
  flag('Risky Co', 'missing_delivery'),
];

test('acceptance: a low-risk supplier (Alfran) reads HIGH Reliability', () => {
  assert.equal(reliabilityLevelFor(ALFRAN.supplierName, risks), 'High');
});

test('acceptance: the reliability criterion scores the clean supplier ≥ the risky one (label matches score)', () => {
  const scored = scoreSuppliers(quotations, risks, DEFAULT_WEIGHTS);
  const alfran = scored.find((s) => s.quotation.supplierName === 'Alfran')!;
  const risky = scored.find((s) => s.quotation.supplierName === 'Risky Co')!;
  // High reliability ⇒ higher (or equal) reliability-criterion score than the flagged peer.
  assert.ok(alfran.metrics.risk.score >= risky.metrics.risk.score);
  assert.equal(reliabilityLevelFor('Alfran', risks), 'High');
  assert.equal(reliabilityLevelFor('Risky Co', risks), 'Low');
});
