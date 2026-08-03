// The TA form's paper and type standard, for BOTH exports.
//
// Fixture data only — no network, no LLM, no real supplier document.
//
//  1. A3 landscape, PDF and .xlsx alike.
//  2. Body type large enough to read on paper, with the supplier column heading
//     bigger and bold in both formats.
//  3. Nothing overflows its column. react-pdf does not clip, so a part code wider
//     than its sub-column silently overruns the one beside it — this is the check
//     that caps how far the type can be raised.
//  4. One page where it fits, a clean second page where it does not, with every
//     signature block whole on whichever page it lands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import { buildComparisonModel } from './pr-comparison';
import { trimSupplierDescription } from './supplier-desc';
import { taFormWorkbookBuffer } from './ta-form-excel';
import * as LAYOUT from './approval-form-layout';

(globalThis as unknown as { React: typeof React }).React = React;

const analysis = buildFreshAnalysis();

async function renderPdf(opts: Record<string, unknown> = {}): Promise<Uint8Array> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  return new Uint8Array(await (await generateApprovalFormPdf(analysis, { fx: FX, ...opts })).arrayBuffer());
}

// A3 landscape in points, to the nearest point.
const A3_W = 1191;
const A3_H = 842;

// ── 1. paper ───────────────────────────────────────────────────────────────

test('A3: every page of the PDF is A3 landscape', async () => {
  const doc = await PDFDocument.load(await renderPdf());
  assert.ok(doc.getPageCount() >= 1);
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { width, height } = doc.getPage(i).getSize();
    assert.equal(Math.round(width), A3_W, `page ${i + 1} width`);
    assert.equal(Math.round(height), A3_H, `page ${i + 1} height`);
  }
});

test('A3: the fillable build keeps the same paper', async () => {
  const doc = await PDFDocument.load(await renderPdf({ fillable: true }));
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { width, height } = doc.getPage(i).getSize();
    assert.equal(Math.round(width), A3_W);
    assert.equal(Math.round(height), A3_H);
  }
});

test('A3: the .xlsx is set to A3 landscape too', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await taFormWorkbookBuffer(analysis, { fx: FX })) as unknown as ArrayBuffer);
  for (const ws of wb.worksheets) {
    assert.equal(ws.pageSetup.paperSize, 8, 'A3 (OOXML paperSize 8)');
    assert.equal(ws.pageSetup.orientation, 'landscape');
  }
});

// ── 2. type ────────────────────────────────────────────────────────────────

test('TYPE: the PDF body is meaningfully larger than the A4 original', async () => {
  // It was 6.5pt. Anything at or below that is a regression of the whole point.
  assert.ok(LAYOUT.FS >= 8, `body type is ${LAYOUT.FS}pt`);
  assert.ok(LAYOUT.FS > 6.5, 'larger than the A4 original');
});

test('TYPE: the supplier column heading is bigger than the body, in both formats', async () => {
  // PDF: assert on what was actually DRAWN, not just the constant.
  const { measureRuns } = await import('./approval-form-overlay');
  const runs = await measureRuns(await renderPdf());
  const nameRun = runs.find((r) => r.str.includes('KROSAKI'));
  const bodyRun = runs.find((r) => r.str.includes('Payment Terms'));
  assert.ok(nameRun, 'the supplier name is drawn');
  assert.ok(bodyRun, 'body text is drawn');
  assert.ok(
    nameRun!.size > bodyRun!.size,
    `supplier name ${nameRun!.size}pt should exceed body ${bodyRun!.size}pt`,
  );
  assert.equal(Math.round(nameRun!.size * 10) / 10, LAYOUT.TYPE.supplierName);

  // .xlsx: the band is a rich-text run, larger and bold than the 12pt body.
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await taFormWorkbookBuffer(analysis, { fx: FX })) as unknown as ArrayBuffer);
  let size = 0;
  let bold = false;
  wb.worksheets[0].eachRow((r) =>
    r.eachCell((c) => {
      const rt = (c.value as { richText?: { text: string; font?: { size?: number; bold?: boolean } }[] } | null)?.richText;
      if (rt?.[0]?.text?.startsWith('SUPPLIER #') && !size) {
        size = rt[0].font?.size ?? 0;
        bold = !!rt[0].font?.bold;
      }
    }),
  );
  assert.ok(size > 12, `xlsx supplier band ${size}pt exceeds the 12pt body`);
  assert.equal(bold, true, 'xlsx supplier band is bold');
});

test('TYPE: the overlay can still tell the type sizes apart', () => {
  // The overlay identifies a run by matching its size to ±0.3pt, so raising the
  // scale must not bring two of them within 0.6pt of each other.
  const sizes = Object.entries(LAYOUT.TYPE);
  for (const [aName, a] of sizes) {
    for (const [bName, b] of sizes) {
      if (aName === bName || a === b) continue;
      assert.ok(
        Math.abs(a - b) > 0.6,
        `${aName} (${a}) and ${bName} (${b}) are too close for the ±0.3 match`,
      );
    }
  }
});

// ── 3. nothing overflows its column ────────────────────────────────────────

