'use client';

// Technical Approval Form as a FILLABLE PDF (AcroForm) — generated with pdf-lib so
// Farid can open it in any PDF viewer (Preview, Acrobat…) and type directly into
// fields, no manual text boxes. Every VALUE on the form is a real interactive form
// field, PRE-FILLED from the extracted/generated data (editable, not blank):
// per-supplier item descriptions, qty, unit prices, totals, terms, country of
// origin, warranty, AI-suggested technical comments, PR description and dates. The
// six company signature blocks keep Approved/Denied checkboxes + editable
// Signature/Date fields, and the live FX stamp sits in the footer.
//
// ── SUPPLIER PAGINATION (the reason this form is readable) ──────────────────
// A page carries a MAXIMUM of SUPPLIERS_PER_GROUP (4) supplier columns. With 5
// suppliers that is "Suppliers 1-4 of 5" on page 1 and "Suppliers 5-5 of 5" on
// page 2; with 8 it is 1-4 then 5-8. Each supplier page repeats the #, PR Item
// Description, Qty and UOM columns and EVERY term row (Total Price without VAT,
// Payment Terms, Delivery Time, Delivery Terms, Country of Origin, Warranty,
// Technical Comments) for the suppliers shown on THAT page. The AI note, Final
// Recommendation and the six signature blocks appear ONCE, on the final page.
//
// Squeezing all suppliers onto one landscape page (the previous behaviour) left
// each column far too narrow for a part code at ANY font size, which is what
// mutilated identifiers like "TWS.10(60)-200(140)-45-253MA-C". Within a page each
// supplier cell now stacks — the quoted description spans the FULL column width,
// with Qty and Unit Price on a band beneath it — so a 30-character part code fits
// whole at ~8pt. Wrapping is whitespace-only: an identifier is never split.

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
import { buildComparisonModel, SUPPLIERS_PER_GROUP, supplierGroups } from './pr-comparison';
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

// ── palette (neutral; fields get a faint tint so they read as "fillable").
// There is deliberately NO green / best-value highlight anywhere on this form —
// the sheet stays neutral and the human picks the winner. ──
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.2, 0.25, 0.33);
const BORDER = rgb(0.8, 0.84, 0.89);
const HEAD_BG = rgb(0.89, 0.91, 0.94);
const FIELD_BG = rgb(0.97, 0.98, 1);
const AI_BG = rgb(0.93, 0.95, 1);
const AI_INK = rgb(0.31, 0.29, 0.9); // indigo — "spec differs" status + AI note

const PAGE_W = 842; // A4 landscape
const PAGE_H = 595;
const M = 22; // page margin
const CONTENT_W = PAGE_W - 2 * M;
const FOOTER_H = 22; // reserved strip for the footer / FX stamp on every page

// Column geometry. The left block (#, PR Item Description, Qty, UOM) repeats on
// every supplier page; the supplier columns share what is left, at most 4 of them.
const IDX_W = 18;
const QTY_L_W = 34;
const UOM_W = 30;
const SUP_W_STD = 144; // supplier column width at a full page of 4
const DESC_MIN = 138;
const DESC_MAX = 420; // a short last group widens the PR column instead of leaving a gap

const CELL_TARGET = 8; // data-cell type size
const CELL_MIN = 6; // floor when an identifier still has to fit its column
const LABEL_SIZE = 8;

const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US'));

