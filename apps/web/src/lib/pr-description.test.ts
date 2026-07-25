// PR Description resolution across the two real PR layouts + the trailing-fragment
// clean-up. PR 12601612 has an explicit header field; PR 12601707 carries the
// description only in its single item's "Item Description" column.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prSubjectFromText, purchaseRequisitionFromLlm } from './extraction-server';
import { resolvePrDescription } from './item-matching';

// ── Header-subject rescue: when the extractor returns no `description`, the
// requisition's OWN subject line is read out of the document text verbatim, so the
// TA form never falls back to the derived one-word summary ("Anchors"). ──

test('PR SUBJECT: labelled header line is captured IN FULL ("Anchors for Kiln department")', () => {
  const text = [
    'NAJRAN CEMENT COMPANY',
    'Approved Requisition Report',
    'Request No.: 12601612            Date: 12/06/2026',
    'Description: Anchors for Kiln department',
    'Department Code: 4200',
    '',
    'Item Code    Description                                   UOM   Quantity',
    '404602703004 Anchor, Corrugated, TWS.10(60)-200(140)-40-253 EA    10000',
  ].join('\n');
  assert.equal(prSubjectFromText(text), 'Anchors for Kiln department');
});

test('PR SUBJECT: an UNLABELLED purpose line is captured too', () => {
  const text = ['Approved Requisition Report', 'Request No. 12601612', 'Anchors for Kiln department', '', 'Item Code  Description'].join('\n');
  assert.equal(prSubjectFromText(text), 'Anchors for Kiln department');
});

test('PR SUBJECT: "Subject"/"Required for" labels work, trailing punctuation trimmed', () => {
  assert.equal(prSubjectFromText('Subject : Conversion kit for rotary packer -'), 'Conversion kit for rotary packer');
  assert.equal(prSubjectFromText('Required For: Kiln 2 shutdown spares'), 'Kiln 2 shutdown spares');
});

test('PR SUBJECT: an item row or a column header is NEVER mistaken for the subject', () => {
  const text = [
    'Approved Requisition Report',
    'Description: 404602703004 Anchor Corrugated', // carries an item code → rejected
    'Item Code   Description   UOM   Quantity',
  ].join('\n');
  assert.equal(prSubjectFromText(text), '');
  assert.equal(prSubjectFromText('nothing useful here'), '');
  assert.equal(prSubjectFromText(''), '');
});

test('PR 12601612: explicit header "PR Description" is used verbatim', () => {
  const pr = purchaseRequisitionFromLlm({
    requestNo: '12601612', description: 'Anchors for production department.',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, TWS.10(60)-200(140)-40-253, Grade 253 MA', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 anchor', quantity: 2000, unit: 'EA' },
    ],
  }, 'pr.pdf')!;
  assert.equal(resolvePrDescription(pr), 'Anchors for production department.');
});

test('PR 12601707: no header field → derived from the single item description (not "Not provided")', () => {
  const pr = purchaseRequisitionFromLlm({
    requestNo: '12601707', description: null,
    items: [
      { itemCode: '125007', description: 'Conversion Kit For Rotary Packer To Pactron 2 For Type R8 Zml 480 V 60 Hz, Cpl. Accessaries As Pacpal Roto Fill Control Panel With Bt Module, Control Cabinet Roto Fill With Bt Module And 8 Control Modules 97.', quantity: 1, unit: 'SET' },
    ],
  }, 'pr.pdf')!;
  const desc = resolvePrDescription(pr);
  assert.ok(/^Conversion Kit For Rotary Packer/.test(desc), `derived from item: ${desc}`);
  assert.ok(desc.endsWith('And 8 Control Modules'), `no stray "97.": ${desc}`);
  assert.ok(desc !== '', 'never "Not provided" when the item has a description');
});

test('trailing orphan ref fragment ("… Modules 97.") is stripped from the item description', () => {
  const pr = purchaseRequisitionFromLlm({
    requestNo: 'X', description: null,
    items: [{ itemCode: '125007', description: 'Roto Fill With Bt Module And 8 Control Modules 97.', quantity: 1, unit: 'SET' }],
  }, 'pr.pdf')!;
  assert.equal(pr.items[0].description, 'Roto Fill With Bt Module And 8 Control Modules');
});

test('a genuine trailing number kept when it is part of a short unit/size token (not stripped aggressively)', () => {
  // "R8" / "480 V" etc. sit mid-description; a legit trailing value after a short
  // token like "x 50" is preserved (the guard requires a ≥3-letter preceding word).
  const pr = purchaseRequisitionFromLlm({
    requestNo: 'Y', description: null,
    items: [{ itemCode: 'B', description: 'Hex Bolt M12 x 50', quantity: 10, unit: 'EA' }],
  }, 'pr.pdf')!;
  assert.equal(pr.items[0].description, 'Hex Bolt M12 x 50');
});

test('multi-item PR with no header → dominant-noun summary; empty PR → "" (Not provided)', () => {
  const multi = purchaseRequisitionFromLlm({
    requestNo: 'M', description: null,
    items: [
      { itemCode: 'a', description: 'Corrugated Anchor 253 MA', quantity: 10, unit: 'EA' },
      { itemCode: 'b', description: 'Stainless Anchor 310', quantity: 5, unit: 'EA' },
      { itemCode: 'c', description: 'Anchor with plastic caps', quantity: 7, unit: 'EA' },
    ],
  }, 'pr.pdf')!;
  assert.equal(resolvePrDescription(multi), 'Anchors');
  assert.equal(resolvePrDescription(null), '');
  assert.equal(resolvePrDescription({ description: null, items: [] }), '');
});
