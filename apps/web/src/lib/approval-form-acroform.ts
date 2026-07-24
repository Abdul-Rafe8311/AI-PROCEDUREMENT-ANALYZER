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

import { PDFDocument, PDFName, PDFString, StandardFonts, TextAlignment, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
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
    tf.setFontSize(opts.size ?? 8);
    tf.updateAppearances(f);
  };
  const checkbox = (base: string, x: number, yTop: number, size: number) => {
    const cb = form.createCheckBox(nm(base));
    cb.addToPage(page, { x, y: yTop - size, width: size, height: size, borderWidth: 1, borderColor: LINE });
  };

  // Draw a label vertically CENTERED in a box of height h whose TOP edge is yTop.
  // (The old call sites positioned labels a full font-size too low, so row labels
  // and the Description/Qty/Unit-Price sub-headers were clipped by the bottom
  // border.) maxW ellipsizes — used only for non-data labels/headers, NEVER for the
  // data cells, which wrap via wrapLines() so an identifier is never cut off.
  const centerText = (
    s: string,
    x: number,
    yTop: number,
    h: number,
    size: number,
    f: PDFFont,
    color = INK,
    maxW?: number,
  ) => {
    let str = s;
    if (maxW) while (str.length > 1 && f.widthOfTextAtSize(str, size) > maxW) str = str.slice(0, -2) + '…';
    page.drawText(str, { x, y: yTop - h / 2 - size * 0.35, size, font: f, color });
  };

  // Wrap on WHITESPACE ONLY — never inside a word. A part code, drawing number or
  // any identifier ("TWS.10(60)-200(140)-40-310") therefore always stays intact on
  // one line; if it is wider than the column it simply owns its line (and fitSize()
  // below shrinks that cell's font so it still fits, rather than splitting it).
  const wrapWords = (s: string, f: PDFFont, size: number, maxW: number): string[] => {
    const width = (t: string) => f.widthOfTextAtSize(t, size);
    const lines: string[] = [];
    for (const para of String(s ?? '').split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = '';
      for (const w of words) {
        if (!line) line = w;
        else if (width(`${line} ${w}`) <= maxW) line = `${line} ${w}`;
        else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  };

  // Largest font size ≤ target at which the WIDEST single token fits maxW, floored
  // at `min`. This is how a long identifier is kept whole without ever being split:
  // the cell's font shrinks just enough for its widest word to fit the column.
  const fitSize = (s: string, f: PDFFont, target: number, min: number, maxW: number): number => {
    let widest = 0;
    for (const t of String(s ?? '').split(/\s+/)) {
      if (t) widest = Math.max(widest, f.widthOfTextAtSize(t, target));
    }
    if (widest <= maxW || widest === 0) return target;
    return Math.max(min, Math.floor(target * (maxW / widest) * 10) / 10);
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
    field(c.base, x + lw, cursor - 1, metaW - lw - 2, metaH - 2, c.value, { size: 8 });
  });
  cursor -= metaH;

  // ── PR Description (editable, multi-line) ──
  const prH = 20;
  box(M, cursor, CONTENT_W, prH);
  const prLabel = 'PR Description:';
  const plw = bold.widthOfTextAtSize(prLabel, 7.5) + 5;
  text(prLabel, M + 3, cursor - 5, 7.5, bold);
  field('pr_description', M + plw, cursor - 1, CONTENT_W - plw - 3, prH - 2, prSubject, { size: 8, multiline: true });
  cursor -= prH + 6;

  // ── Grid geometry — legible ~8pt data type + a WIDE PR-description column.
  //     Wrapping is whitespace-only, so identifiers never split; a cell whose widest
  //     token can't fit its column shrinks its OWN font (fitSize) down to a floor
  //     instead. The description sub-column takes the lion's share of each supplier
  //     column (qty/price are short) so codes fit at the largest possible size. ──
  const idxW = 16;
  const qtyLW = 30;
  const uomW = 24;
  const descLW = 202;
  const leftW = idxW + descLW + qtyLW + uomW;
  const supW = (CONTENT_W - leftW) / nSup;
  const subDescW = supW * 0.52;
  const subQtyW = supW * 0.2;
  const subPriceW = supW - subDescW - subQtyW;
  const cellTarget = 8; // target data-cell size (per-cell auto-fit shrinks if needed)
  const cellMin = 4.5; // floor when a long identifier must fit a narrow column
  const leftTarget = 8.5; // PR item description (left column) — wide enough for ~8pt
  const lineFor = (size: number) => size * 1.28; // vertical space per wrapped line

  // ── Grid header band (two rows: supplier name/ref, then sub-columns) ──
  // Supplier names are wrapped on whitespace (so "Supply Wave Trading Establishment"
  // stacks over two lines instead of clipping); headH1 grows to fit the tallest name.
  const nameSize = 8;
  const supNameLines = suppliers.map((s) => wrapWords(s.supplier, bold, nameSize, supW - 4));
  const headH1 = Math.max(16, Math.max(...supNameLines.map((l) => l.length)) * lineFor(nameSize) + 4);
  const headH2 = 13;
  const headTop = cursor;
  headBox(M, headTop, idxW, headH1 + headH2);
  centerText('#', M + 5, headTop, headH1 + headH2, 8, bold);
  headBox(M + idxW, headTop, descLW, headH1 + headH2);
  centerText(model.hasPr ? 'PR Item Description' : 'Item Description', M + idxW + 4, headTop, headH1 + headH2, 8.5, bold, INK, descLW - 8);
  headBox(M + idxW + descLW, headTop, qtyLW, headH1 + headH2);
  centerText('Qty', M + idxW + descLW + 7, headTop, headH1 + headH2, 8, bold);
  headBox(M + idxW + descLW + qtyLW, headTop, uomW, headH1 + headH2);
  centerText('UOM', M + idxW + descLW + qtyLW + 4, headTop, headH1 + headH2, 8, bold);

  // Auto-fit ONE sub-header size so all three labels fit their (narrow) columns —
  // driven by the tightest, "Unit Price". Sized to fit, so no ellipsis is needed.
  const subHeadSize = Math.min(
    fitSize('Description', bold, 7, 4.5, subDescW - 4),
    fitSize('Unit Price', bold, 7, 4.5, subPriceW - 4),
  );
  suppliers.forEach((_sup, i) => {
    const x = M + leftW + i * supW;
    headBox(x, headTop, supW, headH1);
    field(`sup_name.${i}`, x + 1, headTop - 0.5, supW - 2, headH1 - 1, supNameLines[i].join('\n'), { size: nameSize, multiline: true, f: bold });
    // sub-columns (legible, vertically centered; sized to fit so nothing ellipsizes)
    const subTop = headTop - headH1;
    headBox(x, subTop, subDescW, headH2);
    centerText('Description', x + 2, subTop, headH2, subHeadSize, bold, MUTED);
    headBox(x + subDescW, subTop, subQtyW, headH2);
    centerText('Qty', x + subDescW + 2, subTop, headH2, subHeadSize, bold, MUTED);
    headBox(x + subDescW + subQtyW, subTop, subPriceW, headH2);
    centerText('Unit Price', x + subDescW + subQtyW + 2, subTop, headH2, subHeadSize, bold, MUTED);
  });
  cursor -= headH1 + headH2;

  // ── Item rows — each cell picks the largest font (≤ target) at which its widest
  //     identifier fits, then wraps on whitespace only; the row grows to fit the
  //     tallest cell. Identifiers are never split, and short cells stay at ~8pt. ──
  for (const r of model.rows) {
    const prLabelText = `${r.label}${r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}`;
    const leftSize = fitSize(prLabelText, font, leftTarget, cellMin, descLW - 6);
    const leftLines = wrapWords(prLabelText, font, leftSize, descLW - 6);
    let maxCellH = leftLines.length * lineFor(leftSize);
    // Pre-compute each supplier cell so the row height covers the tallest column.
    const perSup = suppliers.map((_sup, i) => {
      const cell = r.cells[i] ?? null;
      const notQuoted = !cell && r.kind !== 'charge';
      const descVal = cell?.description ?? (notQuoted ? 'Not Quoted' : '');
      const specNote = cell?.matchState === 'quoted_spec_diff'
        ? `\nspec differs${cell.specDiffNote ? `: ${cell.specDiffNote}` : ''}`
        : '';
      const descFull = descVal + specNote;
      let priceVal = '';
      if (cell && cell.unitPrice != null) {
        const sar = fx ? toSar(cell.unitPrice, cell.currency, fx) : null;
        const usd = fx ? toUsd(cell.unitPrice, cell.currency, fx) : null;
        priceVal = sar != null && usd != null ? `SAR ${money2(sar)} / USD ${money2(usd)}` : `${cell.currency} ${money2(cell.unitPrice)}`;
      }
      const dSize = fitSize(descFull, font, cellTarget, cellMin, subDescW - 6);
      const dLines = wrapWords(descFull, font, dSize, subDescW - 6);
      const pSize = fitSize(priceVal, font, cellTarget, cellMin, subPriceW - 6);
      const pLines = wrapWords(priceVal, font, pSize, subPriceW - 6);
      maxCellH = Math.max(maxCellH, dLines.length * lineFor(dSize), pLines.length * lineFor(pSize));
      // Store the description pre-wrapped on whitespace (no mid-token breaks); the
      // price stays un-split so its "SAR … / USD …" text is intact (the multiline
      // field re-wraps it to the same lines we measured).
      return { cell, descText: dLines.join('\n'), dSize, priceVal, pSize };
    });
    const rowH = Math.max(18, maxCellH + 6);
    ensure(rowH);
    const yTop = cursor;

    box(M, yTop, idxW, rowH);
    if (r.kind !== 'charge') centerText(String(r.index), M + 5, yTop, rowH, 8, font);
    box(M + idxW, yTop, descLW, rowH);
    field(`pr_item_desc`, M + idxW, yTop, descLW, rowH, leftLines.join('\n'), { size: leftSize, multiline: true });
    box(M + idxW + descLW, yTop, qtyLW, rowH);
    const prQtyStr = plain(r.qty);
    field(`pr_item_qty`, M + idxW + descLW, yTop, qtyLW, rowH, prQtyStr, { size: fitSize(prQtyStr, font, 8, 5.5, qtyLW - 4), align: TextAlignment.Center });
    box(M + idxW + descLW + qtyLW, yTop, uomW, rowH);
    field(`pr_item_uom`, M + idxW + descLW + qtyLW, yTop, uomW, rowH, r.uom ?? '', { size: 8, align: TextAlignment.Center });

    suppliers.forEach((_sup, i) => {
      const x = M + leftW + i * supW;
      const p = perSup[i];
      box(x, yTop, subDescW, rowH);
      field(`cell_desc.${r.index}.${i}`, x, yTop, subDescW, rowH, p.descText, { size: p.dSize, multiline: true });
      box(x + subDescW, yTop, subQtyW, rowH);
      const qtyStr = p.cell ? plain(p.cell.qty) : '';
      field(`cell_qty.${r.index}.${i}`, x + subDescW, yTop, subQtyW, rowH, qtyStr, { size: fitSize(qtyStr, font, 8, 5, subQtyW - 4), align: TextAlignment.Center });
      box(x + subDescW + subQtyW, yTop, subPriceW, rowH);
      field(`cell_price.${r.index}.${i}`, x + subDescW + subQtyW, yTop, subPriceW, rowH, p.priceVal, { size: p.pSize, multiline: true, align: TextAlignment.Right });
    });
    cursor -= rowH;
  }

  // ── Totals + terms rows (label on the left block, one field per supplier) ──
  // Every value field is multiline and the row grows to fit the tallest value, so
  // narrower supplier columns never clip a total, delivery term, or warranty. The
  // label is vertically centered (was clipped at the row's bottom border before).
  const termRow = (label: string, valueFor: (q: ExtractedQuotation) => string, opts: { multiline?: boolean } = {}) => {
    const values = suppliers.map((sup) => valueFor(qById.get(sup.quotationId)!));
    // Auto-fit each value so a long term (e.g. dual-currency total) never splits.
    const sizes = values.map((v) => fitSize(v, font, 8, cellMin, supW - 6));
    const maxCellH = Math.max(...values.map((v, i) => wrapWords(v, font, sizes[i], supW - 6).length * lineFor(sizes[i])));
    const h = Math.max(opts.multiline ? 18 : 15, maxCellH + 4);
    ensure(h);
    const yTop = cursor;
    box(M, yTop, leftW, h, HEAD_BG);
    centerText(label, M + 4, yTop, h, 8, bold, INK, leftW - 8);
    suppliers.forEach((_sup, i) => {
      const x = M + leftW + i * supW;
      box(x, yTop, supW, h);
      field(`term.${label}.${i}`, x, yTop, supW, h, values[i], { size: sizes[i], multiline: true });
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

  // Technical Comments — AI-suggested (editable). Grows to fit the longest comment.
  {
    const values = suppliers.map((sup) => comments[sup.quotationId]?.text ?? '');
    const size = 7.5;
    const maxCellH = Math.max(2 * lineFor(size), ...values.map((v) => wrapWords(v, font, size, supW - 6).length * lineFor(size)));
    const h = Math.max(24, maxCellH + 4);
    ensure(h);
    const yTop = cursor;
    box(M, yTop, leftW, h, HEAD_BG);
    centerText('Technical Comments', M + 4, yTop, h, 8, bold);
    suppliers.forEach((sup, i) => {
      const x = M + leftW + i * supW;
      box(x, yTop, supW, h);
      const c = comments[sup.quotationId];
      field(`tech_comment.${i}`, x, yTop, supW, h, c?.text ?? '', { size, multiline: true, f: c?.aiSuggested ? oblique : font });
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

  // Register the standard fonts in the AcroForm Default Resources (/DR) + a default
  // appearance (/DA). WITHOUT this, viewers that re-render field text (macOS
  // Preview / PDFKit in particular) cannot resolve the font each field's /DA names,
  // so they fall back to a ~12pt default — which overflowed the narrow cells and
  // truncated part codes ("404602703004" → "404602"). With /DR present they honour
  // the fixed 5.5–7pt sizes and the baked, wrapped layout.
  const acro = form.acroForm;
  acro.dict.set(
    PDFName.of('DR'),
    doc.context.obj({
      Font: doc.context.obj({
        Helvetica: font.ref,
        'Helvetica-Bold': bold.ref,
        'Helvetica-Oblique': oblique.ref,
      }),
    }),
  );
  acro.dict.set(PDFName.of('DA'), PDFString.of('0 g /Helvetica 8 Tf'));

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