// "Quoted · spec differs" status label. The matcher's note repeats words the label
// already carries ("grade differs: quoted SS 310 vs PR 253 MA"); trimming them
// keeps the label on ONE line in a supplier column without losing what differs.
function specDiffLabel(note: string | null | undefined): string {
  const detail = (note ?? '')
    .replace(/^\s*(grade|dimension|spec|size)\s+differs\s*[:—-]?\s*/i, '')
    .replace(/^\s*quoted\s+/i, '')
    .trim();
  return detail ? `Quoted · spec differs — ${detail}` : 'Quoted · spec differs';
}

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
  const showVat = qs.some((q) => withVatAmount(q) != null);
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  const selectedSupplier = options?.selectedSupplier ?? null;

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';
  // Printed VERBATIM and IN FULL — never shortened to a first word. When the
  // requisition genuinely carries no subject the field says so honestly.
  const prSubject = resolvePrDescription(pr) || 'Not stated on the requisition';
  const ai = aiRecommendation(analysis, fx);
  const generatedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Supplier pagination: at most 4 columns per page ──
  const indexed = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed, SUPPLIERS_PER_GROUP);
  const totalSuppliers = model.suppliers.length;

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

  // ── Text metrics, taken from the EMBEDDED font so our boxes and the viewer's
  // own re-render of the field text agree exactly. pdf-lib lays multiline field
  // text out at heightAtSize(size) * 1.2 per line, starting one line-height below
  // the top of the widget; if a box is short by even a point the last line drops
  // out of the widget's BBox and gets clipped. ──
  const LINE_RATIO = (font.heightAtSize(100) * 1.2) / 100;
  const DESC_RATIO = (font.heightAtSize(100) - font.heightAtSize(100, { descender: false })) / 100;
  const FIELD_INSET = 1; // widget inset inside the drawn cell border
  const lineH = (size: number) => size * LINE_RATIO;
  /** Cell height that fits `lines` lines of `size` type without clipping. */
  const cellH = (lines: number, size: number) => lines * lineH(size) + size * DESC_RATIO + 2 * FIELD_INSET + 2 + 0.5;
  // Text width usable inside a cell of width `w`. Beyond pdf-lib's own 1pt padding
  // this keeps ~3pt of slack on each side, because a viewer that RE-LAYS-OUT field
  // text (macOS Preview / PDFKit) uses its own inset: a line measured flush to the
  // widget edge here comes out clipped mid-glyph there.
  const textW = (w: number) => w - 2 * FIELD_INSET - 10;

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
  const rule = (x: number, y: number, w: number) =>
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.5, color: BORDER });

  const field = (
    base: string,
    x: number,
    yTop: number,
    w: number,
    h: number,
    value: string,
    opts: {
      size?: number;
      multiline?: boolean;
      align?: TextAlignment;
      f?: PDFFont;
      color?: ReturnType<typeof rgb>;
    } = {},
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
      x: x + FIELD_INSET,
      y: yTop - h + FIELD_INSET,
      width: w - 2 * FIELD_INSET,
      height: h - 2 * FIELD_INSET,
      font: f,
      textColor: opts.color ?? INK,
      backgroundColor: FIELD_BG,
      borderWidth: 0,
    });
    tf.setFontSize(opts.size ?? CELL_TARGET);
    tf.updateAppearances(f);
  };
  const checkbox = (base: string, x: number, yTop: number, size: number) => {
    const cb = form.createCheckBox(nm(base));
    cb.addToPage(page, { x, y: yTop - size, width: size, height: size, borderWidth: 1, borderColor: LINE });
  };

  // Draw a label vertically CENTERED in a box of height h whose TOP edge is yTop.
  const centerText = (
    s: string,
    x: number,
    yTop: number,
    h: number,
    size: number,
    f: PDFFont,
    color = INK,
  ) => page.drawText(s, { x, y: yTop - h / 2 - size * 0.35, size, font: f, color });

  // Wrap on WHITESPACE ONLY — never inside a word. A part code, drawing number or
  // any identifier ("TWS.10(60)-200(140)-45-253MA-C") therefore always stays intact
  // on one line. This mirrors pdf-lib's own field re-wrapping (it also breaks only
  // at whitespace), so what we measure is what a viewer draws.
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
  // the cell's font shrinks just enough for its widest word to fit the column. With
  // 4 suppliers per page and a full-width description band this almost never bites.
  const fitSize = (s: string, f: PDFFont, target: number, min: number, maxW: number): number => {
    let widest = 0;
    for (const t of String(s ?? '').split(/\s+/)) {
      if (t) widest = Math.max(widest, f.widthOfTextAtSize(t, target));
    }
    if (widest <= maxW || widest === 0) return target;
    return Math.max(min, Math.floor(target * (maxW / widest) * 10) / 10);
  };

  /** Lines + the size they render at, for a cell of width `w`. */
  const layout = (s: string, w: number, target = CELL_TARGET, f: PDFFont = font) => {
    const size = fitSize(s, f, target, CELL_MIN, textW(w));
    const lines = wrapWords(s, f, size, textW(w));
    return { size, lines, text: lines.join('\n'), h: cellH(lines.length, size) };
  };

  const bottomLimit = M + FOOTER_H;
  const fits = (h: number) => cursor - h >= bottomLimit;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    cursor = PAGE_H - M;
  };

  // ── Title + meta block (page 1 only) ──
  const title = 'TECHNICAL APPROVAL FORM';
  text(title, (PAGE_W - bold.widthOfTextAtSize(title, 13)) / 2, cursor, 13, bold);
  cursor -= 17;

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

  // ── PR Description — the requisition's own subject, in full ──
  {
    const prLabel = 'PR Description:';
    const plw = bold.widthOfTextAtSize(prLabel, 7.5) + 5;
    const lay = layout(prSubject, CONTENT_W - plw - 3, 8.5);
    const h = Math.max(18, lay.h);
    box(M, cursor, CONTENT_W, h);
    centerText(prLabel, M + 3, cursor, h, 7.5, bold);
    field('pr_description', M + plw, cursor, CONTENT_W - plw - 1, h, lay.text, {
      size: lay.size,
      multiline: true,
    });
    cursor -= h + 4;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Supplier groups — at most 4 columns per page
  // ════════════════════════════════════════════════════════════════════════
  for (const [gi, group] of groups.entries()) {
    const n = group.length;
    const fixedW = IDX_W + QTY_L_W + UOM_W;
    const descLW = Math.min(DESC_MAX, Math.max(DESC_MIN, CONTENT_W - fixedW - n * SUP_W_STD));
    const leftW = fixedW + descLW;
    const supW = (CONTENT_W - leftW) / n;
    // The unit-price sub-column is sized so "SAR 10.36 / USD 2.76" sits on ONE
    // legible line; Qty only ever holds a number.
    const priceW = supW * 0.66;
    const qtyW = supW - priceW;
    const rangeLabel = `Suppliers ${group[0].colIndex + 1}-${group[n - 1].colIndex + 1} of ${totalSuppliers}`;

    // Header band for this group: supplier name/ref, then the stacked sub-labels.
    const nameSize = 8.5;
    const refSize = 6.5;
    const nameLines = group.map((s) => wrapWords(s.supplier, bold, nameSize, textW(supW)));
    const nameH = cellH(Math.max(...nameLines.map((l) => l.length)), nameSize);
    const refH = cellH(1, refSize);
    const headH1 = nameH + refH;
    const headH2 = 11; // "Item Quoted"
    const headH3 = 11; // Qty | Unit Price
    const headH = headH1 + headH2 + headH3;
    const subSize = Math.min(7, fitSize('Unit Price (SAR / USD)', bold, 7, 5, textW(priceW)));

    const drawHeader = (continued: boolean) => {
      // "Suppliers 1-4 of 5" band — always shown when the form is paginated.
      if (groups.length > 1) {
        const label = continued ? `${rangeLabel} (continued)` : rangeLabel;
        text(label, M, cursor, 9, bold, INK);
        cursor -= 13;
      }
      const top = cursor;
      headBox(M, top, IDX_W, headH);
      centerText('#', M + 6, top, headH, 8, bold);
      headBox(M + IDX_W, top, descLW, headH);
      centerText(model.hasPr ? 'PR Item Description' : 'Item Description', M + IDX_W + 5, top, headH, 8.5, bold);
      headBox(M + IDX_W + descLW, top, QTY_L_W, headH);
      centerText('Qty', M + IDX_W + descLW + 9, top, headH, 8, bold);
      headBox(M + IDX_W + descLW + QTY_L_W, top, UOM_W, headH);
      centerText('UOM', M + IDX_W + descLW + QTY_L_W + 5, top, headH, 8, bold);

      group.forEach((sup, i) => {
        const x = M + leftW + i * supW;
        headBox(x, top, supW, headH1);
        field(`sup_name.${sup.colIndex}`, x, top, supW, nameH, nameLines[i].join('\n'), {
          size: nameSize, multiline: true, f: bold,
        });
        field(`sup_ref.${sup.colIndex}`, x, top - nameH, supW, refH,
          sup.reference ? `REF# ${sup.reference}` : 'REF# —', { size: refSize, color: MUTED });
        // Sub-band 1: the quoted item description spans the FULL supplier column,
        // which is what lets a long part code render whole at ~8pt.
        headBox(x, top - headH1, supW, headH2);
        centerText('Item Quoted', x + 3, top - headH1, headH2, subSize, bold, MUTED);
        // Sub-band 2: Qty | Unit Price
        headBox(x, top - headH1 - headH2, qtyW, headH3);
        centerText('Qty', x + 3, top - headH1 - headH2, headH3, subSize, bold, MUTED);
        headBox(x + qtyW, top - headH1 - headH2, priceW, headH3);
        centerText('Unit Price (SAR / USD)', x + qtyW + 3, top - headH1 - headH2, headH3, subSize, bold, MUTED);
      });
      cursor -= headH;
    };

    // A new supplier group always starts its own page; the very first group
    // continues under the meta block on page 1.
    if (gi > 0) newPage();
    drawHeader(false);

    /** Break to a fresh page, repeating this group's header band, when `h` won't fit. */
    const ensureRow = (h: number) => {
      if (!fits(h)) {
        newPage();
        drawHeader(true);
      }
    };

    // ── Item rows ──
    for (const r of model.rows) {
      const rowKey = r.kind === 'charge' ? `c${r.index}` : `${r.index}`;
      const prLabelText = `${r.label}${r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}`;
      const left = layout(prLabelText, descLW, 8);

      const cells = group.map((sup) => {
        const cell = r.cells[sup.colIndex] ?? null;
        const notQuoted = !cell && r.kind !== 'charge';
        const descVal = cell?.description ?? (notQuoted ? 'Not Quoted' : '');
        const desc = layout(descVal, supW, CELL_TARGET, notQuoted ? oblique : font);
        // "Quoted · spec differs" is a STATUS label (indigo/italic), not a
        // best-value highlight — it keeps its own line under the description.
        const noteVal = cell?.matchState === 'quoted_spec_diff' ? specDiffLabel(cell.specDiffNote) : '';
        const note = noteVal ? layout(noteVal, supW, 6.5, oblique) : null;
        let priceVal = '';
        if (cell && cell.unitPrice != null) {
          const sar = fx ? toSar(cell.unitPrice, cell.currency, fx) : null;
          const usd = fx ? toUsd(cell.unitPrice, cell.currency, fx) : null;
          priceVal =
            sar != null && usd != null
              ? `SAR ${money2(sar)} / USD ${money2(usd)}`
              : `${cell.currency} ${money2(cell.unitPrice)}`;
        }
        const price = layout(priceVal, priceW, CELL_TARGET);
        const qtyStr = cell ? plain(cell.qty) : '';
        const qty = layout(qtyStr, qtyW, CELL_TARGET);
        return {
          sup, cell, notQuoted, desc, note, price, qty,
          descBand: desc.h + (note?.h ?? 0),
          valueBand: Math.max(price.h, qty.h),
        };
      });

      const descBandH = Math.max(...cells.map((c) => c.descBand), cellH(1, CELL_TARGET));
      const valueBandH = Math.max(...cells.map((c) => c.valueBand), cellH(1, CELL_TARGET));
      const rowH = Math.max(left.h, descBandH + valueBandH, 26);
      // Any slack goes to the description band so the Qty/Unit-Price divider lines
      // up horizontally across every supplier column.
      const descH = rowH - valueBandH;
      ensureRow(rowH);
      const yTop = cursor;

      box(M, yTop, IDX_W, rowH);
      if (r.kind !== 'charge') centerText(String(r.index), M + 6, yTop, rowH, 8, font);
      box(M + IDX_W, yTop, descLW, rowH);
      field(`pr_item_desc.${rowKey}`, M + IDX_W, yTop, descLW, rowH, left.text, { size: left.size, multiline: true });
      box(M + IDX_W + descLW, yTop, QTY_L_W, rowH);
      const prQtyStr = plain(r.qty);
      field(`pr_item_qty.${rowKey}`, M + IDX_W + descLW, yTop, QTY_L_W, rowH, prQtyStr, {
        size: fitSize(prQtyStr, font, 8, CELL_MIN, textW(QTY_L_W)), align: TextAlignment.Center,
      });
      box(M + IDX_W + descLW + QTY_L_W, yTop, UOM_W, rowH);
      field(`pr_item_uom.${rowKey}`, M + IDX_W + descLW + QTY_L_W, yTop, UOM_W, rowH, r.uom ?? '', {
        size: 8, align: TextAlignment.Center,
      });

      cells.forEach((c, i) => {
        const x = M + leftW + i * supW;
        box(x, yTop, supW, descH);
        // The description keeps its natural height and the "spec differs" status
        // sits DIRECTLY under it (not pinned to the bottom of a taller band), so
        // neither is ever clipped and the pair reads as one statement.
        field(`cell_desc.${rowKey}.s${c.sup.colIndex}`, x, yTop, supW, c.note ? c.desc.h : descH, c.desc.text, {
          size: c.desc.size, multiline: true, f: c.notQuoted ? oblique : font, color: c.notQuoted ? MUTED : INK,
        });
        if (c.note) {
          field(`cell_spec_note.${rowKey}.s${c.sup.colIndex}`, x, yTop - c.desc.h, supW, c.note.h, c.note.text, {
            size: c.note.size, multiline: true, f: oblique, color: AI_INK,
          });
        }
        const vTop = yTop - descH;
        box(x, vTop, qtyW, valueBandH);
        field(`cell_qty.${rowKey}.s${c.sup.colIndex}`, x, vTop, qtyW, valueBandH, c.qty.text, {
          size: c.qty.size, align: TextAlignment.Center,
        });
        box(x + qtyW, vTop, priceW, valueBandH);
        field(`cell_price.${rowKey}.s${c.sup.colIndex}`, x + qtyW, vTop, priceW, valueBandH, c.price.text, {
          size: c.price.size, multiline: true, align: TextAlignment.Right,
        });
      });
      cursor -= rowH;
    }

    // ── Term rows — repeated on EVERY supplier page, for that page's suppliers ──
    // Totals keep the supplier's ORIGINAL currency plus the SAR conversion — but a
    // supplier that already quotes in SAR is shown once, never "SAR x / SAR x".
    const totalText = (amount: number, currency: string) => {
      const own = `${currency} ${money2(amount)}`;
      if (currency.toUpperCase() === 'SAR' || !fx) return own;
      const sar = toSar(amount, currency, fx);
      return sar != null ? `${own} / SAR ${money2(sar)}` : own;
    };
    const terms: { label: string; valueFor: (q: ExtractedQuotation) => string; f?: PDFFont }[] = [
      { label: 'Total Price without VAT', valueFor: (q) => (q.totalCost == null ? '' : totalText(q.totalCost, q.currency)) },
      ...(showVat
        ? [{
            label: 'Total Price with VAT',
            valueFor: (q: ExtractedQuotation) => { const v = withVatAmount(q); return v == null ? '' : totalText(v, q.currency); },
          }]
        : []),
      { label: 'Payment Terms', valueFor: (q) => q.paymentTerms ?? '' },
      {
        label: 'Delivery Time',
        valueFor: (q) => {
          const raw = q.deliveryRaw?.trim() ?? '';
          if (!raw) return '';
          const hint = deliveryNormalizedHint(q.deliveryRaw, q.deliveryDays);
          return hint ? `${raw} (${hint})` : raw;
        },
      },
      { label: 'Delivery Terms', valueFor: (q) => q.deliveryTerms ?? '' },
      ...(showOrigin ? [{ label: 'Country of Origin', valueFor: (q: ExtractedQuotation) => fieldText(origins, q.id) }] : []),
      ...(showWarranty ? [{ label: 'Warranty', valueFor: (q: ExtractedQuotation) => fieldText(warranties, q.id) }] : []),
      // Technical Comments — AI-suggested (indigo/italic until a human edits them).
      { label: 'Technical Comments', valueFor: (q) => comments[q.id]?.text ?? '', f: oblique },
    ];

    const measured = terms.map((t) => {
      const f = t.f ?? font;
      const cellsL = group.map((sup) => layout(t.valueFor(qById.get(sup.quotationId)!), supW, CELL_TARGET, f));
      const lbl = layout(t.label, leftW, LABEL_SIZE, bold);
      return { ...t, f, cellsL, lbl, h: Math.max(15, lbl.h, ...cellsL.map((c) => c.h)) };
    });
    // The terms block stays TOGETHER: if it doesn't fit under the item rows it moves
    // whole to a continuation page (which repeats this group's column header), so a
    // page never ends up carrying two orphan term rows.
    ensureRow(measured.reduce((sum, t) => sum + t.h, 0));
    for (const t of measured) {
      const yTop = cursor;
      box(M, yTop, leftW, t.h, HEAD_BG);
      // Row labels wrap rather than ellipsize — "Total Price without VAT",
      // "Country of Origin" & co. are never clipped.
      const yOff = (t.h - t.lbl.lines.length * lineH(t.lbl.size)) / 2;
      t.lbl.lines.forEach((ln, i) => {
        page.drawText(ln, { x: M + 5, y: yTop - yOff - (i + 1) * lineH(t.lbl.size) + t.lbl.size * 0.28, size: t.lbl.size, font: bold, color: INK });
      });
      group.forEach((sup, i) => {
        const x = M + leftW + i * supW;
        box(x, yTop, supW, t.h);
        field(`term.${t.label}.s${sup.colIndex}`, x, yTop, supW, t.h, t.cellsL[i].text, {
          size: t.cellsL[i].size, multiline: true, f: t.f,
        });
      });
      cursor -= t.h;
    }
    cursor -= 6;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Final page only: AI note, Final Recommendation, signature blocks
  // ════════════════════════════════════════════════════════════════════════
  const ensure = (h: number) => { if (!fits(h)) newPage(); };

  if (ai) {
    const aiLines = wrapWords(ai, oblique, 7, CONTENT_W - 12);
    const h = 12 + aiLines.length * lineH(7) + 4;
    ensure(h);
    page.drawRectangle({ x: M, y: cursor - h, width: CONTENT_W, height: h, borderWidth: 0.75, borderColor: AI_INK, color: AI_BG });
    text('AI SUGGESTED — system-generated, NOT an approval', M + 6, cursor - 3, 6, bold, AI_INK);
    aiLines.forEach((ln, i) => text(ln, M + 6, cursor - 12 - i * lineH(7), 7, oblique, AI_INK));
    cursor -= h + 6;
  }

  {
    const h = 16;
    ensure(h);
    const yTop = cursor;
    const lbl = 'Final Recommendation:';
    centerText(lbl, M, yTop, h, 8, bold);
    const lw = bold.widthOfTextAtSize(lbl, 8) + 6;
    field('final_recommendation', M + lw, yTop, CONTENT_W - lw, h, selectedSupplier ? `${selectedSupplier} (selected by reviewer)` : '', { size: 8 });
    cursor -= h + 8;
  }

  // ── Signature / approval blocks (the company's six, unchanged) ──
  // Laid out in a single row when they fit at a workable width, so the approval
  // strip stays on the final page instead of spilling onto one of its own.
  const gap = 6;
  const perRow = (CONTENT_W - (roles.length - 1) * gap) / Math.max(roles.length, 1) >= 118 ? roles.length : 3;
  const blockW = (CONTENT_W - (perRow - 1) * gap) / perRow;
  const roleSize = 6.5;
  const roleLines = roles.map((r) => wrapWords(r, bold, roleSize, blockW - 10).slice(0, 2));
  const roleH = Math.max(...roleLines.map((l) => l.length)) * lineH(roleSize);
  const blockH = 46 + roleH;
  roles.forEach((_role, i) => {
    const col = i % perRow;
    if (col === 0) ensure(blockH + 4);
    const x = M + col * (blockW + gap);
    const yTop = cursor;
    page.drawRectangle({ x, y: yTop - blockH, width: blockW, height: blockH, borderWidth: 0.75, borderColor: LINE });
    roleLines[i].forEach((ln, k) => text(ln, x + 5, yTop - 3 - k * lineH(roleSize), roleSize, bold));
    const cy = yTop - roleH - 8;
    checkbox(`approved.${i}`, x + 5, cy, 8);
    text('Approved', x + 16, cy - 1, 6.5, font);
    checkbox(`denied.${i}`, x + blockW / 2 + 4, cy, 8);
    text('Denied', x + blockW / 2 + 15, cy - 1, 6.5, font);
    text('Signature:', x + 5, yTop - roleH - 22, 6.5, font, MUTED);
    field(`signature.${i}`, x + 42, yTop - roleH - 16, blockW - 47, 12, '', { size: 6.5 });
    text('Date:', x + 5, yTop - roleH - 36, 6.5, font, MUTED);
    field(`sig_date.${i}`, x + 42, yTop - roleH - 30, blockW - 47, 12, '', { size: 6.5 });
    if (col === perRow - 1 || i === roles.length - 1) cursor -= blockH + gap;
  });

  // ── Footer: page number + live FX stamp on every page ──
  const fxLine = fx ? fxStampText(fx, qs.map((q) => q.currency)) : 'Live FX rate unavailable — amounts shown in each supplier’s own currency.';
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Generated by AI Procurement Copilot — ${generatedOn}`, { x: M, y: 12, size: 6, font, color: MUTED });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: (PAGE_W - font.widthOfTextAtSize(pn, 6)) / 2, y: 12, size: 6, font, color: MUTED });
    const w = font.widthOfTextAtSize(fxLine, 6);
    p.drawText(fxLine, { x: PAGE_W - M - w, y: 12, size: 6, font, color: MUTED });
  });

  // Register the standard fonts in the AcroForm Default Resources (/DR) + a default
  // appearance (/DA). WITHOUT this, viewers that re-render field text (macOS
  // Preview / PDFKit in particular) cannot resolve the font each field's /DA names,
  // so they fall back to a ~12pt default — which overflowed the cells and truncated
  // part codes. With /DR present they honour the baked, wrapped layout.
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