test('FIT: the longest unbreakable token fits every column it can land in', async () => {
  // This is the constraint that sets the type size. A part code has no space to
  // wrap at, and react-pdf does not clip — at 9.5pt the supplier description was
  // being written straight through the quantity column beside it.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, {
    prOnly: true,
    fx: FX,
  });
  const pad = 2 * LAYOUT.CELL_PAD_X;
  const widest = (tokens: string[]) =>
    tokens.reduce((m, t) => Math.max(m, font.widthOfTextAtSize(t, LAYOUT.FS)), 0);

  const prTokens: string[] = [];
  const descTokens: string[] = [];
  const qtys: string[] = [];
  const prices: string[] = [];
  for (const r of model.rows) {
    prTokens.push(...String(r.label).split(/\s+/));
    r.cells.forEach((c) => {
      if (!c) return;
      descTokens.push(...(c.description ? trimSupplierDescription(c.description, r.label) : '').split(/\s+/));
      qtys.push(c.qty == null ? '' : c.qty.toLocaleString('en-US'));
      prices.push(
        `${c.currency} ${(c.unitPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      );
    });
  }

  const { desc, qty, price } = LAYOUT.supplierSubCols(LAYOUT.SUP_PER_GROUP);
  assert.ok(widest(prTokens) + pad <= LAYOUT.PR_DESC_W, 'PR description column holds its longest token');
  assert.ok(widest(descTokens) + pad <= desc, 'supplier description sub-column holds its longest part code');
  assert.ok(widest(qtys) + pad <= qty, 'quantity sub-column holds its widest quantity');
  assert.ok(widest(prices) + pad <= price, 'price sub-column holds its widest price');
});

test('FIT: a supplier block never runs past the usable page width', () => {
  const { supW } = LAYOUT.supplierSubCols(LAYOUT.SUP_PER_GROUP);
  assert.ok(
    LAYOUT.LEFT_W + LAYOUT.SUP_PER_GROUP * supW <= LAYOUT.USABLE + 0.5,
    'four supplier groups plus the left block fit the page',
  );
});

// ── 4. pagination ──────────────────────────────────────────────────────────

test('PAGES: a supplier block is never split across a page break', async () => {
  // How many blocks share a page depends on how tall their rows wrapped, so that
  // is not something to pin. What must always hold is that a block and its own
  // term rows stay together: a grid whose "Total Price without VAT" landed on the
  // next page from its prices would be unreadable and unsignable.
  const { measureRuns } = await import('./approval-form-overlay');
  const runs = await measureRuns(await renderPdf());
  const byPage = new Map<number, string>();
  for (const r of runs) byPage.set(r.page, (byPage.get(r.page) ?? '') + ' ' + r.str);

  const blockPages = [...byPage.entries()].filter(([, t]) => /Suppliers \d/.test(t)).map(([p]) => p);
  assert.ok(blockPages.length > 0, 'the grid is rendered');
  for (const p of blockPages) {
    const text = byPage.get(p)!;
    const headers = (text.match(/Suppliers \d/g) ?? []).length;
    // Each block on this page brought its own full set of term rows with it.
    for (const label of ['Total Price without VAT', 'Payment Terms', 'Technical Comments']) {
      assert.equal(
        text.split(label).length - 1,
        headers,
        `page ${p + 1} has "${label}" once per supplier block on it`,
      );
    }
  }
});

test('PAGES: two pages is the ceiling for this PR, and the sign-off owns the last one', async () => {
  // Farid confirmed the approval blocks may fall to a second page rather than the
  // layout being compressed to force one. What is not acceptable is the form
  // sprawling further than that for an ordinary five-supplier requisition.
  const doc = await PDFDocument.load(await renderPdf());
  assert.ok(doc.getPageCount() <= 2, `expected at most 2 pages, got ${doc.getPageCount()}`);

  const { measureRuns } = await import('./approval-form-overlay');
  const runs = await measureRuns(await renderPdf());
  const last = doc.getPageCount() - 1;
  const lastText = runs.filter((r) => r.page === last).map((r) => r.str).join(' ');
  assert.ok(lastText.includes('Final Recommendation'), 'the sign-off is on the last page');
  for (let p = 0; p < last; p++) {
    const t = runs.filter((r) => r.page === p).map((r) => r.str).join(' ');
    assert.ok(!t.includes('Final Recommendation'), `page ${p + 1} does not repeat the sign-off`);
  }
});

test('PAGES: the fillable overlay sizes EACH block on a shared page correctly', async () => {
  // Two blocks on one page used to be read as a single grid of 4+1 = 5 columns,
  // which mis-sized every sub-column and filed quantities as prices.
  const doc = await PDFDocument.load(await renderPdf({ fillable: true }));
  const fields = doc.getForm().getFields();
  const priceFields = fields.filter((f) => f.getName().includes('cell_price'));
  assert.ok(priceFields.length > 0, 'price cells became fields');
  for (const f of priceFields) {
    const text = (f as import('pdf-lib').PDFTextField).getText() ?? '';
    if (!text.trim()) continue;
    assert.match(text, /^[A-Z]{3} [\d,]+\.\d{2}$/, `${f.getName()} holds a price, not a quantity: "${text}"`);
  }
  // The sign-off page gets its fields too, rather than being skipped for having
  // no supplier table on it.
  assert.ok(
    fields.some((f) => f.getName().endsWith('final_recommendation')),
    'the Final Recommendation on the sign-off page is editable',
  );
});
