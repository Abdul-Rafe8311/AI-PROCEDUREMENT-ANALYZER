// One PR item quoted as SEVERAL supplier positions — Farid's PR 12602527.
//
// Saudi Fal's quotation S1262128249 answers the requisition's SINGLE support-renewal
// line with two positions:
//
//   Pos 1  GUARDIAN-AND-FMR-PORTABLE.   SAR 16,430.00
//   Pos 2  AUPDATE.. / Reactivation Fee SAR  6,735.00
//                                       ─────────────
//                             Sub Total SAR 23,165.00
//
// The matcher assigns ONE quoted line per PR row, so Pos 1 claimed the row and Pos 2
// fell into `extraLines` — which no renderer prints. The form therefore showed only
// "GUARDIAN-AND-FMR-PORTABLE." at 16,430 while the Total Price carried the correct
// 23,165, and the reactivation fee was never mentioned anywhere on the document.
//
// Both positions must now reach the form as one combined cell that reconciles
// against the supplier's stated total.
//
// Synthetic fixture built through the real pipeline (extraction mapping → PR
// matching → assembleAnalysis → applyFxRates). No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { extractText, getDocumentProxy } from 'unpdf';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { matchSupplierItems } from './item-matching';
import { buildComparisonModel } from './pr-comparison';
import { taFormWorkbookBuffer } from './ta-form-excel';
import type { FxRates } from './fx-rates';

// tsconfig uses jsx:"preserve", so the renderer's .tsx module is emitted with the
// CLASSIC runtime. Next supplies React automatically; a test must not.
(globalThis as unknown as { React: typeof React }).React = React;

const FX: FxRates = {
  base: 'USD',
  rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 },
  asOf: '2026-07-27T00:00:00.000Z',
  live: true,
  source: 'test',
};

const POS_1 = 'GUARDIAN-AND-FMR-PORTABLE.';
const POS_2 = 'AUPDATE.. Reactivation Fee';
const P1 = 16430;
const P2 = 6735;
const SUB_TOTAL = P1 + P2; // 23,165.00 — the quotation's stated Sub Total / TOTAL

// PR 12602527 — a SINGLE requisition line.
const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12602527',
    description: '1-Year Product Support Renewal',
    items: [
      {
        itemCode: '404602799001',
        description: 'Product Support and Repair Portable - AMS 2140, Duration 12 months',
        quantity: 1,
        unit: 'EA',
      },
    ],
  },
  'requisition-12602527.pdf',
)!;

const saudiFal: LlmSupplier = {
  supplierName: 'Saudi Fal Co. Ltd',
  reference: 'S1262128249',
  prNumber: '12602527',
  currency: 'SAR',
  totalAmount: SUB_TOTAL,
  vatAmount: 3474.75,
  totalWithoutVat: SUB_TOTAL,
  totalsByCurrency: null,
  deliveryTime: '4-6 Weeks',
  deliveryTerms: 'Delivered Duty Paid',
  countryOfOrigin: null,
  supplierCountry: 'Saudi Arabia',
  paymentTerms: '100 % Advance',
  warranty: null,
  validUntil: '2026-08-27',
  lineItems: [
    { name: POS_1, quantity: 1, unitPrice: P1, totalPrice: P1, category: 'product', uom: 'ea', availableInDays: null },
    { name: POS_2, quantity: 1, unitPrice: P2, totalPrice: P2, category: 'product', uom: 'ea', availableInDays: null },
  ],
};

const quotations = quotationsFromLlmSuppliers([saudiFal], 'S1262128249.pdf', { currency: 'SAR', confidence: 0.99 });
const analysis = applyFxRates(assembleAnalysis(quotations, false, pr), FX);

const modelOf = () =>
  buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx: FX });

// ── 1. matching: the second position belongs TO the item, not beside it ──────

test('MATCH: both quoted positions attach to the single PR item', () => {
  const m = matchSupplierItems(quotations[0], pr.items);
  assert.equal(m.prItems.length, 1);
  assert.equal(m.prItems[0].supplierItem?.name, POS_1, 'the first position claims the row');
  assert.deepEqual(
    (m.prItems[0].additionalItems ?? []).map((l) => l.name),
    [POS_2],
    'the reactivation fee attaches to the same PR item',
  );
  // extraLines is rendered NOWHERE — anything left there is invisible on the form.
  assert.equal(m.extraLines.length, 0, 'nothing is left in the unrendered extraLines bucket');
  assert.equal(m.notQuotedCount, 0, 'the item is quoted');
});

