// Print pagination of the .xlsx Technical Approval Form.
//
// The workbook asked for `fitToWidth: 1, fitToHeight: 0` — "one page wide, as many
// pages tall as it takes, and never shrink vertically". A sheet that overran the
// paper by a whisker therefore emitted a SECOND page carrying nothing but the
// signature tail: the fixture's single-supplier sheet measured 11.31in against
// 10.89in of usable A3, a 4% overrun that cost a whole sheet of paper.
//
// The rule now: measure the finished sheet, and when it nearly fits, give Excel a
// one-page height budget so it scales onto one page. Genuinely long requisitions
// keep flowing onto further pages — squeezing 40 items onto one A3 would be
// unreadable, and the header rows repeat instead.
//
// All fixture data, built through the real pipeline. No network, no LLM, no API key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { taFormWorkbookBuffer } from './ta-form-excel';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import type { AnalysisResult } from './workspace-types';

const supplier = (o: Partial<LlmSupplier> = {}): LlmSupplier => ({
  supplierName: 'Saudi Fal Co. Ltd', reference: 'S1262128249', prNumber: '12602527', currency: 'SAR',
  totalAmount: 23165, vatAmount: 3474.75, totalWithoutVat: 23165, totalsByCurrency: null,
  deliveryTime: '4-6 Weeks', deliveryTerms: 'DDP', countryOfOrigin: null, supplierCountry: 'Saudi Arabia',
  paymentTerms: '100 % Advance', warranty: null, validUntil: null, lineItems: [], ...o,
});

const build = (pr: Parameters<typeof assembleAnalysis>[2], s: LlmSupplier): AnalysisResult =>
  applyFxRates(
    assembleAnalysis(quotationsFromLlmSuppliers([s], 'q.pdf', { currency: 'SAR', confidence: 0.99 }), false, pr),
    FX,
  );

// ── the smallest real form: one requisition line, one supplier ──
const smallPr = purchaseRequisitionFromLlm(
  { requestNo: '12602527', description: '1-Year Product Support Renewal', items: [
    { itemCode: 'A1', description: 'Product Support and Repair Portable - AMS 2140, 12 months', quantity: 1, unit: 'EA' },
  ] },
  'pr.pdf',
)!;
const small = build(smallPr, supplier({
  lineItems: [{ name: 'GUARDIAN-AND-FMR-PORTABLE.', quantity: 1, unitPrice: 23165, totalPrice: 23165, category: 'product', uom: 'ea', availableInDays: null }],
}));

// ── a genuinely long requisition: 40 lines ──
const longPr = purchaseRequisitionFromLlm(
  { requestNo: '99999', description: 'Long requisition', items: Array.from({ length: 40 }, (_, i) => ({
    itemCode: `C${i}`, description: `Anchor, Corrugated, Type TWS.10(60)-${200 + i}(140)-40-253, Grade 253 MA`,
    quantity: 100 + i, unit: 'EA',
  })) },
  'big.pdf',
)!;
const longForm = build(longPr, supplier({
  totalAmount: 99999, totalWithoutVat: 99999,
  lineItems: longPr.items.map((it, i) => ({
    name: it.description, quantity: it.quantity, unitPrice: 10 + i, totalPrice: null,
    category: 'product' as const, uom: 'EA', availableInDays: null,
  })),
}));

async function sheetsOf(analysis: AnalysisResult) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await taFormWorkbookBuffer(analysis, { fx: FX })) as unknown as ArrayBuffer);
  return wb.worksheets;
}

// ── 1. small data fits on one page ──────────────────────────────────────────

test('SMALL: a one-item, one-supplier form is budgeted a SINGLE page', async () => {
  for (const ws of await sheetsOf(small)) {
    assert.equal(ws.pageSetup.fitToHeight, 1, `"${ws.name}" is held to one page tall`);
    assert.equal(ws.pageSetup.fitToWidth, 1, 'still one page wide');
    assert.equal(ws.pageSetup.fitToPage, true, 'fit-to-page is actually enabled');
  }
});

test('SMALL: the near-miss sheet that used to spill no longer does', async () => {
  // The fixture's 5th supplier lands alone on its own sheet — 11.31in of content
  // against 10.89in of usable A3. That 4% is exactly what wasted a page.
  const sheets = await sheetsOf(buildFreshAnalysis());
  const tail = sheets[sheets.length - 1];
  assert.match(tail.name, /Suppliers 5-5/, 'the lone-supplier sheet');
  assert.equal(tail.pageSetup.fitToHeight, 1, 'scaled onto one page instead of spilling');
});

// ── 2. large data still flows ───────────────────────────────────────────────

test('LONG: a 40-item requisition is left to flow onto further pages', async () => {
  const [ws] = await sheetsOf(longForm);
  assert.equal(ws.pageSetup.fitToHeight, 0, 'height is unbounded — it must NOT be crushed');
  assert.equal(ws.pageSetup.fitToWidth, 1, 'but still one page wide');
});

// ── 3. the settings the audit called for ────────────────────────────────────

test('SETUP: margins are minimal on every sheet', async () => {
  for (const analysis of [small, longForm, buildFreshAnalysis()]) {
    for (const ws of await sheetsOf(analysis)) {
      const m = ws.pageSetup.margins!;
      for (const [side, v] of Object.entries({ left: m.left, right: m.right, top: m.top, bottom: m.bottom })) {
        assert.ok(v <= 0.5, `${ws.name} ${side} margin ${v}" is at most 0.5"`);
      }
    }
  }
});

test('SETUP: the print area runs from the header to the last written row', async () => {
  for (const ws of await sheetsOf(small)) {
    const area = ws.pageSetup.printArea;
    assert.ok(area, 'an explicit print area is set');
    const [from, to] = area!.split(':');
    assert.equal(from, 'A1', 'starts at the very first cell');
    const lastRow = Number(to.replace(/[A-Z]/g, ''));
    assert.equal(lastRow, ws.rowCount, 'ends on the last written row — signature blocks included');
    // and the signature block really is inside it
    let sawApprovals = false;
    ws.eachRow((r) => r.eachCell((c) => { if (String(c.text ?? '').includes('APPROVALS')) sawApprovals = true; }));
    assert.ok(sawApprovals, 'the approvals block is part of the printed range');
  }
});

test('SETUP: no manual page break is planted in the middle of the content', async () => {
  for (const analysis of [small, longForm, buildFreshAnalysis()]) {
    for (const ws of await sheetsOf(analysis)) {
      const raw = ws as unknown as { _rows?: ({ model?: { addPageBreak?: boolean } } | undefined)[] };
      const breaks = (raw._rows ?? []).filter((r) => r?.model?.addPageBreak);
      assert.equal(breaks.length, 0, `${ws.name} has no manual row breaks`);
    }
  }
});
