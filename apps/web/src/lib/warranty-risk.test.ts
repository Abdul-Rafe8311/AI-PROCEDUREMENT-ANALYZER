import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRisks } from './analysis-engine';
import { quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';

const mk = (name: string, warranty: string | null): LlmSupplier => ({
  supplierName: name, reference: null, currency: 'SAR', totalAmount: 1000, totalsByCurrency: null,
  deliveryTime: '30 days', deliveryTerms: 'CIF', paymentTerms: 'Net 30', warranty, validUntil: null,
  lineItems: [{ name: 'Item', quantity: 1, unitPrice: 1000, totalPrice: 1000, category: 'product' }],
});

const build = (suppliers: LlmSupplier[]) =>
  quotationsFromLlmSuppliers(suppliers, 'x.pdf', { currency: 'SAR', confidence: 0.99 });

test('WARRANTY: no missing-warranty flag when NO supplier states a warranty', () => {
  const qs = build([mk('A', null), mk('B', null), mk('C', null)]);
  const flags = detectRisks(qs).filter((r) => r.type === 'missing_warranty');
  assert.equal(flags.length, 0);
});

test('WARRANTY: flagged only for the supplier(s) missing it when a peer offers one', () => {
  const qs = build([mk('A', '12 months'), mk('B', null), mk('C', null)]);
  const flags = detectRisks(qs).filter((r) => r.type === 'missing_warranty');
  assert.deepEqual(flags.map((f) => f.supplier).sort(), ['B', 'C']);
});

test('WARRANTY: no flag for a single supplier with no warranty (nothing to compare)', () => {
  const qs = build([mk('Solo', null)]);
  assert.equal(detectRisks(qs).filter((r) => r.type === 'missing_warranty').length, 0);
});
