import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeselectIntent,
  isSelectionIntent,
  resolveSupplierFromText,
} from './analysis-engine';
import { quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';

const mk = (name: string): LlmSupplier => ({
  supplierName: name, reference: null, prNumber: null, currency: 'SAR', totalAmount: 100,
  vatAmount: null, totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null,
  deliveryTerms: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [],
});
const quotes = quotationsFromLlmSuppliers(
  [mk('KROSAKI'), mk('AL NAJIM'), mk('AlFRAN'), mk('Supply Wave'), mk('Refratechnik')],
  'q.pdf',
  { currency: 'SAR', confidence: 1 },
);

test('selection intent: verbs that mean "choose this supplier"', () => {
  for (const t of ['go with Alfran', 'select Supply Wave', "let's go with Krosaki", 'I want AL NAJIM', 'choose Refratechnik', 'award it to Alfran']) {
    assert.equal(isSelectionIntent(t), true, t);
  }
  // Plain comparison questions are NOT selection intents.
  for (const t of ['which is cheapest?', 'compare delivery times', 'what is the warranty?']) {
    assert.equal(isSelectionIntent(t), false, t);
  }
});

test('deselect intent: return to the AI pick', () => {
  for (const t of ['deselect', 'clear selection', 'reset my selection', 'back to the AI pick', "use the AI's recommendation"]) {
    assert.equal(isDeselectIntent(t), true, t);
  }
  assert.equal(isDeselectIntent('go with Alfran'), false);
});

test('resolveSupplierFromText: maps a named supplier to its canonical name', () => {
  assert.equal(resolveSupplierFromText('go with Alfran', quotes), 'AlFRAN');
  assert.equal(resolveSupplierFromText('select supply wave please', quotes), 'Supply Wave');
  assert.equal(resolveSupplierFromText('I want al najim', quotes), 'AL NAJIM');
  assert.equal(resolveSupplierFromText('choose Refratechnik', quotes), 'Refratechnik');
  assert.equal(resolveSupplierFromText('go with Krosaki', quotes), 'KROSAKI');
  // No supplier named → null (never a wrong guess).
  assert.equal(resolveSupplierFromText('go with the cheapest one', quotes), null);
});
