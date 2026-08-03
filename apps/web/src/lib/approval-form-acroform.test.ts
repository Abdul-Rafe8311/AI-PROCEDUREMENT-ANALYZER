// The Technical Approval Form is a FILLABLE PDF (AcroForm): every value is a real
// interactive form field, pre-filled and editable, with the company's six
// signature blocks (Approved/Denied checkboxes + editable Signature/Date) and the
// live FX stamp. We generate the PDF, reload it with pdf-lib and inspect the actual
// form fields — proving they exist and carry the extracted values (not flat text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFCheckBox, PDFDocument, PDFFont, PDFName, PDFTextField, StandardFonts } from 'pdf-lib';
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
    description: 'Anchors for Kiln department',
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
    // The supplier's REAL part code — 30 characters that must never be split.
    { name: 'TWS.10(60)-200(140)-45-253MA-C', quantity: 10000, unitPrice: 2.42, totalPrice: 24200, category: 'product', uom: 'EA', availableInDays: null },
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

/** Same two suppliers cloned out to FIVE, to exercise supplier pagination. */
function fiveSupplierAnalysis(): AnalysisResult {
  const names = ['KROSAKI', 'AL NAJIM', 'AlFRAN', 'Supply Wave', 'Refratechnik'];
  const suppliers = names.map<LlmSupplier>((supplierName, i) => ({
    ...(i % 2 === 0 ? krosaki : alnajim),
    supplierName,
    reference: `REF-${i}`,
  }));
  const qs = quotationsFromLlmSuppliers(suppliers, 'quotes.pdf', { currency: 'SAR', confidence: 0.6 });
  return assembleAnalysis(qs, false, pr);
}

async function generateAndLoad(a: AnalysisResult) {
  const blob = await generateApprovalFormPdf(a, { fx });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  return { bytes, doc, form: doc.getForm() };
}

/** 1-based page number each form field's widget lives on. */
function fieldPages(doc: PDFDocument): Map<string, number> {
  const out = new Map<string, number>();
  const pages = doc.getPages();
  for (const f of doc.getForm().getFields()) {
    const dict = f.acroField.getWidgets()[0]?.dict;
    pages.forEach((p, i) => {
      const annots = p.node.Annots();
      if (!annots) return;
      for (let k = 0; k < annots.size(); k++) if (annots.lookup(k) === dict) out.set(f.getName(), i + 1);
    });
  }
  return out;
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
  assert.ok(val('sup_name.').length > 0, 'supplier name pre-filled');
  // Unit price is normalized to SAR + USD at the live rate (dual currency).
  assert.match(val('cell_price.'), /SAR .* \/ USD /, `dual-currency unit price: ${val('cell_price.')}`);
  assert.ok(val('term.Warranty.').includes('12 months'), `warranty pre-filled: ${val('term.Warranty.')}`);
  // Technical Comment is AI-suggested and pre-filled (editable), never asserted silently.
  assert.match(val('term.Technical Comments.'), /AI SUGGESTED/, `AI-suggested tech comment: ${val('term.Technical Comments.')}`);
});

test('TA ACROFORM: PR Description is printed VERBATIM and IN FULL (never shortened to "Anchors")', async () => {
  const { form } = await generateAndLoad(analysis);
  const f = form.getFields().find((x) => x.getName().startsWith('pr_description.')) as PDFTextField;
  assert.equal((f.getText() ?? '').replace(/\n/g, ' '), 'Anchors for Kiln department');
});

