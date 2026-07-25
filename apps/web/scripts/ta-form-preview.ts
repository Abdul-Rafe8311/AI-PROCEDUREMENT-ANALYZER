/*
 * Dev tool: generate the Technical Approval Form FRESH from the real PR 12601612
 * data set and print an inspection report — page count, which suppliers land on
 * which page, and every editable field with its value and page.
 *
 * Nothing is cached or restored: the analysis is rebuilt from scratch through the
 * same pipeline the app uses, then rendered by react-pdf and overlaid with the
 * editable AcroForm fields — exactly what the download button produces.
 *
 *   npx tsx scripts/ta-form-preview.ts [out.pdf]
 */

import { writeFileSync } from 'node:fs';
import React from 'react';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { buildFreshAnalysis, FX } from './ta-form-fixture';

// tsconfig uses jsx:"preserve", so esbuild emits the CLASSIC runtime for the
// renderer's .tsx module; Next.js supplies React automatically, a script must not.
(globalThis as unknown as { React: typeof React }).React = React;

const OUT = process.argv[2] ?? '/tmp/ta-form.pdf';

async function main() {
  const { generateApprovalFormPdf } = await import('../src/lib/approval-form');
  const analysis = buildFreshAnalysis();

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
