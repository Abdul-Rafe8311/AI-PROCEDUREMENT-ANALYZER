// Regression tests for the "Customize form" → PDF path of the Technical Approval
// Form. Everything here runs on the fixture PR 12601612 data set — no network, no
// LLM, no live app.
//
// The four behaviours pinned here are the ones that were broken:
//
//  1. hiding an item note takes it off the FORM, for that supplier only;
//  2. hiding a note is not a value edit — it must never re-derive a supplier's
//     Total Price without VAT from the line items;
//  3. the signature blocks never split across a page break — every block keeps its
//     Approved/Denied, Signature and Date lines together, on one page;
//  4. a reviewer-edited supplier name / PR Description is what the form prints,
//     with the extracted value kept beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import { buildComparisonModel } from './pr-comparison';
import {
  applyItemReview,
  buildItemReview,
  cellEdited,
  cellValueEdited,
  editedSuppliers,
  type ItemReview,
  toStore,
} from './item-review';

// tsconfig uses jsx:"preserve", so the renderer's .tsx module is emitted with the
// CLASSIC runtime. Next supplies React automatically; a test must not.
(globalThis as unknown as { React: typeof React }).React = React;

const analysis = buildFreshAnalysis();
const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, {
  prOnly: true,
  fx: FX,
});
const supplyWave = analysis.quotations.find((q) => q.supplierName.includes('Supply Wave'))!;

const freshReview = () => buildItemReview(model, analysis.quotations, {});

/** Hide every note of one kind on one supplier's column — what the modal's "Hide all" does. */
function hideColumnNotes(review: ItemReview, quotationId: string): ItemReview {
  const next = { ...review };
  for (const [k, c] of Object.entries(review)) {
    if (c.quotationId === quotationId && c.specDiff) next[k] = { ...c, specDiffCleared: true };
  }
  return next;
}

async function formText(options: Parameters<typeof renderForm>[0]): Promise<string> {
  const blob = await renderForm(options);
  const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: true });
  return text as string;
}
async function renderForm(options: Record<string, unknown>): Promise<Blob> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  return generateApprovalFormPdf(analysis, { fx: FX, ...options });
}
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ── 1. hiding a note reaches the PDF, per supplier column ──────────────────

test('NOTES: the fixture really does flag several suppliers, not just one', () => {
  const flagged = Object.values(freshReview()).filter((c) => c.specDiff);
  const suppliers = new Set(flagged.map((c) => c.supplier));
  assert.ok(suppliers.size >= 3, `expected ≥3 flagged suppliers, got ${[...suppliers].join(', ')}`);
  // Supply Wave carries the flag on FOUR separate line items — which is why a
  // single per-cell toggle could never clear "the Supply Wave note".
  assert.equal(flagged.filter((c) => c.quotationId === supplyWave.id).length, 4);
});

test('NOTES: hiding a column’s spec-differs notes removes them from the PDF, and only theirs', async () => {
  const before = await formText({});
  const after = await formText({ itemReview: hideColumnNotes(freshReview(), supplyWave.id) });

  // Supply Wave's own notes are gone…
  assert.equal(occurrences(before, 'SS 310 vs PR'), 4);
  assert.equal(occurrences(after, 'SS 310 vs PR'), 0);
  // …and no other supplier's finding was touched.
  assert.equal(occurrences(after, '253 MA vs PR'), occurrences(before, '253 MA vs PR'));
  assert.equal(occurrences(after, 'dimension differs'), occurrences(before, 'dimension differs'));
});

test('NOTES: a hidden note survives the persist/reload round trip', () => {
  const stored = toStore(hideColumnNotes(freshReview(), supplyWave.id));
  const reloaded = buildItemReview(model, analysis.quotations, stored);
  const swFlags = Object.values(reloaded).filter((c) => c.quotationId === supplyWave.id && c.specDiff);
  assert.equal(swFlags.length, 4);
  assert.ok(swFlags.every((c) => c.specDiffCleared));
});

test('NOTES: the unit-conversion warning is independently hideable', () => {
  const review = freshReview();
  const [key, cell] = Object.entries(review)[0];
  // Synthesise the warning: the fixture's units all convert cleanly.
  review[key] = { ...cell, unitWarningNote: 'cannot be converted to EA', unitWarning: true, unitWarningCleared: true };
  const stored = toStore(review);
  assert.equal(stored[key]?.unitWarningCleared, true);
  assert.equal(stored[key]?.specDiffCleared, undefined, 'hiding one note must not hide the other');

  const applied = applyItemReview(model, review, FX);
  const [rowKey] = key.split('::');
  const rowIdx = Number(rowKey.slice(1)) - 1;
  const colIdx = model.suppliers.findIndex((s) => s.quotationId === cell.quotationId);
  assert.equal(applied.model.rows[rowIdx].cells[colIdx]?.unitWarningCleared, true);
});

// ── 2. hiding a note is not a value edit ───────────────────────────────────