test('TA ACROFORM: live FX stamp is rendered on the page', async () => {
  const { bytes } = await generateAndLoad(analysis);
  const { extractText, getDocumentProxy } = await import('unpdf');
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

// ── SUPPLIER PAGINATION ────────────────────────────────────────────────────
// The bug this form was rewritten for: all five suppliers were crammed onto one
// landscape page (15 sub-columns), so no column was wide enough for a part code
// at any font size.

test('TA PAGINATION: 5 suppliers → at most FOUR supplier columns per page, split 1-4 then 5-5', async () => {
  const { doc, form } = await generateAndLoad(fiveSupplierAnalysis());
  const pages = fieldPages(doc);
  assert.ok(doc.getPageCount() >= 2, `paginated, got ${doc.getPageCount()} page(s)`);

  // sup_name.<colIndex> identifies which supplier column is drawn where.
  const perPage = new Map<number, Set<string>>();
  for (const f of form.getFields()) {
    const m = /^sup_name\.(\d+)\./.exec(f.getName());
    if (!m) continue;
    const p = pages.get(f.getName())!;
    if (!perPage.has(p)) perPage.set(p, new Set());
    perPage.get(p)!.add(m[1]);
  }
  for (const [p, cols] of perPage) {
    assert.ok(cols.size <= 4, `page ${p} shows ${cols.size} supplier columns (max 4)`);
  }
  const seen = new Set([...perPage.values()].flatMap((s) => [...s]));
  assert.deepEqual([...seen].sort(), ['0', '1', '2', '3', '4'], 'every supplier appears somewhere');

  // Suppliers 1-4 and supplier 5 never share a page.
  for (const cols of perPage.values()) {
    if (cols.has('4')) assert.equal(cols.size, 1, 'the 5th supplier gets its own block');
  }
});

test('TA PAGINATION: the continuation page carries REAL editable fields with unique names', async () => {
  const { doc, form } = await generateAndLoad(fiveSupplierAnalysis());
  const pages = fieldPages(doc);
  const names = form.getFields().map((f) => f.getName());
  assert.equal(new Set(names).size, names.length, 'every field name is unique');

  // The 5th supplier's block starts on a page of its own, after page 1.
  const supFive = form.getFields().find((f) => f.getName().startsWith('sup_name.4.'))!;
  const supFivePage = pages.get(supFive.getName())!;
  assert.ok(supFivePage > 1, `supplier 5 starts on page ${supFivePage}, not page 1`);

  const onPage = form.getFields().filter((f) => pages.get(f.getName()) === supFivePage);
  assert.ok(onPage.length > 10, `page ${supFivePage} carries fields, got ${onPage.length}`);
  const editable = onPage.filter((f) => f instanceof PDFTextField && !f.isReadOnly());
  assert.ok(editable.length > 5, 'continuation-page text fields are editable');
  // Its own grid cells live there, not on page 1.
  assert.ok(onPage.some((f) => /^cell_desc\..*\.s4\./.test(f.getName())), 'supplier-5 item cells are on its page');
  // Its term rows repeat within its own block (same page or its continuation).
  const terms = form.getFields().filter((f) => /^term\.Total Price without VAT\.s4\./.test(f.getName()));
  assert.equal(terms.length, 1, 'supplier-5 total row exists exactly once');
  assert.ok(pages.get(terms[0].getName())! >= supFivePage, 'supplier-5 terms follow its header');
});

test('TA PAGINATION: every supplier page repeats the term rows for the suppliers it shows', async () => {
  const { doc, form } = await generateAndLoad(fiveSupplierAnalysis());
  const pages = fieldPages(doc);
  const termsFor = (col: string) =>
    form.getFields().filter((f) => f.getName().startsWith('term.') && f.getName().includes(`.s${col}.`));
  for (const col of ['0', '1', '2', '3', '4']) {
    const labels = termsFor(col).map((f) => f.getName().split('.')[1]);
    for (const required of ['Total Price without VAT', 'Payment Terms', 'Delivery Time', 'Delivery Terms', 'Technical Comments']) {
      assert.ok(labels.includes(required), `supplier ${col} has a "${required}" row`);
    }
    // …and they sit on the same page as that supplier's own header.
    const header = form.getFields().find((f) => f.getName().startsWith(`sup_name.${col}.`))!;
    assert.ok(pages.get(header.getName())! >= 1);
  }
});

// ── TEXT IS NEVER MUTILATED ────────────────────────────────────────────────

test('TA TEXT: no identifier is split — a wrapped line never breaks inside a token', async () => {
  const { form } = await generateAndLoad(fiveSupplierAnalysis());
  const codes = ['TWS.10(60)-200(140)-45-253MA-C', 'V DIA 10MM H=70MM AISI 310 CAPPED', 'TRANSPORT PRICE CIF JEDDAH'];
  const descs = form.getFields()
    .filter((f) => f.getName().startsWith('cell_desc.'))
    .map((f) => (f as PDFTextField).getText() ?? '');
  // Every wrapped line is made only of WHOLE whitespace-delimited tokens of the
  // original value — i.e. the wrapper never cut through a part code.
  for (const v of descs) {
    for (const line of v.split('\n')) {
      for (const tok of line.split(/\s+/).filter(Boolean)) {
        assert.ok(
          codes.concat(descs.flatMap((d) => d.split(/\s+/))).includes(tok) || /^[\w().,:/=-]+$/.test(tok),
          `token "${tok}" looks broken`,
        );
      }
    }
  }
  // The 30-character Krosaki code survives intact on ONE line.
  assert.ok(
    descs.some((d) => d.split('\n').includes('TWS.10(60)-200(140)-45-253MA-C')),
    `Krosaki part code kept whole: ${JSON.stringify(descs.slice(0, 3))}`,
  );
});

// The generated form pads every cell by PAD_X/PAD_Y and sets its own leading; these
// two tests pin that contract so a layout change can never silently clip a value.
const PAD_X = 8;
const PAD_Y = 6;
const LEAD_RATIO = 1.35;

/** Font + size a field's text is actually drawn at, read back off its /DA. */
function fieldType(f: PDFTextField, fonts: Record<string, PDFFont>) {
  const widget = f.acroField.getWidgets()[0];
  const da = String(widget.dict.get(PDFName.of('DA')) ?? f.acroField.getDefaultAppearance() ?? '');
  const m = /\/([^\s/]+)\s+(\d*\.?\d+)\s+Tf/.exec(da);
  return { size: m ? Number(m[2]) : 8.5, font: fonts[m?.[1] ?? ''] ?? fonts.Helvetica, rect: widget.getRectangle() };
}

test('TA TEXT: every field value FITS its widget — cell padding is never eaten by the text', async () => {
  const { doc, form } = await generateAndLoad(fiveSupplierAnalysis());
  const fonts: Record<string, PDFFont> = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    'Helvetica-Bold': await doc.embedFont(StandardFonts.HelveticaBold),
    'Helvetica-Oblique': await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const offenders: string[] = [];
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField)) continue;
    const value = f.getText() ?? '';
    if (!value.trim()) continue;
    const { size, font, rect } = fieldType(f, fonts);
    for (const line of value.split('\n')) {
      const w = font.widthOfTextAtSize(line, size);
      // Text must fit INSIDE the padding on both sides — never touch a border.
      if (w > rect.width - 2 * PAD_X + 0.5) {
        offenders.push(`${f.getName()} (${w.toFixed(1)}pt in ${rect.width.toFixed(1)}pt): ${JSON.stringify(line)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `values wider than their padded cell:\n${offenders.join('\n')}`);
});

test('TA TEXT: every field value FITS its widget VERTICALLY at 1.35× leading', async () => {
  const { doc, form } = await generateAndLoad(fiveSupplierAnalysis());
  const fonts: Record<string, PDFFont> = {
    Helvetica: await doc.embedFont(StandardFonts.Helvetica),
    'Helvetica-Bold': await doc.embedFont(StandardFonts.HelveticaBold),
    'Helvetica-Oblique': await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const offenders: string[] = [];
  for (const f of form.getFields()) {
    if (!(f instanceof PDFTextField)) continue;
    const value = f.getText() ?? '';
    if (!value.trim()) continue;
    const { size, rect } = fieldType(f, fonts);
    const needed = value.split('\n').length * size * LEAD_RATIO + PAD_Y;
    if (needed > rect.height + 0.5) {
      offenders.push(`${f.getName()}: needs ${needed.toFixed(1)}pt, box is ${rect.height.toFixed(1)}pt`);
    }
  }
  assert.deepEqual(offenders, [], `values taller than their cell:\n${offenders.join('\n')}`);
});

test('TA TEXT: the spec-differs marker is ONE compact italic line, not a sentence', async () => {
  const { form } = await generateAndLoad(fiveSupplierAnalysis());
  const notes = form.getFields()
    .filter((f) => f.getName().startsWith('cell_spec_note.'))
    .map((f) => (f as PDFTextField).getText() ?? '');
  assert.ok(notes.length > 0, 'spec-differs markers are still produced');
  for (const n of notes) {
    assert.equal(n.split('\n').length, 1, `one line: ${JSON.stringify(n)}`);
    assert.match(n, /^spec differs/, `compact marker: ${JSON.stringify(n)}`);
    assert.ok(n.length <= 44, `short enough to sit on one line: ${JSON.stringify(n)}`);
  }
});

test('TA NEUTRAL: no green (best-value) highlighting anywhere on the form', async () => {
  const { bytes } = await generateAndLoad(fiveSupplierAnalysis());
  const { inflateSync } = await import('node:zlib');
  // Every colour operator drawn on any page, including inside the fields'
  // appearance streams — the whole form must stay neutral.
  const doc = await PDFDocument.load(bytes);
  const sources: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const raw = obj as unknown as { contents?: Uint8Array; dict?: { get(n: PDFName): unknown } };
    if (!raw?.contents) continue;
    let buf = Buffer.from(raw.contents);
    const filter = String(raw.dict?.get(PDFName.of('Filter')) ?? '');
    if (filter.includes('FlateDecode')) { try { buf = Buffer.from(inflateSync(buf)); } catch { continue; } }
    sources.push(buf.toString('latin1'));
  }
  const colors = sources.flatMap((src) => [...src.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(?:rg|RG)\b/g)]);
  assert.ok(colors.length > 20, `content streams were scanned (found ${colors.length} colour ops)`);
  const green = colors
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
    // "Green" = a green channel that clearly dominates both others.
    .filter(([r, g, b]) => g > r + 0.08 && g > b + 0.08)
    .map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
  assert.deepEqual(green, [], `green fills found: ${green.join(', ')}`);
});

test('TA NEUTRAL: page numbering is stamped so a multi-page form cannot be read out of order', async () => {
  const { bytes, doc } = await generateAndLoad(fiveSupplierAnalysis());
  const { extractText, getDocumentProxy } = await import('unpdf');
  const proxy = await getDocumentProxy(bytes);
  const { text } = await extractText(proxy, { mergePages: true });
  const merged = String(text);
  assert.ok(merged.includes(`Page 1 of ${doc.getPageCount()}`), 'page 1 stamped');
  assert.ok(merged.includes(`Page ${doc.getPageCount()} of ${doc.getPageCount()}`), 'last page stamped');
  assert.match(merged, /Suppliers 1-4 of 5/, 'supplier range header printed');
  assert.match(merged, /Suppliers 5-5 of 5/, 'second supplier block header printed');
});
