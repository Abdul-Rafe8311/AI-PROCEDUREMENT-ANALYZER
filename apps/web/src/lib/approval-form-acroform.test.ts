// The Technical Approval Form is a FILLABLE PDF (AcroForm): every value is a real
// interactive form field, pre-filled and editable, with the company's six
// signature blocks (Approved/Denied checkboxes + editable Signature/Date) and the
// live FX stamp. We generate the PDF, reload it with pdf-lib and inspect the actual
// form fields — proving they exist and carry the extracted values (not flat text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from './extraction-server';
import { assembleAnalysis } from './analysis-engine';
import { generateApprovalFormPdf } from './approval-form-acroform';
import type { FxRates } from './fx-rates';
import type { AnalysisResult } from './workspace-types';

const fx: FxRates = {
  base: 'USD',
  rates: { USD: 1, SAR: 3.75, EUR: 0.92 },
  asOf: '2026-07-16T00:00:00.000Z',
  live: true,
  source: 'test',
};

const pr = purchaseRequisitionFromLlm(
  {
    requestNo: '12601612',
    description: 'Anchors for production department.',
    items: [
      { itemCode: '404602703004', description: 'Anchor, Corrugated, TWS.10(60)-200(140)-40-253, Grade 253 MA', quantity: 10000, unit: 'EA' },
      { itemCode: '404602701007', description: 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', quantity: 2000, unit: 'EA' },
    ],
  },
  'pr.pdf',
)!;

const krosaki: LlmSupplier = {
  supplierName: 'KROSAKI', reference: 'OFR26-0040', prNumber: '12601612', currency: 'EUR',
  totalAmount: 26100, vatAmount: null, totalWithoutVat: 26100, totalsByCurrency: null,
  deliveryTime: '4 weeks after official order', deliveryTerms: 'CIF JEDDAH',
  countryOfOrigin: 'France', paymentTerms: 'CAD', warranty: '12 months', validUntil: null,
  lineItems: [
    { name: 'TWS.10(60)-200', quantity: 10000, unitPrice: 2.42, totalPrice: 24200, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'V DIA 10MM H=70MM AISI 310 CAPPED', quantity: 2000, unitPrice: 0.95, totalPrice: 1900, category: 'product', uom: 'EA', availableInDays: null },
    { name: 'TRANSPORT PRICE CIF JEDDAH', quantity: 1, unitPrice: null, totalPrice: 3590, category: 'freight', uom: null, availableInDays: null },
  ],
};
const alnajim: LlmSupplier = {
  supplierName: 'AL NAJIM', reference: 'WS/QM/06/26-117', prNumber: '12601612', currency: 'SAR',
  totalAmount: 172000, vatAmount: null, totalWithoutVat: 172000, totalsByCurrency: null,
  deliveryTime: '08 - Weeks', deliveryTerms: 'by Naqel',
  countryOfOrigin: 'Saudi Arabia', paymentTerms: '100% Advance', warranty: null, validUntil: null,
  lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: it.quantity!, unitPrice: [16, 6][i], totalPrice: null, category: 'product', uom: 'EA', availableInDays: null })),
};

const quotations = quotationsFromLlmSuppliers([krosaki, alnajim], 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
const analysis: AnalysisResult = assembleAnalysis(quotations, false, pr);

async function generateAndLoad(a: AnalysisResult) {
  const blob = await generateApprovalFormPdf(a, { fx });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  return { bytes, doc, form: doc.getForm() };
}

test('TA ACROFORM: output is a real AcroForm with interactive text fields + checkboxes (not flat text)', async () => {
  const { form } = await generateAndLoad(analysis);
  const fields = form.getFields();
  const textFields = fields.filter((f) => f instanceof PDFTextField);
  const checkBoxes = fields.filter((f) => f instanceof PDFCheckBox);
  assert.ok(textFields.length >= 30, `expected many editable text fields, got ${textFields.length}`);
  assert.ok(checkBoxes.length >= 12, `expected Approved/Denied checkboxes, got ${checkBoxes.length}`);
});

test('TA ACROFORM: all SIX company signature blocks — Approved/Denied checkboxes + editable Signature/Date', async () => {
  const { form } = await generateAndLoad(analysis);
  const names = form.getFields().map((f) => f.getName());
  const count = (p: string) => names.filter((n) => n.startsWith(p)).length;
  assert.equal(count('approved.'), 6, 'six Approved checkboxes');
  assert.equal(count('denied.'), 6, 'six Denied checkboxes');
  assert.equal(count('signature.'), 6, 'six editable Signature fields');
  assert.equal(count('sig_date.'), 6, 'six editable Date fields');
});

test('TA ACROFORM: fields are PRE-FILLED with the extracted/generated values (editable defaults)', async () => {
  const { form } = await generateAndLoad(analysis);
  const fields = form.getFields();
  const val = (prefix: string) => {
    const f = fields.find((x) => x.getName().startsWith(prefix)) as PDFTextField | undefined;
    return f?.getText() ?? '';
  };
  assert.ok(val('pr_number.').includes('12601612'), `PR # pre-filled: ${val('pr_number.')}`);
  assert.ok(val('pr_description.').includes('Anchors'), `PR description pre-filled: ${val('pr_description.')}`);
  assert.ok(val('sup_name.').length > 0, 'supplier name pre-filled');
  // Unit price is normalized to SAR + USD at the live rate (dual currency).
  assert.match(val('cell_price.'), /SAR .* \/ USD /, `dual-currency unit price: ${val('cell_price.')}`);
  assert.ok(val('term.Warranty.').includes('12 months'), `warranty pre-filled: ${val('term.Warranty.')}`);
  // Technical Comment is AI-suggested and pre-filled (editable), never asserted silently.
  assert.match(val('tech_comment.'), /AI SUGGESTED/, `AI-suggested tech comment: ${val('tech_comment.')}`);
});

test('TA ACROFORM: live FX stamp is rendered on the page', async () => {
  const { bytes } = await generateAndLoad(analysis);
  const proxy = await getDocumentProxy(bytes);
  const { text } = await extractText(proxy, { mergePages: true });
  const merged = String(text);
  assert.match(merged, /SAR/, 'SAR mentioned');
  assert.match(merged, /rate as of/, 'FX rate stamp present');
});

test('TA ACROFORM: Signature/Date fields start BLANK for the team to complete by hand', async () => {
  const { form } = await generateAndLoad(analysis);
  const fields = form.getFields();
  const sigs = fields.filter((f) => f.getName().startsWith('signature.')) as PDFTextField[];
  const dates = fields.filter((f) => f.getName().startsWith('sig_date.')) as PDFTextField[];
  for (const f of [...sigs, ...dates]) assert.equal((f.getText() ?? '').trim(), '', `${f.getName()} blank`);
});
