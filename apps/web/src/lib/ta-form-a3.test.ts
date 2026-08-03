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
import { helveticaMeasurer, wrapLines } from './text-fit';

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

test('TYPE: the PDF body is readable in print, and matches the workbook', async () => {
  // 6.5pt on A4, then 8pt on A3, now 12pt — the same size the .xlsx uses, so the
  // two exports of one form read alike. Anything below 12 is a regression.
  assert.ok(LAYOUT.FS >= 12, `body type is ${LAYOUT.FS}pt`);
  // Column headers are bold AND a step above the body, so the band reads as a header.
  assert.ok(LAYOUT.TYPE_HEAD > LAYOUT.FS, `header type ${LAYOUT.TYPE_HEAD}pt exceeds body ${LAYOUT.FS}pt`);
  // Nothing on the form is small enough to be a footnote by accident.
  for (const [name, size] of Object.entries(LAYOUT.TYPE)) {
    assert.ok(size >= 9, `${name} is ${size}pt — under the 9pt print floor`);
  }
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

test('FIT: no token can overrun its column once wrapped', async () => {
  // This USED to assert that a whole part code fitted its column outright, which is
  // what capped the body type at 8pt. Cell text is now pre-wrapped by text-fit.ts
  // before react-pdf sees it, so the invariant that actually matters is different:
  // every LINE the wrapper emits fits the column it was wrapped to. A token with no
  // space in it is broken at its own punctuation seams, so "fits outright" is no
  // longer required — "never overruns" still is, because react-pdf does not clip.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const model = buildComparisonModel(analysis.quotations, analysis.purchaseRequisition, analysis.prMatch, {
    prOnly: true,
    fx: FX,
  });
  const pad = 2 * LAYOUT.CELL_PAD_X;
  const widest = (tokens: string[]) =>
    tokens.reduce((m, t) => Math.max(m, font.widthOfTextAtSize(t, LAYOUT.FS)), 0);

  const prLabels: string[] = [];
  const descs: string[] = [];
  const qtys: string[] = [];
  const prices: string[] = [];
  for (const r of model.rows) {
    prLabels.push(String(r.label));
    r.cells.forEach((c) => {
      if (!c) return;
      descs.push(c.description ? trimSupplierDescription(c.description, r.label) : '');
      qtys.push(c.qty == null ? '' : c.qty.toLocaleString('en-US'));
      prices.push(
        `${c.currency} ${(c.unitPrice ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      );
    });
  }

  // The renderer fits columns to THIS document's content, so the test must measure
  // against the same fit rather than the default one.
  const profile = LAYOUT.profileFrom(prLabels, descs, LAYOUT.SUP_PER_GROUP);
  const fit = LAYOUT.fitColumns(LAYOUT.SUP_PER_GROUP, profile);
  const measure = helveticaMeasurer(LAYOUT.FS);

  /** Every wrapped line of every sample fits the column, with room for padding. */
  const fitsWrapped = (samples: string[], colW: number, what: string) => {
    const inner = colW - pad;
    for (const sample of samples) {
      for (const line of wrapLines(sample, inner, measure)) {
        assert.ok(
          font.widthOfTextAtSize(line, LAYOUT.FS) <= inner + 0.5,
          `${what}: wrapped line ${JSON.stringify(line)} is wider than its ${colW}pt column`,
        );
      }
    }
  };

  fitsWrapped(prLabels, fit.prDesc, 'PR description');
  fitsWrapped(descs, fit.desc, 'supplier description');
  // Quantities and prices are short and must NOT wrap — they are single figures, and
  // a price broken across two lines is a misread waiting to happen.
  assert.ok(widest(qtys) + pad <= fit.qty, 'quantity sub-column holds its widest quantity outright');
  assert.ok(widest(prices) + pad <= fit.price, 'price sub-column holds its widest price outright');
});

test('FIT: wrapping only ever splits — it never adds or drops a character', () => {
  // The reason react-pdf's own hyphenation callback is unusable here: it inserts a
  // literal "-" at every intra-word break, which would silently alter a part number
  // on a form somebody signs. Our wrapper must be incapable of that.
  const measure = helveticaMeasurer(LAYOUT.FS);
  const samples = [
    'TWS.10(60)-200(140)-45-253MA-C',
    'ALUMINA BRICK 70% AL2O3 230x114x76/64mm',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'short',
    '',
  ];
  // Whitespace is compared out on BOTH sides: a break at a space legitimately drops
  // that space, and a break inside a token legitimately adds none. What must survive
  // untouched is every non-whitespace character — a stray "-" here is the bug.
  const bare = (t: string) => t.replace(/\s+/g, '');
  for (const s of samples) {
    for (const width of [40, 80, 150, 400]) {
      const joined = wrapLines(s, width, measure).join('');
      assert.equal(bare(joined), bare(s), `wrapping ${JSON.stringify(s)} at ${width}pt altered it`);
    }
  }
});

test('FIT: a supplier block never runs past the usable page width', () => {
  const fit = LAYOUT.fitColumns(LAYOUT.SUP_PER_GROUP);
  assert.ok(
    fit.left + LAYOUT.SUP_PER_GROUP * fit.supW <= LAYOUT.USABLE + 0.5,
    `${LAYOUT.SUP_PER_GROUP} supplier groups plus the left block fit the page`,
  );
});

test('FIT: the overlay recovers the exact column fit the renderer used', () => {
  // Column widths are content-derived, and the overlay sees only the rendered page.
  // The renderer stamps its profile into the PDF's Keywords; if that round-trip
  // breaks, every editable widget lands on the wrong column.
  const profile = LAYOUT.profileFrom(['a'.repeat(70)], ['b'.repeat(20)], 3);
  const decoded = LAYOUT.decodeFit(LAYOUT.encodeFit(profile));
  assert.deepEqual(LAYOUT.fitColumns(3, decoded), LAYOUT.fitColumns(3, profile));
  // An unstamped (or older) document must still fit, on the default profile.
  assert.deepEqual(LAYOUT.decodeFit(undefined), LAYOUT.DEFAULT_PROFILE);
});

test('FIT: a trailing part-block keeps the full block’s column widths', () => {
  // 5 suppliers render as 3 + 2. If the block of 2 stretched to fill the page, the
  // sheet would carry two grids of different geometry — and the overlay, which sees
  // "this band has 2 columns", would place its widgets on the wrong one.
  const profile = LAYOUT.profileFrom(['item description'], ['supplier description'], 3);
  assert.equal(LAYOUT.fitColumns(2, profile).supW, LAYOUT.fitColumns(3, profile).supW);
  assert.equal(LAYOUT.fitColumns(2, profile).prDesc, LAYOUT.fitColumns(3, profile).prDesc);
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

test('PAGES: one page per supplier block plus the sign-off, and no more', async () => {
  // Farid confirmed the approval blocks may fall to their own page rather than the
  // layout being compressed to force them up. What is not acceptable is the form
  // SPRAWLING — so the ceiling is expressed as what the content actually requires,
  // not as a fixed count.
  //
  // This was a flat "at most 2 pages", which was the 8pt result: the whole grid fit
  // page 1 and the sign-off took page 2. At 12pt a block no longer shares a page —
  // five suppliers are two blocks of 3 + 2, so the grid is two pages and the
  // sign-off a third. That is the cost of readable type on a five-supplier PR, and
  // it is the trade the 12pt standard was chosen with. A block spilling across two
  // pages, or a stray fourth page, still fails here.
  const doc = await PDFDocument.load(await renderPdf());
  const blocks = Math.ceil(analysis.quotations.length / LAYOUT.SUP_PER_GROUP);
  assert.ok(
    doc.getPageCount() <= blocks + 1,
    `expected at most ${blocks + 1} pages (${blocks} supplier blocks + sign-off), got ${doc.getPageCount()}`,
  );

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
