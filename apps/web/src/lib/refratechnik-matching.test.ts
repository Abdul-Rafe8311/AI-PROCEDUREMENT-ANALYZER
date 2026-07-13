// Refratechnik quotes by internal part number (REVA-W.10-200, REVA.10-070, …) in a
// source order that does NOT match the PR order. Each line must land on the PR row
// whose SIZE its code encodes — matched by embedded dimension, NEVER by source order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSupplierItems } from './item-matching';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';

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
  'pr.pdf',
)!;

// Lines in the SAME (wrong) source order that produced the misaligned form — the
// SS 310 / -070 line is LAST, not in PR-row-2 position.
const refratechnik: LlmSupplier = {
  supplierName: 'Refratechnik', reference: '9100147169', prNumber: '12601612', currency: 'EUR',
  totalAmount: null, vatAmount: null, totalWithoutVat: null, totalsByCurrency: null,
  deliveryTime: '4-5 weeks', deliveryTerms: 'FOB', countryOfOrigin: 'F.R. OF GERMANY',
  paymentTerms: 'Cash against documents', warranty: null, validUntil: null,
  lineItems: [
    { name: 'REVA-W.10-200', quantity: 10000, unitPrice: 3.07, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'REVA-W.10-250', quantity: 1500, unitPrice: 3.70, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'REVA-W.10-170', quantity: 300, unitPrice: 4.12, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'REVA-W.10-180', quantity: 700, unitPrice: 2.80, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'REVA.10-070', quantity: 2000, unitPrice: 3.21, totalPrice: null, category: 'product', uom: 'EA', availableInDays: null },
  ],
};

const [q] = quotationsFromLlmSuppliers([refratechnik], 'refra.pdf', { currency: 'EUR', confidence: 0.9 });

test('Refratechnik: each part code lands on the PR row its dimension encodes (NOT source order)', () => {
  const m = matchSupplierItems(q, pr.items);
  const nameOn = (row: number) => m.prItems[row].supplierItem?.name ?? '(none)';
  const qtyOn = (row: number) => m.prItems[row].supplierItem?.quantity ?? null;

  assert.equal(nameOn(0), 'REVA-W.10-200', 'PR row 1 (200/140) → REVA-W.10-200');
  assert.equal(qtyOn(0), 10000);

  assert.equal(nameOn(1), 'REVA.10-070', 'PR row 2 (SS 310 NCC-KL-42, 70mm) → REVA.10-070');
  assert.equal(qtyOn(1), 2000);

  assert.equal(nameOn(2), 'REVA-W.10-250', 'PR row 3 (250/140) → REVA-W.10-250');
  assert.equal(qtyOn(2), 1500);

  assert.equal(nameOn(3), 'REVA-W.10-170', 'PR row 4 (170/80) → REVA-W.10-170');
  assert.equal(qtyOn(3), 300);

  assert.equal(nameOn(4), 'REVA-W.10-180', 'PR row 5 (180/100) → REVA-W.10-180');
  assert.equal(qtyOn(4), 700);

  // Mapped by embedded dimension, never left "Not Quoted".
  assert.equal(m.notQuotedCount, 0);
  assert.ok(m.prItems.every((p) => p.mappedBy === 'dimension'), 'all mapped by dimension');
});
