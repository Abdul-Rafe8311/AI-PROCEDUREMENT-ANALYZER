/*
 * Dev tool: generate the Technical Approval Form FRESH from the real PR 12601612
 * data set (5 suppliers, their real quoted part codes) and print an inspection
 * report — page count, which suppliers land on which page, the rendered value of
 * every field, and which page each field lives on.
 *
 * Nothing is cached or restored: the analysis is rebuilt from scratch through the
 * same pipeline the app uses (extraction mapping → PR matching → assembleAnalysis
 * → applyFxRates → generateApprovalFormPdf).
 *
 *   npx tsx scripts/ta-form-preview.ts [out.pdf]
 */

import { writeFileSync } from 'node:fs';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { purchaseRequisitionFromLlm, quotationsFromLlmSuppliers, type LlmSupplier } from '../src/lib/extraction-server';
import { applyFxRates, assembleAnalysis } from '../src/lib/analysis-engine';
import { generateApprovalFormPdf } from '../src/lib/approval-form-acroform';
import type { FxRates } from '../src/lib/fx-rates';

const OUT = process.argv[2] ?? '/tmp/ta-form.pdf';

// Fixed rate so the run is deterministic (the app uses the live feed).
const FX: FxRates = { base: 'USD', rates: { USD: 1, SAR: 3.7501, EUR: 0.8758 }, asOf: '2026-07-25T00:00:00.000Z', live: true, source: 'preview' };

// ── The company requisition, as read off PR 12601612 ──
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
  'requisition-12601612.pdf',
)!;

