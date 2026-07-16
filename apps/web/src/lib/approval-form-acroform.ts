'use client';

// Technical Approval Form as a FILLABLE PDF (AcroForm) — generated with pdf-lib so
// Farid can open it in any PDF viewer (Preview, Acrobat…) and type directly into
// fields, no manual text boxes. Every VALUE on the form is a real interactive form
// field, PRE-FILLED from the extracted/generated data (editable, not blank):
// per-supplier item descriptions, qty, unit prices, totals, terms, country of
// origin, warranty, AI-suggested technical comments, PR description and dates. The
// six company signature blocks keep Approved/Denied checkboxes + editable
// Signature/Date fields. Layout mirrors the on-screen column-per-supplier grid,
// with the live FX stamp in the header.
//
// (Replaces the previous flat @react-pdf/renderer form, which drew static text with
// no fields to type into.)

import { PDFDocument, StandardFonts, TextAlignment, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { scoreSuppliers } from './analysis-engine';
import { type FxRates, getFxRates, sarPerUnit, toSar, toUsd } from './fx-rates';
import {
  buildApprovalFields,
  resolvePrDescription,
  suggestOrigins,
  suggestTechnicalComments,
  suggestWarranties,
} from './item-matching';
import { buildComparisonModel } from './pr-comparison';
import {
  type AnalysisResult,
  type ApprovalFieldValue,
  DEFAULT_SIGNATURE_ROLES,
  DEFAULT_WEIGHTS,
  deliveryNormalizedHint,
  type ExtractedQuotation,
  isLocalCountry,
  type TechnicalComment,
} from './workspace-types';
import type { ApprovalFormOptions } from './approval-form-pdf';

// ── palette (subtle; fields get a faint tint so they read as "fillable") ──
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.2, 0.25, 0.33);
const BORDER = rgb(0.8, 0.84, 0.89);
const HEAD_BG = rgb(0.89, 0.91, 0.94);
const FIELD_BG = rgb(0.97, 0.98, 1);
const AI_BG = rgb(0.93, 0.95, 1);
const AI_INK = rgb(0.31, 0.29, 0.9);

const PAGE_W = 842;
const PAGE_H = 595;
const M = 22; // page margin
const CONTENT_W = PAGE_W - 2 * M;

const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US'));

function withVatAmount(q: ExtractedQuotation): number | null {
  const international = q.countryOfOrigin != null && !isLocalCountry(q.countryOfOrigin);
  return international && q.totalCostInclVat != null ? q.totalCostInclVat : null;
}

function fxStampText(fx: FxRates, currencies: string[]): string {
  const uniq = Array.from(new Set(['USD', ...currencies.map((c) => c.toUpperCase())])).filter((c) => c !== 'SAR');
  const bits = uniq
    .map((c) => {
      const v = sarPerUnit(c, fx);
      return v == null ? null : `1 ${c} = ${v.toFixed(4)} SAR`;
    })
    .filter((b): b is string => !!b);
  let when = fx.asOf;
  const d = new Date(fx.asOf);
  if (!Number.isNaN(d.getTime())) when = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `${bits.join('   ·   ')} — rate as of ${when} (${fx.live ? 'live' : 'cached'})`;
}

function aiRecommendation(analysis: AnalysisResult, fx: FxRates | null): string {
  const scored = scoreSuppliers(analysis.quotations, analysis.risks, DEFAULT_WEIGHTS);
  const best = scored[0];
  if (!best) return '';
  const name = best.quotation.supplierName;
  const rec = analysis.recommendation;
  const bits: string[] = [];
  if (rec.lowestCost?.supplier === name && best.quotation.totalCost != null) {
    const sar = fx ? toSar(best.quotation.totalCost, best.quotation.currency, fx) : null;
    const cost = sar != null ? `SAR ${money2(sar)}` : `${best.quotation.currency} ${money2(best.quotation.totalCost)}`;
    bits.push(`lowest total cost (${cost})`);
  }
  if (rec.fastestDelivery?.supplier === name && best.quotation.deliveryDays != null) {
    const del = best.quotation.deliveryRaw?.trim() || `${best.quotation.deliveryDays} days`;
    bits.push(`faster delivery (${del})`);
  }
  const reason =
    bits.length > 0
      ? bits.join(' and ')
      : analysis.quotations.length === 1
        ? `only supplier analyzed; procurement score ${Math.round(best.overall * 100)}/100`
        : `highest procurement score (${Math.round(best.overall * 100)}/100)`;
  return `${name} — ${reason}.`;
}