test('MATCH: the per-item counts still add up to the PR item count', () => {
  const m = matchSupplierItems(quotations[0], pr.items);
  assert.equal(m.matchCount + m.specDiffCount + m.notQuotedCount, pr.items.length);
});

// ── 2. the comparison model — the ONE source both renderers read ─────────────

test('GRID: the two positions become one cell, priced at their combined total', () => {
  const model = modelOf();
  const prRows = model.rows.filter((r) => r.kind === 'pr');
  assert.equal(prRows.length, 1, 'one row for the one PR item');
  const cell = prRows[0].cells[0]!;
  assert.equal(cell.description, `${POS_1} + ${POS_2}`, 'both positions are named in the cell');
  assert.equal(cell.lineTotal, SUB_TOTAL, 'the line total is the sum of both positions');
  assert.equal(cell.unitPrice, SUB_TOTAL, 'PR qty is 1, so the unit price is the combined total');
});

test('GRID: the combined cell reconciles against the supplier’s stated total', () => {
  const model = modelOf();
  const rowsTotal = model.rows
    .flatMap((r) => r.cells)
    .reduce((s, c) => s + (c?.lineTotal ?? 0), 0);
  assert.equal(rowsTotal, quotations[0].totalCost, 'the printed lines now sum to the stated total');
  assert.equal(rowsTotal, SUB_TOTAL);
});

test('GRID: qty x unit price still equals the line total', () => {
  const cell = modelOf().rows.filter((r) => r.kind === 'pr')[0].cells[0]!;
  assert.equal((cell.qty ?? 0) * (cell.unitPrice ?? 0), cell.lineTotal);
});

// ── 3. the renderers actually print it — the whole point of the bug ──────────

test('PDF: the reactivation fee appears on the form', async () => {
  const { generateApprovalFormPdf } = await import('./approval-form');
  const blob = await generateApprovalFormPdf(analysis, { fx: FX });
  const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: true });
  const flat = (text as string).replace(/\s+/g, ' ');
  assert.ok(flat.includes('Reactivation Fee'), 'the second position is named on the PDF');
  assert.ok(flat.includes('GUARDIAN'), 'the first position is still named');
  assert.ok(flat.includes('23,165'), 'the combined figure is printed');
});

test('EXCEL: the reactivation fee appears in the workbook', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await taFormWorkbookBuffer(analysis, { fx: FX })) as unknown as ArrayBuffer);
  let flat = '';
  wb.worksheets.forEach((ws) =>
    ws.eachRow((r) => r.eachCell((c) => { flat += ` ${c.text ?? ''}`; })),
  );
  flat = flat.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Reactivation Fee'), 'the second position is named in the .xlsx');
  assert.ok(flat.includes('GUARDIAN'), 'the first position is still named');
});

// ── 4. the narrow scope holds: multi-item PRs are untouched ──────────────────

test('SCOPE: with several PR items an unplaced line stays an EXTRA, not a sub-line', () => {
  const multiPr = purchaseRequisitionFromLlm(
    {
      requestNo: '12602527-multi',
      items: [
        { itemCode: 'A', description: 'Product Support and Repair Portable - AMS 2140, 12 months', quantity: 1, unit: 'EA' },
        { itemCode: 'B', description: 'Ceramic Fibre Blanket 128kg/m3, 25mm thick', quantity: 50, unit: 'ROLL' },
      ],
    },
    'requisition-multi.pdf',
  )!;
  const [q] = quotationsFromLlmSuppliers(
    [{ ...saudiFal, lineItems: [
      ...saudiFal.lineItems,
      { name: 'Ceramic Fibre Blanket 128kg/m3 25mm', quantity: 50, unitPrice: 80, totalPrice: 4000, category: 'product', uom: 'ROLL', availableInDays: null },
    ] }],
    'multi.pdf',
    { currency: 'SAR', confidence: 0.99 },
  );
  const m = matchSupplierItems(q, multiPr.items);
  // Both PR rows are filled, and the leftover position is reported as extra rather
  // than guessed onto a row — attributing it correctly is a separate problem.
  assert.equal(m.prItems.every((p) => p.supplierItem != null), true, 'both PR rows are quoted');
  assert.equal(m.prItems.every((p) => !p.additionalItems?.length), true, 'no sub-lines are invented');
  assert.equal(m.extraLines.length, 1, 'the leftover position stays an extra line');
});
