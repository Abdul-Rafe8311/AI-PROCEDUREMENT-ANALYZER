// Per-supplier, toggleable Warranty + Country of Origin on the Technical Approval
// Form: AI pre-fill values, human edit/clear, per-supplier on/off, and the rule
// that hiding/editing the DISPLAY never changes the VAT local/international rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { buildApprovalFields, suggestOrigins, suggestWarranties } from './item-matching';
import { withVatAmount } from './approval-form-pdf';

const base = (over: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: 'S', reference: null, prNumber: '12601612', currency: 'SAR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: null, deliveryTerms: null, countryOfOrigin: null, paymentTerms: null,
  warranty: null, validUntil: null,
  lineItems: [{ name: 'Anchor', quantity: 10, unitPrice: 1, totalPrice: 10, category: 'product', uom: 'EA', availableInDays: null }],
  ...over,
});

// intl (France) with a stated VAT → an incl-VAT total exists; local (KSA) has none.
const intl = base({ supplierName: 'KROSAKI', currency: 'EUR', countryOfOrigin: 'Country of Origin: France', warranty: '12 months against manufacturing defects', totalAmount: 40000, vatAmount: 6000, totalWithoutVat: 34000 });
const localA = base({ supplierName: 'AL NAJIM', countryOfOrigin: 'Saudi Arabia', warranty: null });
const localB = base({ supplierName: 'Alfran', countryOfOrigin: 'KSA', warranty: null });

const quotations = quotationsFromLlmSuppliers([intl, localA, localB], 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
const [Q_INTL, Q_LOCAL_A, Q_LOCAL_B] = quotations.map((q) => q.id);

test('suggestWarranties: verbatim when stated, "Not stated" otherwise (never invented)', () => {
  const w = suggestWarranties(quotations);
  assert.equal(w[Q_INTL], '12 months against manufacturing defects');
  assert.equal(w[Q_LOCAL_A], 'Not stated');
  assert.equal(w[Q_LOCAL_B], 'Not stated');
});

test('suggestOrigins: uses the derived origin (France / Saudi Arabia), else "Not stated"', () => {
  const o = suggestOrigins(quotations);
  assert.equal(o[Q_INTL], 'France'); // normalized from "Country of Origin: France"
  assert.equal(o[Q_LOCAL_A], 'Saudi Arabia');
  assert.equal(o[Q_LOCAL_B], 'Saudi Arabia'); // "KSA" normalized
});

test('buildApprovalFields: defaults ON + AI-suggested for every supplier', () => {
  const f = buildApprovalFields(quotations, suggestOrigins(quotations));
  for (const id of quotations.map((q) => q.id)) {
    assert.equal(f[id].enabled, true);
    assert.equal(f[id].aiSuggested, true);
  }
});

test('buildApprovalFields: a human edit drops the AI label; a clear ("") is a human blank', () => {
  const ai = suggestWarranties(quotations);
  const edited = buildApprovalFields(quotations, ai, { [Q_INTL]: { text: '24 months' } });
  assert.deepEqual(edited[Q_INTL], { enabled: true, text: '24 months', aiSuggested: false });
  const cleared = buildApprovalFields(quotations, ai, { [Q_INTL]: { text: '' } });
  assert.deepEqual(cleared[Q_INTL], { enabled: true, text: '', aiSuggested: false });
  // untouched suppliers keep the AI value
  assert.equal(edited[Q_LOCAL_A].aiSuggested, true);
});

test('buildApprovalFields: a persisted OFF toggle hides the field but keeps the AI value', () => {
  const f = buildApprovalFields(quotations, suggestOrigins(quotations), { [Q_INTL]: { enabled: false } });
  assert.equal(f[Q_INTL].enabled, false);
  assert.equal(f[Q_INTL].text, 'France'); // value preserved even while hidden
  assert.equal(f[Q_INTL].aiSuggested, true);
});

test('VAT rule reads the EXTRACTED origin — hiding Country of Origin never changes VAT', () => {
  const qIntl = quotations.find((q) => q.id === Q_INTL)!;
  const qLocal = quotations.find((q) => q.id === Q_LOCAL_A)!;
  // International + stated VAT → a with-VAT total; local supplier → none.
  assert.equal(withVatAmount(qIntl), 40000);
  assert.equal(withVatAmount(qLocal), null);
  // Toggle the international supplier's Country of Origin OFF (hidden on the form)…
  const origins = buildApprovalFields(quotations, suggestOrigins(quotations), { [Q_INTL]: { enabled: false } });
  assert.equal(origins[Q_INTL].enabled, false);
  // …the VAT treatment is unchanged: it still reads the extracted countryOfOrigin.
  assert.equal(withVatAmount(qIntl), 40000);
  assert.equal(qIntl.countryOfOrigin, 'France');
});
