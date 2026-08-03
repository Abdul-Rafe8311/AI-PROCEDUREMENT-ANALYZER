// The TA form's money presentation.
//
// Fixture data only — no network, no LLM, no real supplier document.
//
//  1. The form shows WITHOUT-VAT prices only. The with-VAT total row is gone from
//     every build, even for an international supplier whose quote states VAT.
//     `withVatAmount()` still exists and is still correct — it is simply not
//     printed on this form.
//  2. The reviewer picks ANY combination of Original / SAR / USD, independently
//     for line items and for the totals row, per download. Defaults are exactly
//     what the form printed before the control existed: line items as quoted,
//     totals in quoted + SAR + USD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildFreshAnalysis, FX } from '../../scripts/ta-form-fixture';
import { taFormWorkbookBuffer } from './ta-form-excel';
import { withVatAmount } from './workspace-types';
import {
  convertsAwayFromQuoted,
  headerLabel,
  resolveMoneyLines,
  TA_CURRENCY_DISPLAY_DEFAULT,
  type TaCurrencyDisplay,
} from './ta-currency';
import type { AnalysisResult } from './workspace-types';

(globalThis as unknown as { React: typeof React }).React = React;

const base = buildFreshAnalysis();

/**
 * The same analysis with an international supplier that DOES state VAT — the exact
 * case that used to add a "Total Price with VAT" row. Refratechnik is German, so
 * the old rule would have printed the row for them.
 */
function withVatStated(): AnalysisResult {
  const a = JSON.parse(JSON.stringify(base)) as AnalysisResult;
  const q = a.quotations.find((x) => x.supplierName === 'Refratechnik')!;
  q.supplierCountry = 'Germany';
  q.countryOfOrigin = 'Germany';
  q.totalCostInclVat = 53746.2; // 46,736 EUR + 15%
  return a;
}

async function formText(analysis: AnalysisResult, currencyDisplay?: TaCurrencyDisplay): Promise<string> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  const blob = await generateApprovalFormPdf(analysis, { fx: FX, ...(currencyDisplay ? { currencyDisplay } : {}) });
  const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const { text } = await extractText(doc, { mergePages: true });
  return text as string;
}

async function sheetCells(analysis: AnalysisResult, currencyDisplay?: TaCurrencyDisplay): Promise<string[]> {
  const { default: ExcelJS } = await import('exceljs');
  const buf = await taFormWorkbookBuffer(analysis, { fx: FX, ...(currencyDisplay ? { currencyDisplay } : {}) });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((r) => r.eachCell((c) => typeof c.value === 'string' && out.push(c.value)));
  }
  return out;
}

// ── 1. without-VAT only ────────────────────────────────────────────────────

test('VAT: the fixture case really would have printed a with-VAT row before', () => {
  // Guard the guard: if this stops being true the next two tests prove nothing.
  const q = withVatStated().quotations.find((x) => x.supplierName === 'Refratechnik')!;
  assert.equal(withVatAmount(q), 53746.2, 'this supplier qualifies for a with-VAT total');
});

test('VAT: the PDF prints the without-VAT total ONLY — no with-VAT row', async () => {
  const text = await formText(withVatStated());
  assert.ok(text.includes('Total Price without VAT'), 'the without-VAT total is still printed');
  assert.ok(!text.includes('Total Price with VAT'), 'the with-VAT row is gone');
  assert.ok(!text.includes('53,746'), 'the with-VAT figure appears nowhere on the form');
});

test('VAT: the .xlsx likewise carries only the without-VAT total', async () => {
  const cells = await sheetCells(withVatStated());
  const all = cells.join('\n');
  assert.ok(cells.some((c) => c === 'Total Price without VAT'), 'the without-VAT total is still there');
  assert.ok(!cells.some((c) => c === 'Total Price with VAT'), 'the with-VAT row is gone');
  assert.ok(!all.includes('53,746'), 'the with-VAT figure appears nowhere in the workbook');
});

test('VAT: withVatAmount() itself is untouched — the rule still exists, it just is not printed', () => {
  // Scoped change: only the TA form output drops it. Anything else in the app that
  // needs the with-VAT figure still gets a correct answer.
  const german = { supplierCountry: 'Germany', totalCostInclVat: 1000 } as never;
  const saudi = { supplierCountry: 'Saudi Arabia', totalCostInclVat: 1000 } as never;
  assert.equal(withVatAmount(german), 1000);
  assert.equal(withVatAmount(saudi), null);
});


// ── 2. the currency multi-select ───────────────────────────────────────────

const D = (lineItems: TaCurrencyDisplay['lineItems'], totals: TaCurrencyDisplay['totals']): TaCurrencyDisplay => ({
  lineItems,
  totals,
});

