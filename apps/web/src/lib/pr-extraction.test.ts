import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseRequisitionFromLlm } from './extraction-server';

// Models the buyer's internal "Approved Requisition Report": a header with a
// Request No. plus bilingual (English/Arabic) item rows carrying item code,
// qty and unit — and cost/consumption columns that MUST be ignored.
const rawPr = {
  requestNo: 'PR-2024-00817',
  date: '2024-11-03',
  departmentCode: 'MECH-07',
  requesterName: 'A. Rahman',
  approvedBy: 'M. Khalid',
  items: [
    {
      itemCode: '1000123',
      description:
        'Anchor, Corrugated, Type. Tws.10(60)-200(140)-40-253, Material Grade 253 Ma. With Plastic Caps.',
      descriptionArabic: 'مرساة مموجة',
      quantity: 200,
      unit: 'SET',
      // cost/consumption columns — must NOT surface as a price:
      averageConsumption: 15,
      lastPurchasePrice: 42.5,
    },
    { itemCode: '1000124', description: 'Refractory Castable, 60% Alumina', quantity: 12, unit: 'BAG' },
  ],
};

test('PHASE 1: PR header + every item (code, description, qty, unit) are captured', () => {
  const pr = purchaseRequisitionFromLlm(rawPr, 'approved-requisition.pdf');
  assert.ok(pr, 'a requisition is returned');
  assert.equal(pr!.requestNo, 'PR-2024-00817');
  assert.equal(pr!.departmentCode, 'MECH-07');
  assert.equal(pr!.items.length, 2);
  const [first] = pr!.items;
  assert.equal(first.itemCode, '1000123');
  assert.match(first.description, /Anchor, Corrugated/);
  assert.equal(first.quantity, 200);
  assert.equal(first.unit, 'SET');
});

test('PHASE 1: bilingual Arabic description is kept separately', () => {
  const pr = purchaseRequisitionFromLlm(rawPr, 'approved-requisition.pdf');
  assert.equal(pr!.items[0].descriptionArabic, 'مرساة مموجة');
  assert.equal(pr!.items[1].descriptionArabic, null); // English-only row
});

test('PHASE 1: PR carries no prices — cost/consumption columns are dropped', () => {
  const pr = purchaseRequisitionFromLlm(rawPr, 'approved-requisition.pdf');
  // PrItem has no price field at all; only match-relevant fields survive.
  assert.deepEqual(Object.keys(pr!.items[0]).sort(), [
    'description',
    'descriptionArabic',
    'itemCode',
    'quantity',
    'unit',
  ]);
});

test('PHASE 1: tolerates a wrapped shape and key aliases', () => {
  const wrapped = {
    purchaseRequisition: {
      requestNumber: 'REQ-9',
      items: [{ code: 'X-1', itemDescription: 'Gasket', qty: 5, uom: 'PCS' }],
    },
  };
  const pr = purchaseRequisitionFromLlm(wrapped, 'scan.png', 'vision');
  assert.equal(pr!.requestNo, 'REQ-9');
  assert.equal(pr!.method, 'vision');
  assert.equal(pr!.items[0].itemCode, 'X-1');
  assert.equal(pr!.items[0].description, 'Gasket');
  assert.equal(pr!.items[0].quantity, 5);
  assert.equal(pr!.items[0].unit, 'PCS');
});

test('PHASE 1: empty / itemless input yields null (never a fake requisition)', () => {
  assert.equal(purchaseRequisitionFromLlm(null, 'x.pdf'), null);
  assert.equal(purchaseRequisitionFromLlm({ requestNo: 'PR-1', items: [] }, 'x.pdf'), null);
});

// Buyer's real PR: Request No. 12601612, header subject "Anchors for production
// department". The header subject must be captured on the PR (not a line item).
test('PR DESCRIPTION: header subject is captured (buyer PR 12601612)', () => {
  const pr = purchaseRequisitionFromLlm(
    {
      requestNo: '12601612',
      description: 'Anchors for production department',
      items: [{ itemCode: '1000123', description: 'Anchor, Corrugated, 253 Ma', quantity: 200, unit: 'SET' }],
    },
    'requisition-12601612.pdf',
  );
  assert.equal(pr!.requestNo, '12601612');
  assert.equal(pr!.description, 'Anchors for production department');
});

test('PR DESCRIPTION: accepts subject/purpose/prDescription aliases', () => {
  for (const key of ['subject', 'purpose', 'prDescription', 'title'] as const) {
    const pr = purchaseRequisitionFromLlm(
      { requestNo: 'R', [key]: 'Anchors for production department', items: [{ description: 'Anchor', quantity: 1 }] },
      'x.pdf',
    );
    assert.equal(pr!.description, 'Anchors for production department', `alias ${key}`);
  }
});

test('PR DESCRIPTION: absent header subject stays null (never invented)', () => {
  const pr = purchaseRequisitionFromLlm(
    { requestNo: 'R', items: [{ description: 'Anchor', quantity: 1 }] },
    'x.pdf',
  );
  assert.equal(pr!.description, null);
});
