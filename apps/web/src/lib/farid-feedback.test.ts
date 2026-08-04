// Farid's pilot feedback on the TA form, pinned as behaviour.
//
// All fixture data — no network, no LLM, no real supplier document.
//
//  1/2. Country of Origin is a fact about the GOODS. It is never inferred from the
//       supplier's address, and an unstated origin reads "Not stated".
//  3.   When the items in one offer differ, origin and delivery are listed PER
//       ITEM instead of one value standing in for all of them.
//  4.   Line-item prices stay in the currency the supplier quoted; only the TOTAL
//       converts to SAR, with the rate stamp.
//  5.   Every supplier column is numbered "SUPPLIER #n".
//  6.   The workbook prints on A3 at 12pt, with a larger bold supplier band.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import { describePerItem, variesPerItem } from './per-item-field';
import { suggestDeliveryTimes, suggestOrigins } from './item-matching';
import { taFormWorkbookBuffer } from './ta-form-excel';
import type { ExtractedQuotation, LineItem } from './workspace-types';

(globalThis as unknown as { React: typeof React }).React = React;

const analysis = buildFreshAnalysis();
const occurrences = (h: string, n: string) => h.split(n).length - 1;

async function formText(options: Record<string, unknown> = {}): Promise<string> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  const blob = await generateApprovalFormPdf(analysis, { fx: FX, ...options });
  const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: true });
  return text as string;
}

/** A one-supplier quotation with the given product lines. */
function quote(lines: Partial<LineItem>[], q: Partial<ExtractedQuotation> = {}): ExtractedQuotation {
  return {
    id: 'q1',
    fileName: 'q.pdf',
    supplierName: 'Test Supplier',
    totalCost: 100,
    currency: 'EUR',
    totalCostUsd: null,
    deliveryRaw: null,
    deliveryDays: null,
    paymentTerms: null,
    warranty: null,
    validUntil: null,
    lineItems: lines.map((l, i) => ({
      name: `Item ${i + 1}`,
      quantity: 1,
      unitPrice: 1,
      totalPrice: 1,
      currency: 'EUR',
      category: 'product' as const,
      ...l,
    })),
    ...q,
  } as ExtractedQuotation;
}

// ── 1 / 2. origin is about the goods, and blank when unstated ──────────────

test('ORIGIN: an unstated origin reads "Not stated", never the supplier’s country', () => {
  const q = quote([{}, {}], { countryOfOrigin: null, supplierCountry: 'Saudi Arabia' });
  assert.equal(suggestOrigins([q])[q.id], 'Not stated');
});

test('ORIGIN: a trading company’s goods keep the MANUFACTURER’s country', () => {
  // Saudi reseller, German goods — the column must say Germany.
  const q = quote([{}, {}], { countryOfOrigin: 'Germany', supplierCountry: 'Saudi Arabia' });
  assert.equal(suggestOrigins([q])[q.id], 'Germany');
});

// ── 3. per-item origin and delivery ────────────────────────────────────────

test('PER ITEM: one shared value stays a single plain value', () => {
  assert.equal(
    describePerItem([
      { index: 1, value: 'China' },
      { index: 2, value: 'China' },
    ]),
    'China',
  );
  assert.equal(variesPerItem([{ index: 1, value: 'China' }, { index: 2, value: 'China' }]), false);
});

test('PER ITEM: differing values are listed per item', () => {
  assert.equal(
    describePerItem([
      { index: 1, value: 'China' },
      { index: 2, value: 'Germany' },
    ]),
    'Item #1 (China), Item #2 (Germany)',
  );
  assert.equal(variesPerItem([{ index: 1, value: 'China' }, { index: 2, value: 'Germany' }]), true);
});

test('PER ITEM: items that state nothing are left out, not guessed', () => {
  assert.equal(
    describePerItem([
      { index: 1, value: 'China' },
      { index: 2, value: null },
      { index: 3, value: 'Germany' },
    ]),
    'Item #1 (China), Item #3 (Germany)',
  );
  // Nothing anywhere → '' (the caller prints "Not stated"), never the offer's
  // fallback being invented.
  assert.equal(describePerItem([{ index: 1, value: null }]), '');
  assert.equal(describePerItem([{ index: 1, value: null }], 'France'), 'France');
});