/** Build the Technical Approval Form as a FILLABLE (AcroForm) PDF Blob. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const qs = analysis.quotations;
  const fx = options?.fx !== undefined ? options.fx : await getFxRates();
  const model = buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx });
  const qById = new Map(qs.map((q) => [q.id, q]));
  const comments = options?.technicalComments ?? suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition);
  const warranties = options?.warranties ?? buildApprovalFields(qs, suggestWarranties(qs));
  const origins = options?.countriesOfOrigin ?? buildApprovalFields(qs, suggestOrigins(qs));
  const showWarranty = qs.some((q) => warranties[q.id]?.enabled);
  const showOrigin = qs.some((q) => origins[q.id]?.enabled);
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  const selectedSupplier = options?.selectedSupplier ?? null;

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';
  const prSubject = resolvePrDescription(pr);
  const ai = aiRecommendation(analysis, fx);
  const generatedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const suppliers = model.suppliers;
  const nSup = Math.max(suppliers.length, 1);

  const doc = await PDFDocument.create();
  doc.setTitle('Technical Approval Form');
  doc.setProducer('AI Procurement Copilot');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let cursor = PAGE_H - M; // y of the TOP of the next thing to draw
  let uid = 0;
  const nm = (base: string) => `${base}.${uid++}`;

  // ── low-level drawing helpers (y args are the TOP of the box) ──
  const text = (s: string, x: number, yTop: number, size: number, f: PDFFont, color = INK, maxW?: number) => {
    let str = s;
    if (maxW) while (str.length > 1 && f.widthOfTextAtSize(str, size) > maxW) str = str.slice(0, -2) + '…';
    page.drawText(str, { x, y: yTop - size, size, font: f, color });
  };
  const box = (x: number, yTop: number, w: number, h: number, fill?: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderWidth: 0.5, borderColor: BORDER, color: fill });
  const headBox = (x: number, yTop: number, w: number, h: number) =>
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderWidth: 0.5, borderColor: LINE, color: HEAD_BG });

  const field = (
    base: string,
    x: number,
    yTop: number,
    w: number,
    h: number,
    value: string,
    opts: { size?: number; multiline?: boolean; align?: TextAlignment; f?: PDFFont } = {},
  ) => {
    const f = opts.f ?? font;
    const tf = form.createTextField(nm(base));
    tf.setText(value ?? '');
    if (opts.multiline) tf.enableMultiline();
    if (opts.align != null) tf.setAlignment(opts.align);
    // addToPage must run BEFORE setFontSize — it seeds the field's /DA (default
    // appearance) entry that setFontSize requires; we then pin the size and
    // regenerate the appearance stream so the fixed size actually renders.
    tf.addToPage(page, {
      x: x + 0.75,
      y: yTop - h + 0.75,
      width: w - 1.5,
      height: h - 1.5,
      font: f,
      textColor: INK,
      backgroundColor: FIELD_BG,
      borderWidth: 0,
    });
    tf.setFontSize(opts.size ?? 6.5);
    tf.updateAppearances(f);
  };
  const checkbox = (base: string, x: number, yTop: number, size: number) => {
    const cb = form.createCheckBox(nm(base));
    cb.addToPage(page, { x, y: yTop - size, width: size, height: size, borderWidth: 1, borderColor: LINE });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    cursor = PAGE_H - M;
  };
  const ensure = (h: number) => {
    if (cursor - h < M + 26) newPage();
  };

  // ── Title ──
  const title = 'TECHNICAL APPROVAL FORM';
  text(title, (PAGE_W - bold.widthOfTextAtSize(title, 13)) / 2, cursor, 13, bold);
  cursor -= 20;

  // ── Meta row: TA Date | PR # | Generated on (all editable) ──
  const metaH = 16;
  const metaCols = [
    { label: 'TA Date:', value: generatedOn, base: 'ta_date' },
    { label: 'PR #:', value: prNumber, base: 'pr_number' },
    { label: 'Generated on:', value: generatedOn, base: 'generated_on' },
  ];
  const metaW = CONTENT_W / metaCols.length;
  metaCols.forEach((c, i) => {
    const x = M + i * metaW;
    box(x, cursor, metaW, metaH);
    const lw = bold.widthOfTextAtSize(c.label, 7) + 4;
    text(c.label, x + 3, cursor - 4, 7, bold);
    field(c.base, x + lw, cursor - 1, metaW - lw - 2, metaH - 2, c.value, { size: 7 });
  });
  cursor -= metaH;

  // ── PR Description (editable, multi-line) ──
  const prH = 20;
  box(M, cursor, CONTENT_W, prH);
  const prLabel = 'PR Description:';
  const plw = bold.widthOfTextAtSize(prLabel, 7.5) + 5;
  text(prLabel, M + 3, cursor - 5, 7.5, bold);
  field('pr_description', M + plw, cursor - 1, CONTENT_W - plw - 3, prH - 2, prSubject, { size: 7, multiline: true });
  cursor -= prH + 6;

  // ── Grid geometry ──
  const idxW = 15;
  const qtyLW = 30;
  const uomW = 24;
  const descLW = 150;
  const leftW = idxW + descLW + qtyLW + uomW;
  const supW = (CONTENT_W - leftW) / nSup;
  const subDescW = supW * 0.46;
  const subQtyW = supW * 0.2;
  const subPriceW = supW - subDescW - subQtyW;

  // ── Grid header band (two rows: supplier name/ref, then sub-columns) ──
  const headH1 = 13;
  const headH2 = 11;
  headBox(M, cursor, idxW, headH1 + headH2);
  text('#', M + 4, cursor - 9, 7, bold);
  headBox(M + idxW, cursor, descLW, headH1 + headH2);
  text(model.hasPr ? 'PR Item Description' : 'Item Description', M + idxW + 3, cursor - 9, 7, bold);
  headBox(M + idxW + descLW, cursor, qtyLW, headH1 + headH2);
  text('Qty', M + idxW + descLW + 6, cursor - 9, 7, bold);
  headBox(M + idxW + descLW + qtyLW, cursor, uomW, headH1 + headH2);
  text('UOM', M + idxW + descLW + qtyLW + 3, cursor - 9, 7, bold);

  suppliers.forEach((sup, i) => {
    const x = M + leftW + i * supW;
    headBox(x, cursor, supW, headH1);
    field(`sup_name.${i}`, x + 1, cursor - 0.5, supW - 2, headH1 - 1, sup.supplier, { size: 7, f: bold });
    // sub-columns
    headBox(x, cursor - headH1, subDescW, headH2);
    text('Description', x + 2, cursor - headH1 - 8, 5.5, bold, MUTED);
    headBox(x + subDescW, cursor - headH1, subQtyW, headH2);
    text('Qty', x + subDescW + 2, cursor - headH1 - 8, 5.5, bold, MUTED);
    headBox(x + subDescW + subQtyW, cursor - headH1, subPriceW, headH2);
    text('Unit Price', x + subDescW + subQtyW + 2, cursor - headH1 - 8, 5.5, bold, MUTED);
  });
  cursor -= headH1 + headH2;

  // ── Item rows ──
  const rowH = 20;
  for (const r of model.rows) {
    ensure(rowH);
    const yTop = cursor;
    box(M, yTop, idxW, rowH);
    text(r.kind === 'charge' ? '' : String(r.index), M + 4, yTop - rowH / 2 - 2, 6.5, font);
    box(M + idxW, yTop, descLW, rowH);
    const prLabelText = `${r.label}${r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}`;
    field(`pr_item_desc`, M + idxW, yTop, descLW, rowH, prLabelText, { size: 6, multiline: true });
    box(M + idxW + descLW, yTop, qtyLW, rowH);
    field(`pr_item_qty`, M + idxW + descLW, yTop, qtyLW, rowH, plain(r.qty), { size: 6.5, align: TextAlignment.Center });
    box(M + idxW + descLW + qtyLW, yTop, uomW, rowH);
    field(`pr_item_uom`, M + idxW + descLW + qtyLW, yTop, uomW, rowH, r.uom ?? '', { size: 6.5, align: TextAlignment.Center });

    suppliers.forEach((_sup, i) => {
      const x = M + leftW + i * supW;
      const cell = r.cells[i] ?? null;
      const notQuoted = !cell && r.kind !== 'charge';
      box(x, yTop, subDescW, rowH);
      const descVal = cell?.description ?? (notQuoted ? 'Not Quoted' : '');
      const specNote = cell?.matchState === 'quoted_spec_diff'
        ? `\nspec differs${cell.specDiffNote ? `: ${cell.specDiffNote}` : ''}`
        : '';
      field(`cell_desc.${r.index}.${i}`, x, yTop, subDescW, rowH, descVal + specNote, { size: 5.6, multiline: true });
      box(x + subDescW, yTop, subQtyW, rowH);
      field(`cell_qty.${r.index}.${i}`, x + subDescW, yTop, subQtyW, rowH, cell ? plain(cell.qty) : '', { size: 6, align: TextAlignment.Center });
      box(x + subDescW + subQtyW, yTop, subPriceW, rowH);
      let priceVal = '';
      if (cell && cell.unitPrice != null) {
        const sar = fx ? toSar(cell.unitPrice, cell.currency, fx) : null;
        const usd = fx ? toUsd(cell.unitPrice, cell.currency, fx) : null;
        priceVal = sar != null && usd != null ? `SAR ${money2(sar)} / USD ${money2(usd)}` : `${cell.currency} ${money2(cell.unitPrice)}`;
      }
      field(`cell_price.${r.index}.${i}`, x + subDescW + subQtyW, yTop, subPriceW, rowH, priceVal, { size: 5.6, multiline: true, align: TextAlignment.Right });
    });
    cursor -= rowH;
  }

  // ── Totals + terms rows (label on the left block, one field per supplier) ──
  const termRow = (label: string, valueFor: (q: ExtractedQuotation) => string, opts: { multiline?: boolean } = {}) => {
    const h = opts.multiline ? 22 : 15;
    ensure(h);
    const yTop = cursor;
    box(M, yTop, leftW, h, HEAD_BG);
    text(label, M + 3, yTop - h / 2 - 2, 6.5, bold);
    suppliers.forEach((sup, i) => {
      const x = M + leftW + i * supW;
      box(x, yTop, supW, h);
      const q = qById.get(sup.quotationId)!;
      field(`term.${label}.${i}`, x, yTop, supW, h, valueFor(q), { size: 6, multiline: opts.multiline });
    });
    cursor -= h;
  };

  termRow('Total Price without VAT', (q) => {
    if (q.totalCost == null) return '';
    const sar = fx ? toSar(q.totalCost, q.currency, fx) : null;
    return sar != null ? `${q.currency} ${money2(q.totalCost)} / SAR ${money2(sar)}` : `${q.currency} ${money2(q.totalCost)}`;
  });
  if (suppliers.some((s) => withVatAmount(qById.get(s.quotationId)!) != null)) {
    termRow('Total Price with VAT', (q) => {
      const v = withVatAmount(q);
      if (v == null) return '';
      const sar = fx ? toSar(v, q.currency, fx) : null;
      return sar != null ? `${q.currency} ${money2(v)} / SAR ${money2(sar)}` : `${q.currency} ${money2(v)}`;
    });
  }
  termRow('Payment Terms', (q) => q.paymentTerms ?? '', { multiline: true });
  termRow('Delivery Time', (q) => {
    const raw = q.deliveryRaw?.trim() ?? '';
    if (!raw) return '';
    const hint = deliveryNormalizedHint(q.deliveryRaw, q.deliveryDays);
    return hint ? `${raw} (${hint})` : raw;
  });
  termRow('Delivery Terms', (q) => q.deliveryTerms ?? '');
  if (showOrigin) termRow('Country of Origin', (q) => fieldText(origins, q.id));
  if (showWarranty) termRow('Warranty', (q) => fieldText(warranties, q.id), { multiline: true });

  // Technical Comments — AI-suggested (editable).
  {
    const h = 24;
    ensure(h);
    const yTop = cursor;
    box(M, yTop, leftW, h, HEAD_BG);
    text('Technical Comments', M + 3, yTop - h / 2 - 2, 6.5, bold);
    suppliers.forEach((sup, i) => {
      const x = M + leftW + i * supW;
      box(x, yTop, supW, h);
      const c = comments[sup.quotationId];
      field(`tech_comment.${i}`, x, yTop, supW, h, c?.text ?? '', { size: 6, multiline: true, f: c?.aiSuggested ? oblique : font });
    });
    cursor -= h + 6;
  }

  // ── AI-suggested recommendation (clearly labelled, NOT an approval) ──
  if (ai) {
    const h = 22;
    ensure(h);
    page.drawRectangle({ x: M, y: cursor - h, width: CONTENT_W, height: h, borderWidth: 0.75, borderColor: AI_INK, color: AI_BG });
    text('AI SUGGESTED — system-generated, NOT an approval', M + 5, cursor - 8, 6, bold, AI_INK);
    text(ai, M + 5, cursor - 17, 7, oblique, AI_INK, CONTENT_W - 10);
    cursor -= h + 6;
  }

  // ── Final Recommendation (blank editable; pre-filled only if a reviewer selected) ──
  {
    const h = 16;
    ensure(h);
    const yTop = cursor;
    const lbl = 'Final Recommendation:';
    text(lbl, M, yTop - 11, 8, bold);
    const lw = bold.widthOfTextAtSize(lbl, 8) + 6;
    field('final_recommendation', M + lw, yTop, CONTENT_W - lw, h, selectedSupplier ? `${selectedSupplier} (selected by reviewer)` : '', { size: 7.5 });
    cursor -= h + 8;
  }

  // ── Signature / approval blocks (company's six) ──
  const perRow = 3;
  const gap = 8;
  const blockW = (CONTENT_W - (perRow - 1) * gap) / perRow;
  const blockH = 58;
  roles.forEach((role, i) => {
    const col = i % perRow;
    if (col === 0) {
      ensure(blockH + 4);
      cursor -= 0;
    }
    const x = M + col * (blockW + gap);
    const yTop = cursor;
    page.drawRectangle({ x, y: yTop - blockH, width: blockW, height: blockH, borderWidth: 0.75, borderColor: LINE });
    text(role, x + 5, yTop - 10, 7, bold, INK, blockW - 10);
    // Approved / Denied checkboxes
    const cy = yTop - 22;
    checkbox(`approved.${i}`, x + 5, cy, 8);
    text('Approved', x + 16, cy - 1, 6.5, font);
    checkbox(`denied.${i}`, x + 70, cy, 8);
    text('Denied', x + 81, cy - 1, 6.5, font);
    // Signature + Date fields
    text('Signature:', x + 5, yTop - 36, 6.5, font, MUTED);
    field(`signature.${i}`, x + 42, yTop - 30, blockW - 47, 12, '', { size: 6.5 });
    text('Date:', x + 5, yTop - 50, 6.5, font, MUTED);
    field(`sig_date.${i}`, x + 42, yTop - 44, blockW - 47, 12, '', { size: 6.5 });
    if (col === perRow - 1 || i === roles.length - 1) cursor -= blockH + gap;
  });

  // ── Footer + live FX stamp on every page ──
  const fxLine = fx ? fxStampText(fx, qs.map((q) => q.currency)) : 'Live FX rate unavailable — amounts shown in each supplier’s own currency.';
  for (const p of doc.getPages()) {
    p.drawText(`Generated by AI Procurement Copilot — ${generatedOn}`, { x: M, y: 14, size: 6, font, color: MUTED });
    const w = font.widthOfTextAtSize(fxLine, 6);
    p.drawText(fxLine, { x: PAGE_W - M - w, y: 14, size: 6, font, color: MUTED });
  }

  const bytes = await doc.save();
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is unambiguous
  // (doc.save() is typed Uint8Array<ArrayBufferLike>, which isn't a valid BlobPart).
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  return new Blob([buf], { type: 'application/pdf' });
}

function fieldText(map: Record<string, ApprovalFieldValue>, id: string): string {
  const f = map[id];
  return f?.enabled ? f.text?.trim() ?? '' : '';
}

// Re-export the comment type consumers rely on (kept identical to the old module).
export type { TechnicalComment };