test('CURRENCY: the DEFAULT is untouched — quoted line items, three-currency totals', async () => {
  assert.deepEqual(TA_CURRENCY_DISPLAY_DEFAULT, { lineItems: ['original'], totals: ['original', 'sar', 'usd'] });

  // Omitting the option entirely must equal passing the default explicitly.
  const implicit = await formText(base);
  const explicit = await formText(base, TA_CURRENCY_DISPLAY_DEFAULT);
  const strip = (s: string) => s.replace(/\w+ \d+, \d{4}/g, 'DATE');
  assert.equal(strip(implicit), strip(explicit), 'omitting currencyDisplay == the default');

  assert.ok(implicit.includes('EUR 3.07'), 'line items stay in the quoted currency');
  assert.ok(!implicit.includes('SAR 13.15'), 'and are NOT converted by default');
  assert.ok(/EUR 36,388\.00/.test(implicit), 'total keeps the original currency');
  assert.ok(/SAR 155,810\.27/.test(implicit), 'total converts to SAR');
  assert.ok(/USD 41,548\.30/.test(implicit), 'total also shows USD');
});

// Every combination, checked at the resolver — the layer both renderers share.
test('CURRENCY: the resolver prints exactly the chosen combination, in a stable order', () => {
  const lines = (sel: TaCurrencyDisplay['lineItems']) =>
    resolveMoneyLines(3.07, 'EUR', FX, sel).map((l) => l.code);

  assert.deepEqual(lines(['original']), ['EUR']);
  assert.deepEqual(lines(['sar']), ['SAR']);
  assert.deepEqual(lines(['usd']), ['USD']);
  assert.deepEqual(lines(['original', 'sar']), ['EUR', 'SAR']);
  assert.deepEqual(lines(['original', 'usd']), ['EUR', 'USD']);
  assert.deepEqual(lines(['sar', 'usd']), ['SAR', 'USD']);
  assert.deepEqual(lines(['original', 'sar', 'usd']), ['EUR', 'SAR', 'USD']);
  // Order of selection does not change print order — it is always canonical.
  assert.deepEqual(lines(['usd', 'original', 'sar']), ['EUR', 'SAR', 'USD']);
});

test('CURRENCY: a currency is never printed twice for the same figure', () => {
  // A SAR supplier asking for Original + SAR is asking for the same number twice.
  const sar = resolveMoneyLines(10.36, 'SAR', FX, ['original', 'sar']);
  assert.deepEqual(sar.map((l) => l.code), ['SAR']);
  assert.equal(sar[0].converted, false, 'their own currency is not a conversion');

  // Likewise a USD supplier asking for Original + USD.
  const usd = resolveMoneyLines(100, 'USD', FX, ['original', 'usd']);
  assert.deepEqual(usd.map((l) => l.code), ['USD']);
});

test('CURRENCY: an empty or unavailable selection still prints a figure, never a blank', () => {
  // No selection at all falls back rather than producing an empty cell.
  assert.deepEqual(resolveMoneyLines(3.07, 'EUR', FX, []).map((l) => l.code), ['EUR']);
  // No FX and only converted currencies asked for → show what was quoted.
  assert.deepEqual(resolveMoneyLines(3.07, 'EUR', null, ['sar', 'usd']).map((l) => l.code), ['EUR']);
  // A rate-less SAR selection for a SAR quote needs no rate at all.
  assert.deepEqual(resolveMoneyLines(10.36, 'SAR', null, ['sar']).map((l) => l.code), ['SAR']);
});

test('CURRENCY: the header names exactly what is printed, for EVERY combination', async () => {
  // The header is derived from the same resolver, so this holds by construction —
  // but it is the bug that already shipped once, so it is checked end to end.
  const cases: [TaCurrencyDisplay['lineItems'], string][] = [
    [['original'], 'EUR'],
    [['sar'], 'SAR'],
    [['usd'], 'USD'],
    [['original', 'sar'], 'EUR / SAR'],
    [['sar', 'usd'], 'SAR / USD'],
    [['original', 'sar', 'usd'], 'EUR / SAR / USD'],
  ];
  // Krosaki's item 1: 2.42 EUR → SAR 10.36 → USD 2.42... so use item 2 (0.95 EUR),
  // whose three renderings are all distinct and unique on the page.
  const FIGURES: Record<string, string> = { EUR: 'EUR 0.95', SAR: 'SAR 4.07', USD: 'USD 1.08' };

  for (const [sel, expected] of cases) {
    assert.equal(headerLabel('EUR', FX, sel), expected, `header for ${sel.join('+')}`);
    const text = await formText(base, D(sel, ['sar']));
    assert.ok(
      text.includes(`Unit Price / EA (${expected})`),
      `PDF header reads "(${expected})" for ${sel.join('+')}`,
    );
    // The body must print every currency the header names, and no others.
    for (const [code, figure] of Object.entries(FIGURES)) {
      if (expected.includes(code)) {
        assert.ok(text.includes(figure), `"${figure}" is printed when the header names ${code}`);
      } else {
        assert.ok(!text.includes(figure), `"${figure}" is NOT printed when the header omits ${code}`);
      }
    }
  }
});