test('PER ITEM: a mixed-origin offer prints per item on the Country of Origin row', () => {
  const q = quote(
    [{ countryOfOrigin: 'China' }, { countryOfOrigin: 'Germany' }],
    { countryOfOrigin: null },
  );
  assert.equal(suggestOrigins([q])[q.id], 'Item #1 (China), Item #2 (Germany)');
});

test('PER ITEM: a mixed-lead-time offer prints per item on the Delivery Time row', () => {
  const q = quote([{ deliveryText: '2 weeks' }, { deliveryText: '6 weeks' }], { deliveryRaw: '6 weeks' });
  assert.equal(suggestDeliveryTimes([q])[q.id], 'Item #1 (2 weeks), Item #2 (6 weeks)');
});

test('PER ITEM: charge lines are never numbered as items', () => {
  // Freight is not "Item #3" — only product lines are numbered.
  const q = quote(
    [
      { countryOfOrigin: 'China' },
      { countryOfOrigin: 'Germany' },
      { name: 'Freight', category: 'freight' as const, countryOfOrigin: 'France' },
    ],
    { countryOfOrigin: null },
  );
  assert.equal(suggestOrigins([q])[q.id], 'Item #1 (China), Item #2 (Germany)');
});

// ── 4. line items keep their quoted currency; only totals convert ──────────

test('CURRENCY: a EUR offer’s line prices print in EUR, unconverted', async () => {
  const text = await formText();
  // Krosaki + Refratechnik quote in EUR; their unit prices must read as quoted.
  assert.ok(/EUR 2\.42/.test(text), 'Krosaki’s EUR unit price is printed as quoted');
  assert.ok(/EUR 3\.07/.test(text), 'Refratechnik’s EUR unit price is printed as quoted');

  // …and their SAR conversions must be GONE. 3.07 EUR × 4.2819 = SAR 13.15, which
  // is exactly what this cell printed before. Deliberately checked on a figure no
  // supplier quotes natively: the SAR-quoting suppliers legitimately print "SAR"
  // line prices, so a blanket "no SAR anywhere" check would be meaningless.
  assert.ok(!text.includes('SAR 13.15'), 'Refratechnik’s EUR line is no longer restated in SAR');
  assert.ok(!text.includes('SAR 4.07'), 'Krosaki’s EUR line is no longer restated in SAR');

  // A SAR-quoting supplier still shows SAR — because that is what they quoted.
  assert.ok(/SAR 10\.36/.test(text), 'AlFRAN’s own SAR quote is untouched');

  // The supplier sub-header names the quoted currency, not SAR / USD.
  assert.ok(text.includes('Unit Price / EA (EUR)'), 'EUR column sub-header names EUR');
  assert.ok(text.includes('Unit Price / EA (SAR)'), 'SAR column sub-header names SAR');
  assert.ok(!text.includes('(SAR / USD)'), 'no SAR/USD line-price header remains');
});

test('CURRENCY: the TOTAL still converts to SAR, with the rate stamp intact', async () => {
  const text = await formText();
  assert.ok(text.includes('Total Price without VAT'));
  // The EUR original plus its SAR conversion both appear on the totals row.
  assert.ok(/EUR 36,388\.00/.test(text), 'total keeps the original currency');
  assert.ok(/SAR 155,810\.27/.test(text), 'total also converts to SAR');
  assert.ok(text.includes('SAR conversion rate'), 'the rate stamp is still printed');
  assert.ok(/1 EUR = \d+\.\d{4} SAR/.test(text), 'the stamp names the rate used');
  assert.ok(/rate as of .+ \((live|cached)\)/.test(text), 'the stamp is timestamped');
});

// ── 5. numbered supplier columns ───────────────────────────────────────────

test('LABELS: every supplier column is numbered SUPPLIER #n', async () => {
  const text = await formText();
  for (let i = 1; i <= analysis.quotations.length; i++) {
    assert.equal(occurrences(text, `SUPPLIER #${i}`), 1, `SUPPLIER #${i} appears exactly once`);
  }
  // The company name is kept alongside the number, not replaced by it.
  for (const q of analysis.quotations) assert.ok(text.includes(q.supplierName), `${q.supplierName} still named`);
});