const QTY = [10000, 2000, 1500, 300, 700];
const items = (names: string[], prices: number[]) =>
  names.map((name, i) => ({ name, quantity: QTY[i], unitPrice: prices[i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null }));
const freight = (name: string, amount: number) =>
  ({ name, quantity: 1, unitPrice: null, totalPrice: amount, category: 'freight' as const, uom: null, availableInDays: null });
const base = (o: Partial<LlmSupplier>): LlmSupplier => ({
  supplierName: '', reference: null, prNumber: '12601612', currency: 'SAR', totalAmount: null, vatAmount: null,
  totalWithoutVat: null, totalsByCurrency: null, deliveryTime: null, deliveryTerms: null, countryOfOrigin: null,
  supplierCountry: null, paymentTerms: null, warranty: null, validUntil: null, lineItems: [], ...o,
});

const krosaki = base({
  supplierName: 'KROSAKI', reference: 'OFR26-0040', currency: 'EUR', countryOfOrigin: 'Country of Origin: France',
  deliveryTime: '4 weeks after official order', deliveryTerms: 'CIF JEDDAH', paymentTerms: 'CAD', warranty: '12 months',
  lineItems: [
    ...items(
      ['TWS.10(60)-200(140)-45-253MA-C', 'V DIA 10MM H=70MM AISI 310 CAPPED', 'TWS.10(60)-250(140)-45-253MA-C', 'TWS.10(60)-170(80)-45-253MA-C', 'TWS.10(60)-180(100)-45-253MA-C'],
      [2.42, 0.95, 2.93, 2.24, 2.33],
    ),
    freight('TRANSPORT PRICE CIF JEDDAH', 3590),
  ],
});
const alnajim = base({
  supplierName: 'AL NAJIM', reference: 'WS/QM/06/26-117', supplierCountry: 'Saudi Arabia',
  deliveryTime: '08 - Weeks', deliveryTerms: 'by Naqel', paymentTerms: '100% Advance',
  lineItems: pr.items.map((it, i) => ({ name: it.description, quantity: QTY[i], unitPrice: [15.5, 6, 18.5, 14.25, 15][i], totalPrice: null, category: 'product' as const, uom: 'EA', availableInDays: null })),
});
const alfran = base({
  supplierName: 'AlFRAN', reference: 'Q-ASA-NCC-260603', supplierCountry: 'KSA',
  deliveryTime: '65 days after order confirmation', deliveryTerms: 'DDP', paymentTerms: '30 DAYS CREDIT', warranty: '24 months',
  lineItems: [
    ...items(
      ['Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA. With Plastic Caps.', 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM. - DRG NO.NCC-KL-42', 'Anchor, Corrugated, Type. TWS.10(60)-250(140)-40-253, Material Grade 253 MA. With Plastic Caps.', 'Anchor, Corrugated, Type. TWS.10(60)-170(80)-40-253, Material Grade 253 MA. With Plastic Caps.', 'Anchor, Corrugated, Type. TWS.10(60)-180(100)-40-253, Material Grade 253 MA. With Plastic Caps.'],
      [10.36, 4.67, 12.43, 9.12, 9.53],
    ),
    freight('Transportation', 7900),
  ],
});
const supplyWave = base({
  supplierName: 'Supply Wave', reference: 'SW-2606082547', supplierCountry: 'Saudi Arabia',
  deliveryTime: '88 Days', deliveryTerms: 'EX WORKS', paymentTerms: '30 Days',
  lineItems: items(
    ['Anchor Corrugated Type: TWS.10(60)-200(140)-40-310. Material GRADE - SS 310', 'SS 310 ANCHOR TYPE: V, SIZE: 10 X 70 MM.', 'Anchor Corrugated Type: TWS.10(60)-250(140)-40-310. Material GRADE - SS 310', 'Anchor Corrugated Type: TWS.10(60)-170(80)-40-310. Material GRADE - SS 310', 'Anchor Corrugated Type: TWS.10(60)-180(100)-40-310. Material GRADE - SS 310'],
    [10.4, 3, 12.1, 9, 9],
  ),
});
const refratechnik = base({
  supplierName: 'Refratechnik', reference: '9100147169', currency: 'EUR', countryOfOrigin: 'F.R. OF GERMANY',
  deliveryTime: '4-5 weeks', deliveryTerms: 'FOB', paymentTerms: 'Cash against documents',
  lineItems: [
    ...items(['REVA-W.10-200', 'REVA.10-070', 'REVA-W.10-250', 'REVA-W.10-170', 'REVA-W.10-180'], [3.07, 3.21, 3.7, 4.12, 2.8]),
    freight('Freight and FOB charges', 870),
  ],
});

async function main() {
  const quotations = quotationsFromLlmSuppliers(
    [krosaki, alnajim, alfran, supplyWave, refratechnik],
    'quotations-12601612.pdf',
    { currency: 'SAR', confidence: 0.9 },
  );
  const analysis = applyFxRates(assembleAnalysis(quotations, false, pr), FX);

  console.log('── FRESH analysis ─────────────────────────────────────────────');
  console.log(`PR ${analysis.purchaseRequisition?.requestNo} · description: "${analysis.purchaseRequisition?.description}"`);
  console.log(`PR items: ${analysis.purchaseRequisition?.items.length}`);
  console.log(`suppliers (${analysis.quotations.length}): ${analysis.quotations.map((q) => q.supplierName).join(', ')}`);

  const blob = await generateApprovalFormPdf(analysis, { fx: FX });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  writeFileSync(OUT, bytes);
  console.log(`\nwrote ${OUT} (${(bytes.length / 1024).toFixed(0)} KB)`);

  // Also emit each page on its own so it can be rendered/eyeballed one at a time
  // (`qlmanage -t` only ever thumbnails the first page of a document).
  {
    const src = await PDFDocument.load(bytes);
    for (let i = 0; i < src.getPageCount(); i++) {
      const one = await PDFDocument.create();
      const [p] = await one.copyPages(src, [i]);
      one.addPage(p);
      writeFileSync(OUT.replace(/\.pdf$/, '') + `-page-${i + 1}.pdf`, await one.save());
    }
  }

  // ── Inspect the generated PDF ──
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  const pageOf = new Map<string, number>(); // widget ref → page index
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) pageOf.set(String(annots.get(k)), i + 1);
  });

  const fields = form.getFields();
  console.log(`\n── PDF ────────────────────────────────────────────────────────`);
  console.log(`pages: ${pages.length}   fields: ${fields.length} (text ${fields.filter((f) => f instanceof PDFTextField).length}, checkbox ${fields.filter((f) => f instanceof PDFCheckBox).length})`);

  const rows: { page: number; name: string; value: string }[] = [];
  for (const f of fields) {
    const widget = f.acroField.getWidgets()[0];
    // find the page by matching the widget dict against each page's annots
    let pg = 0;
    pages.forEach((p, i) => {
      const annots = p.node.Annots();
      if (!annots) return;
      for (let k = 0; k < annots.size(); k++) {
        const a = annots.lookup(k);
        if (a === widget.dict) pg = i + 1;
      }
    });
    rows.push({ page: pg, name: f.getName(), value: f instanceof PDFTextField ? (f.getText() ?? '') : '[checkbox]' });
  }

  for (let p = 1; p <= pages.length; p++) {
    const onPage = rows.filter((r) => r.page === p);
    console.log(`\n── PAGE ${p} — ${onPage.length} fields ──────────────────────────────`);
    const sups = onPage.filter((r) => r.name.startsWith('sup_name.'));
    console.log(`  suppliers on this page: ${sups.map((s) => `[col ${s.name.split('.')[1]}] ${s.value.replace(/\n/g, ' ')}`).join('  |  ') || '(none)'}`);
    for (const r of onPage) {
      console.log(`   ${r.name.padEnd(34)} = ${JSON.stringify(r.value)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
