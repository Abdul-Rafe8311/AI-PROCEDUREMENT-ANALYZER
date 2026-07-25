// The Technical Approval Form is the buyer's react-pdf LAYOUT, printed FLAT: no
// form fields, no widgets, nothing clickable. Reviewer editing happens in the
// Customize form modal before the PDF exists, so the printed values are already
// the ones they signed off.
//
// The fillable overlay is kept behind `fillable: true` and still exercised here,
// so the option stays working if a fillable build is ever wanted again. Those
// tests pin the other half of the deal: the overlay adds fields WITHOUT moving,
// resizing or dropping a single piece of printed text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { PDFCheckBox, PDFDocument, PDFName, PDFTextField } from 'pdf-lib';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { applyFxRates, assembleAnalysis } from './analysis-engine';
import type { FxRates } from './fx-rates';
import type { AnalysisResult } from './workspace-types';

// tsconfig uses jsx:"preserve", so esbuild emits the CLASSIC runtime for the
// renderer's .tsx module; Next.js supplies React automatically, node:test must not.
(globalThis as unknown as { React: typeof React }).React = React;

const fx: FxRates = { base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: 't', live: true, source: 'test' };

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for Kiln department',
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

const QTY = [10000, 2000, 1500, 300, 700];
const items = (names: string[], prices: number[]) =>
  names.map((name, i) => ({ name, quantity: QTY[i], unitPrice: prices[i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null }));
const base = (o: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: '', reference: null, prNumber: '12601612', currency: 'SAR', totalAmount: null, vatAmount: null,
  totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null, deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [], ...o,
});