test('LABELS: the number is the supplier’s place in the ANALYSIS, not on its page', async () => {
  // The fixture has 5 suppliers, so #5 wraps to a second block/page. It must still
  // be "SUPPLIER #5" there, not "SUPPLIER #1" of that block.
  const text = await formText();
  assert.ok(text.includes('SUPPLIER #5'), 'the wrapped supplier keeps its analysis-wide number');
  assert.ok(!text.includes('SUPPLIER #6'), 'no number beyond the supplier count');
});

// ── 6. Excel: A3, 12pt, prominent supplier band ────────────────────────────

test('EXCEL: the workbook is set up for A3 landscape, fitted to one page wide', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const buf = await taFormWorkbookBuffer(analysis, { fx: FX });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  for (const ws of wb.worksheets) {
    assert.equal(ws.pageSetup.paperSize, 8, 'A3 (OOXML paperSize 8)');
    assert.equal(ws.pageSetup.orientation, 'landscape');
    assert.equal(ws.pageSetup.fitToPage, true);
    assert.equal(ws.pageSetup.fitToWidth, 1, 'never spills supplier columns onto another sheet');
  }
  // The HEIGHT budget is no longer a constant. It was a flat 0 ("flow, never
  // shrink"), which cost a whole sheet of paper whenever a form overran the page
  // by a few percent — see ta-form-pagination.test.ts. It is now measured per
  // sheet: one page when the content nearly fits, unbounded when it truly doesn't.
  // Both of this fixture's sheets fit.
  for (const ws of wb.worksheets) {
    assert.equal(ws.pageSetup.fitToHeight, 1, `"${ws.name}" fits one page tall`);
  }
});

test('EXCEL: body text is 12pt and the supplier band is larger and bold', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const buf = await taFormWorkbookBuffer(analysis, { fx: FX });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];

  // The supplier band: a rich-text cell whose first run is the numbered name.
  let bandSize = 0;
  let bandBold = false;
  let bandText = '';
  ws.eachRow((r) => {
    r.eachCell((c) => {
      const rt = (c.value as { richText?: { text: string; font?: { size?: number; bold?: boolean } }[] } | null)?.richText;
      if (rt?.[0]?.text?.startsWith('SUPPLIER #') && !bandText) {
        bandSize = rt[0].font?.size ?? 0;
        bandBold = !!rt[0].font?.bold;
        bandText = rt[0].text;
      }
    });
  });
  assert.ok(bandText.startsWith('SUPPLIER #1 — '), `band names and numbers the supplier: ${bandText}`);
  assert.equal(bandBold, true, 'the supplier band is bold');
  assert.ok(bandSize > 12, `the supplier band (${bandSize}pt) is larger than the 12pt body`);

  // A body cell — the PR item description — is 12pt.
  let bodySize = 0;
  ws.eachRow((r) => {
    r.eachCell((c) => {
      if (typeof c.value === 'string' && c.value.startsWith('Anchor, Corrugated') && !bodySize) {
        bodySize = (c.font?.size as number) ?? 0;
      }
    });
  });
  assert.equal(bodySize, 12, 'body text is 12pt');
});

test('EXCEL: line prices stay in the quoted currency; totals still convert', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const buf = await taFormWorkbookBuffer(analysis, { fx: FX });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const cells: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((r) => r.eachCell((c) => typeof c.value === 'string' && cells.push(c.value)));
  }
  const all = cells.join('\n');
  assert.ok(all.includes('EUR 2.42'), 'the EUR unit price is written as quoted');
  assert.ok(all.includes('EUR 3.07'), 'the other EUR supplier likewise');
  // Same targeted check as the PDF: these are the SAR conversions of EUR lines, on
  // figures no supplier quotes natively.
  assert.ok(!all.includes('SAR 13.15'), 'a EUR line is not restated in SAR');
  assert.ok(!all.includes('SAR 4.07'), 'nor the other one');
  assert.ok(all.includes('SAR 10.36'), 'a genuinely SAR-quoted line still reads SAR');
  assert.ok(cells.some((c) => c.includes('EUR 36,388.00') && c.includes('SAR ')), 'the TOTAL still converts');
  assert.ok(cells.some((c) => c.startsWith('Unit Price (EUR)')), 'sub-header names the quoted currency');
});