test('CURRENCY: choosing SAR for line items really does convert them', async () => {
  const text = await formText(base, D(['sar'], ['sar']));
  // 3.07 EUR × 4.2819 = SAR 13.15.
  assert.ok(text.includes('SAR 13.15'), 'the EUR line is restated in SAR');
  assert.ok(!text.includes('EUR 3.07'), 'the quoted EUR figure is no longer shown');
  assert.ok(text.includes('Unit Price / EA (SAR)'), 'the header agrees');
  // A conversion happened, so the rate stamp must still justify it.
  assert.ok(text.includes('SAR conversion rate'), 'the FX stamp is printed');
  assert.ok(/1 EUR = \d+\.\d{4} SAR/.test(text), 'the stamp names the rate');
  assert.ok(/rate as of .+ \((live|cached)\)/.test(text), 'and is timestamped');
});

test('CURRENCY: line items and totals are chosen independently', async () => {
  // Converted lines, single-currency totals.
  const a = await formText(base, D(['original', 'sar'], ['sar']));
  assert.ok(a.includes('EUR 3.07') && a.includes('SAR 13.15'), 'lines show both');
  assert.ok(a.includes('SAR 155,810.27'), 'totals show SAR');
  assert.ok(!/EUR 36,388\.00/.test(a), 'totals drop the original currency');
  assert.ok(!/USD 41,548\.30/.test(a), 'totals drop USD');

  // The reverse: quoted-only lines, all three on the totals.
  const b = await formText(base, D(['original'], ['original', 'sar', 'usd']));
  assert.ok(b.includes('EUR 3.07') && !b.includes('SAR 13.15'), 'lines stay as quoted');
  assert.ok(/EUR 36,388\.00/.test(b) && /SAR 155,810\.27/.test(b) && /USD 41,548\.30/.test(b), 'totals show all three');
});

test('CURRENCY: a SAR-quoting supplier reads identically under every selection', async () => {
  // AlFRAN quotes SAR 10.36. There is nothing to convert, so no selection may
  // alter that figure or duplicate it.
  for (const sel of [['original'], ['sar'], ['original', 'sar']] as TaCurrencyDisplay['lineItems'][]) {
    const text = await formText(base, D(sel, ['sar']));
    assert.ok(text.includes('SAR 10.36'), `AlFRAN's own SAR line is intact for ${sel.join('+')}`);
    assert.ok(!/SAR 10\.36\s+SAR 10\.36/.test(text), 'and is never printed twice');
  }
});

test('CURRENCY: the .xlsx honours the same selections and headers', async () => {
  const dflt = (await sheetCells(base)).join('\n');
  assert.ok(dflt.includes('EUR 2.42'), 'default: lines as quoted');
  assert.ok(!dflt.includes('SAR 10.36\nSAR'), 'default: lines not converted');
  assert.ok(dflt.includes('EUR 36,388.00') && dflt.includes('USD '), 'default: three-currency totals');

  const converted = await sheetCells(base, D(['original', 'sar'], ['sar']));
  const all = converted.join('\n');
  assert.ok(all.includes('EUR 2.42') && all.includes('SAR 10.36'), 'lines show both currencies');
  assert.ok(converted.some((c) => c.startsWith('Unit Price (EUR / SAR)')), 'xlsx header names both');
  assert.ok(!/USD [\d,]+\.\d\d/.test(all), 'no USD anywhere when it was not selected');
});

test('CURRENCY: the warning fires exactly when quoted figures leave the form', () => {
  const eur = ['EUR', 'SAR'];
  // Original is on the form → nothing is being hidden.
  assert.equal(convertsAwayFromQuoted(eur, ['original']), false);
  assert.equal(convertsAwayFromQuoted(eur, ['original', 'sar']), false);
  // The EUR supplier's own figure is gone → warn.
  assert.equal(convertsAwayFromQuoted(eur, ['sar']), true);
  assert.equal(convertsAwayFromQuoted(eur, ['usd']), true);
  // An all-SAR analysis under a SAR selection converts nothing.
  assert.equal(convertsAwayFromQuoted(['SAR'], ['sar']), false);
});