// Five suppliers, so the form paginates: 1–4 on page 1, the 5th on page 2.
const suppliers: LlmSupplier[] = [
  base({
    supplierName: 'KROSAKI', reference: 'OFR26-0040', currency: 'EUR', countryOfOrigin: 'France',
    deliveryTime: '4 weeks', deliveryTerms: 'CIF JEDDAH', paymentTerms: 'CAD', warranty: '12 months',
    lineItems: items(
      ['TWS.10(60)-200(140)-45-253MA-C', 'V DIA 10MM H=70MM AISI 310 CAPPED', 'TWS.10(60)-250(140)-45-253MA-C', 'TWS.10(60)-170(80)-45-253MA-C', 'TWS.10(60)-180(100)-45-253MA-C'],
      [2.42, 0.95, 2.93, 2.24, 2.33],
    ),
  }),
  base({ supplierName: 'AL NAJIM', reference: 'WS/QM/06/26-117', supplierCountry: 'Saudi Arabia', deliveryTime: '08 - Weeks', lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: QTY[i], unitPrice: [15.5, 6, 18.5, 14.25, 15][i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null })) }),
  base({ supplierName: 'AlFRAN', reference: 'Q-ASA-NCC-260603', supplierCountry: 'KSA', deliveryTime: '65 days', lineItems: items(pr.items.map((i) => i.description), [10.36, 4.67, 12.43, 9.12, 9.53]) }),
  base({ supplierName: 'Supply Wave', reference: 'SW-2606082547', supplierCountry: 'Saudi Arabia', deliveryTime: '88 Days', lineItems: items(['Anchor Corrugated Type: TWS.10(60)-200(140)-40-310. Material GRADE - SS 310', 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', 'Anchor Corrugated Type: TWS.10(60)-250(140)-40-310. SS 310', 'Anchor Corrugated Type: TWS.10(60)-170(80)-40-310. SS 310', 'Anchor Corrugated Type: TWS.10(60)-180(100)-40-310. SS 310'], [10.4, 3, 12.1, 9, 9]) }),
  base({ supplierName: 'Refratechnik', reference: '9100147169', currency: 'EUR', countryOfOrigin: 'F.R. OF GERMANY', deliveryTime: '4-5 weeks', lineItems: items(['REVA-W.10-200', 'REVA.10-070', 'REVA-W.10-250', 'REVA-W.10-170', 'REVA-W.10-180'], [3.07, 3.21, 3.7, 4.12, 2.8]) }),
];

function freshAnalysis(): AnalysisResult {
  const qs = quotationsFromLlmSuppliers(suppliers, 'quotes.pdf', { currency: 'SAR', confidence: 0.9 });
  return applyFxRates(assembleAnalysis(qs, false, pr), fx);
}

async function renderOnly(): Promise<Uint8Array> {
  const { generateApprovalFormPdf } = await import('./approval-form-pdf');
  return new Uint8Array(await (await generateApprovalFormPdf(freshAnalysis(), { fx })).arrayBuffer());
}
/** What the app ships: the flat, printable form. */
async function renderFlat(): Promise<Uint8Array> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  return new Uint8Array(await (await generateApprovalFormPdf(freshAnalysis(), { fx })).arrayBuffer());
}
/** The opt-in fillable build. */
async function renderWithFields(): Promise<Uint8Array> {
  const { generateApprovalFormPdf } = await import('./approval-form');
  return new Uint8Array(
    await (await generateApprovalFormPdf(freshAnalysis(), { fx, fillable: true })).arrayBuffer(),
  );
}

/** Every printed text run, as "page|x|y|width|text" — the layout's fingerprint. */
async function textFingerprint(bytes: Uint8Array): Promise<string[]> {
  const { measureRuns } = await import('./approval-form-overlay');
  const runs = await measureRuns(Uint8Array.from(bytes));
  return runs.map((r) => `${r.page}|${r.x.toFixed(2)}|${r.y.toFixed(2)}|${r.w.toFixed(2)}|${r.str}`);
}

test('TA FORM: the react-pdf reference layout — 2 pages, one supplier block each', async () => {
  const doc = await PDFDocument.load(await renderFlat());
  assert.equal(doc.getPageCount(), 2, 'the reference form is two pages for five suppliers');
  const fp = await textFingerprint(await renderFlat());
  const page1 = fp.filter((f) => f.startsWith('0|')).join('\n');
  const page2 = fp.filter((f) => f.startsWith('1|')).join('\n');
  assert.match(page1, /Suppliers 1[–-]4 of 5/, 'page 1 carries suppliers 1-4');
  assert.match(page2, /Suppliers 5[–-]5 of 5/, 'page 2 carries supplier 5');
  // The reference header and footer, verbatim.
  assert.match(page1, /TA Date:/);
  assert.match(page1, /PR Description:/);
  assert.match(page1, /SAR conversion rate:/);
  assert.match(page1, /rate as of/);
  assert.match(page1, /Generated by AI Procurement Copilot/);
  assert.match(page1, /Auto-filled from extracted data\. Blank fields are for manual completion\./);
  // Term rows sit with their own supplier group, on both pages.
  for (const label of ['Total Price without VAT', 'Payment Terms', 'Delivery Time', 'Delivery Terms', 'Country of Origin', 'Warranty', 'Technical Comments']) {
    assert.ok(page1.includes(label), `page 1 has "${label}"`);
    assert.ok(page2.includes(label), `page 2 has "${label}"`);
  }
  // Signature blocks + Final Recommendation on the last page only.
  assert.match(page2, /Final Recommendation:/);
  assert.match(page2, /Signature:/);
  assert.ok(!page1.includes('Final Recommendation:'), 'Final Recommendation is on the last page only');
});

test('TA FORM: the overlay adds fields WITHOUT moving a single piece of printed text', async () => {
  const before = await textFingerprint(await renderOnly());
  const after = await textFingerprint(await renderWithFields());
  assert.deepEqual(after, before, 'every printed run keeps its exact position, width and content');
});

test('TA FORM: the output is a real AcroForm — editable, uniquely named, pre-filled', async () => {
  const doc = await PDFDocument.load(await renderWithFields());
  const fields = doc.getForm().getFields();
  const names = fields.map((f) => f.getName());
  assert.ok(fields.length > 150, `expected the value cells to be fields, got ${fields.length}`);
  assert.equal(new Set(names).size, names.length, 'field names are unique');
  assert.equal(fields.filter((f) => f instanceof PDFCheckBox).length, 12, 'six Approved + six Denied checkboxes');
  for (const f of fields) assert.equal(f.isReadOnly(), false, `${f.getName()} is editable`);

  // Names are page-scoped and stable, and cover both supplier blocks.
  assert.ok(names.some((n) => n.startsWith('p1.cell_price_sar.')), 'page 1 unit prices are fields');
  assert.ok(names.some((n) => n.startsWith('p2.cell_price_sar.')), 'page 2 unit prices are fields');
  assert.ok(names.some((n) => n.startsWith('p1.cell_qty.')) && names.some((n) => n.startsWith('p2.cell_qty.')));
  assert.ok(names.some((n) => n.startsWith('p1.term.')) && names.some((n) => n.startsWith('p2.term.')));
  assert.ok(names.some((n) => n === 'p2.final_recommendation'), 'Final Recommendation is editable');
  assert.equal(names.filter((n) => n.endsWith('signature.0') || /\.signature\.\d+$/.test(n)).length, 6, 'six Signature inputs');
  assert.equal(names.filter((n) => /\.sig_date\.\d+$/.test(n)).length, 6, 'six Date inputs');

  // Pre-filled from the extracted data.
  const val = (p: string) => (fields.find((f) => f.getName().startsWith(p)) as PDFTextField | undefined)?.getText() ?? '';
  assert.match(val('p1.cell_price_sar.'), /^SAR /, `unit price pre-filled: ${val('p1.cell_price_sar.')}`);
  assert.match(val('p1.cell_qty.'), /\d/, 'quantity pre-filled');
  assert.equal(val('p1.pr_number'), '12601612');
  // Signature / Date start blank for the reviewer.
  for (const f of fields.filter((x) => /\.(signature|sig_date)\.\d+$/.test(x.getName())) as PDFTextField[]) {
    assert.equal((f.getText() ?? '').trim(), '', `${f.getName()} blank`);
  }
});

test('TA FORM: NeedAppearances is set so viewers render the values at the printed size', async () => {
  const doc = await PDFDocument.load(await renderWithFields());
  const acro = doc.getForm().acroForm;
  assert.equal(String(acro.dict.get(PDFName.of('NeedAppearances'))), 'true');
  assert.match(String(acro.dict.get(PDFName.of('DA'))), /Helvetica 6\.5 Tf/, 'default appearance matches the body size');
});

test('TA FORM: Krosaki row 2 shows its OWN quoted line, never "Not Quoted"', async () => {
  const fp = (await textFingerprint(await renderWithFields())).join('\n');
  assert.ok(fp.includes('V DIA 10MM H=70MM'), 'Krosaki row 2 prints its quoted V-anchor');
  assert.ok(!/Not Quoted/.test(fp), 'no supplier row is marked Not Quoted for this analysis');
});

test('TA FORM: no green best/lowest-value highlighting anywhere', async () => {
  const bytes = await renderWithFields();
  const { inflateSync } = await import('node:zlib');
  const doc = await PDFDocument.load(bytes);
  const colours: [number, number, number][] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const raw = obj as unknown as { contents?: Uint8Array; dict?: { get(n: PDFName): unknown } };
    if (!raw?.contents) continue;
    let buf = Buffer.from(raw.contents);
    if (String(raw.dict?.get(PDFName.of('Filter')) ?? '').includes('Flate')) {
      try { buf = Buffer.from(inflateSync(buf)); } catch { continue; }
    }
    for (const m of buf.toString('latin1').matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(?:rg|RG|scn|SCN)\b/g)) {
      colours.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
  }
  assert.ok(colours.length > 20, `content streams were scanned (found ${colours.length} colour ops)`);
  const green = colours.filter(([r, g, b]) => g > r + 0.08 && g > b + 0.08).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
  assert.deepEqual(green, [], `green fills found: ${green.join(', ')}`);
});

// ── the shipped output is FLAT ──────────────────────────────────────────────
// Every value the reviewer could edit is settled in the Customize form modal, so
// the PDF carries no form apparatus at all: no AcroForm, no widgets, nothing a
// viewer will outline in blue or let anyone type into.

test('TA FLAT: the shipped PDF has NO AcroForm and NO annotations of any kind', async () => {
  const doc = await PDFDocument.load(await renderFlat());
  // What `pdfinfo` reads for "Form:" — absent means "none".
  assert.equal(doc.catalog.get(PDFName.of('AcroForm')), undefined, 'no AcroForm in the catalog');
  assert.equal(doc.getForm().getFields().length, 0, 'no form fields');
  for (const [i, page] of doc.getPages().entries()) {
    const annots = page.node.Annots();
    assert.ok(!annots || annots.size() === 0, `page ${i + 1} carries no annotations/widgets`);
  }
  assert.equal(doc.getPageCount(), 2);
});

test('TA FLAT: dropping the fields does not move a single piece of printed text', async () => {
  const flat = await textFingerprint(await renderFlat());
  const plain = await textFingerprint(await renderOnly());
  assert.deepEqual(flat, plain, 'the flat form is exactly the rendered layout');
  // …and the same text the fillable build printed underneath its widgets.
  const fillable = await textFingerprint(await renderWithFields());
  assert.deepEqual(flat, fillable, 'position, size and content are unchanged either way');
});

test('TA FLAT: signature blocks are printed elements, ready to sign by hand', async () => {
  const fp = (await textFingerprint(await renderFlat())).join('\n');
  for (const label of ['Approved', 'Denied', 'Signature:', 'Date:']) {
    assert.ok(fp.includes(label), `"${label}" is printed on the form`);
  }
  assert.match(fp, /Final Recommendation:/, 'Final Recommendation is printed, unchanged');
});

test('TA FLAT: the printed values are the reviewer’s, not the raw extraction', async () => {
  const { generateApprovalFormPdf } = await import('./approval-form');
  const { buildComparisonModel } = await import('./pr-comparison');
  const { buildItemReview, cellKey } = await import('./item-review');

  const analysis = freshAnalysis();
  const model = buildComparisonModel(analysis.quotations, pr, analysis.prMatch, { prOnly: true, fx });
  const review = buildItemReview(model, analysis.quotations);
  const krosakiId = analysis.quotations.find((q) => q.supplierName.startsWith('KROSAKI'))!.id;
  const key = cellKey('i1', krosakiId);
  assert.equal(review[key].qty.original, '10,000');

  const edited = { ...review, [key]: { ...review[key], qty: { ...review[key].qty, edited: '4,321' } } };
  const bytes = new Uint8Array(
    await (await generateApprovalFormPdf(analysis, { fx, itemReview: edited })).arrayBuffer(),
  );
  const { measureRuns } = await import('./approval-form-overlay');
  const text = (await measureRuns(Uint8Array.from(bytes))).map((r) => r.str).join('|');
  assert.ok(text.includes('4,321'), 'the reviewer’s quantity is what gets printed');
  // The untouched suppliers still print their extracted quantity.
  assert.ok(text.includes('10,000'), 'untouched cells fall back to the extracted value');
});