test('NOTES: hiding a note never re-derives the supplier’s Total Price without VAT', async () => {
  const review = hideColumnNotes(freshReview(), supplyWave.id);
  const hidden = Object.values(review).filter((c) => c.specDiffCleared);

  // It still counts as "touched" for the UI badge…
  assert.ok(hidden.every(cellEdited));
  // …but it is NOT a value edit, so the total-recompute set stays empty.
  assert.ok(hidden.every((c) => !cellValueEdited(c)));
  assert.equal(editedSuppliers(review).size, 0);
  assert.deepEqual(applyItemReview(model, review, FX).totals, {});

  // And the printed total row is byte-identical.
  const slice = (s: string) => s.slice(s.indexOf('Total Price without VAT'), s.indexOf('Total Price without VAT') + 200);
  assert.equal(slice(await formText({ itemReview: review })), slice(await formText({})));
});

test('NOTES: a real value edit still recomputes that supplier’s total', () => {
  const review = freshReview();
  const key = Object.keys(review).find((k) => review[k].quotationId === supplyWave.id && review[k].quoted)!;
  review[key] = { ...review[key], unitPrice: { ...review[key].unitPrice, edited: '99.00' } };
  assert.deepEqual([...editedSuppliers(review)], [supplyWave.id]);
  assert.ok(applyItemReview(model, review, FX).totals[supplyWave.id] > 0);
});

// ── 3. signature blocks survive a page break ───────────────────────────────

const ROLES = [
  'PM Section Head',
  'Planning Engineer',
  'Planning Team Leader',
  'Prod./Mech. Manager',
  'Electrical Engineer',
  'VP Operations',
];

test('SIGNATURES: no block is ever split across a page break', async () => {
  // Sweep PR sizes so the signature area lands at every offset relative to the
  // page break. Before the fix, 8/9/10 items each orphaned part of a block —
  // the 4 blocks on one page printed with NO "Date:" line at all.
  for (let extra = 0; extra <= 10; extra++) {
    const padded = JSON.parse(JSON.stringify(analysis)) as typeof analysis;
    const proto = padded.purchaseRequisition!.items[0];
    for (let i = 0; i < extra; i++) {
      padded.purchaseRequisition!.items.push({ ...proto, description: `Filler ${i + 1} — ${proto.description}` });
    }
    const { generateApprovalFormPdf } = await import('./approval-form');
    const blob = await generateApprovalFormPdf(padded, { fx: FX, signatureRoles: ROLES });
    const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
    const { text: pages } = await extractText(doc, { mergePages: false });

    for (const [i, pageText] of (pages as string[]).entries()) {
      const titles = ROLES.filter((r) => pageText.includes(r)).length;
      const where = `${5 + extra} PR items, page ${i + 1}`;
      // A block is whole or absent: its title, both checkboxes, Signature and Date
      // all land on the same page.
      assert.equal(occurrences(pageText, 'Approved'), titles, `Approved lines on ${where}`);
      assert.equal(occurrences(pageText, 'Denied'), titles, `Denied lines on ${where}`);
      assert.equal(occurrences(pageText, 'Signature:'), titles, `Signature lines on ${where}`);
      // The header carries one "Date:" of its own ("TA Date:"), so allow for it.
      const dates = occurrences(pageText, 'Date:') - occurrences(pageText, 'TA Date:');
      assert.equal(dates, titles, `Date lines on ${where}`);
    }
    // Every role printed exactly once across the document.
    const all = (pages as string[]).join('');
    for (const role of ROLES) assert.equal(occurrences(all, role), 1, `"${role}" printed once`);
  }
});

// ── 4. editable supplier name + PR Description ─────────────────────────────

test('HEADER: the form prints the reviewer’s supplier name and PR Description', async () => {
  const text = await formText({
    supplierNames: { [supplyWave.id]: { original: supplyWave.supplierName, edited: 'Supply Wave Trading Establishment' } },
    prDescription: { original: 'Anchors for Kiln department', edited: 'Anchors for the Kiln department (rev B)' },
  });
  assert.ok(text.includes('Supply Wave Trading Establishment'), 'edited supplier name printed');
  assert.ok(text.includes('Anchors for the Kiln department (rev B)'), 'edited PR description printed');
});

test('HEADER: an untouched or blanked field falls back to the extracted value', async () => {
  const extracted = await formText({});
  assert.ok(extracted.includes(supplyWave.supplierName));
  assert.ok(extracted.includes('Anchors for Kiln department'));

  // Clearing the box is not a licence to print an unlabelled price column…
  const blanked = await formText({
    supplierNames: { [supplyWave.id]: { original: supplyWave.supplierName, edited: '   ' } },
    prDescription: { original: 'Anchors for Kiln department', edited: '' },
  });
  assert.ok(blanked.includes(supplyWave.supplierName), 'blank edit falls back to the extracted supplier name');
  // …but a cleared PR Description IS a decision, and prints as absent — the same
  // wording a requisition with no subject line gets.
  assert.ok(!blanked.includes('Anchors for Kiln department'), 'a cleared PR description is respected');
  assert.ok(blanked.includes('Not provided'), 'a cleared PR description prints as "Not provided"');
});

test('HEADER: renaming a supplier never moves the recommendation or the scoring', async () => {
  const before = await formText({});
  const after = await formText({
    supplierNames: { [supplyWave.id]: { original: supplyWave.supplierName, edited: 'ZZZ Renamed Co' } },
  });
  const aiLine = (s: string) => s.slice(s.indexOf('AI SUGGESTED —'), s.indexOf('AI SUGGESTED —') + 160);
  assert.equal(aiLine(after), aiLine(before));
});
