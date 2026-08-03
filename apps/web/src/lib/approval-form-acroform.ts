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
// ── SUPPLIER PAGINATION ────────────────────────────────────────────────────
// A page carries a MAXIMUM of SUPPLIERS_PER_GROUP (4) supplier columns. With 5
// suppliers that is "Suppliers 1-4 of 5" then "Suppliers 5-5 of 5"; with 8 it is
// 1-4 then 5-8. Each supplier page repeats the #, PR Item Description, Qty and UOM
// columns and EVERY term row for the suppliers shown on THAT page. The AI note,
// Final Recommendation and the six signature blocks appear ONCE, on the final page.
//
// Within a page each supplier cell STACKS — the quoted description spans the full
// column width, with Qty and Unit Price on a band beneath it. That is not a style
// choice: at 4 suppliers per A4-landscape page a supplier column is ~140pt, and a
// 30-character part code ("TWS.10(60)-200(140)-45-253MA-C") needs ~134pt at 8.5pt
// type, so it only fits when it owns the full column width. Wrapping is
// whitespace-only, so an identifier is never split.
//
// ── TYPOGRAPHY / LAYOUT ────────────────────────────────────────────────────
// Field text is drawn through a CUSTOM appearance provider (see `field()`) instead
// of pdf-lib's default one. pdf-lib hard-codes 1.2× leading, 1pt padding and
// centred single lines; the provider below gives the document real cell padding,
// 1.35× leading, per-column alignment and vertical centring — the difference
// between a cramped export and a corporate form. Viewers honour the baked
// appearance stream, so this is what the recipient sees.

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  TextAlignment,
  drawTextField,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
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
  type TechnicalComment,
} from './workspace-types';
import type { ApprovalFormOptions } from './approval-form-pdf';

// ── Page geometry ───────────────────────────────────────────────────────────
const PAGE_W = 842; // A4 landscape
const PAGE_H = 595;
const M = 28; // page margin — content never runs to the page edge
const CONTENT_W = PAGE_W - 2 * M;
const FOOTER_H = 26; // reserved strip for the footer / FX stamp on every page

// ── Spacing scale ───────────────────────────────────────────────────────────
const PAD_X = 8; // horizontal cell padding — text never touches a border
const PAD_Y = 6; // vertical cell padding
const LEAD_RATIO = 1.35; // line height, as a multiple of the type size
const ROW_MIN = 28; // minimum table row height
const SECTION_GAP = 18; // space between major blocks
const HEADER_GAP = 12; // space under a section header

// ── Type scale ──────────────────────────────────────────────────────────────
const T_TITLE = 18;
const T_SECTION = 13;
const T_TH = 10; // table column headers
const T_TH_SUB = 8.5; // supplier sub-column headers
const T_SUPPLIER = 11; // supplier name
const T_BODY = 8.5;
const T_BODY_MIN = 7.4; // floor when a long identifier must still fit its column
const T_SECONDARY = 7.5; // quotation refs, status notes, hints
const T_FOOTER = 7;

// ── Colour system: dark blue / dark grey / light grey / soft blue only.
// No bright colours, no gradients, and deliberately NO green — the form never
// highlights a "best" value; the human picks the winner. ──
const C_TITLE = rgb(0.114, 0.184, 0.318); // dark blue
const C_INK = rgb(0.153, 0.169, 0.204); // dark grey — body text
const C_MUTED = rgb(0.443, 0.475, 0.522); // secondary text
const C_BORDER = rgb(0.851, 0.851, 0.851); // #D9D9D9 hairline grid
const C_RULE = rgb(0.706, 0.741, 0.784); // stronger separator
const C_ROW_ALT = rgb(0.98, 0.98, 0.98); // #FAFAFA zebra stripe
const C_TH_BG = rgb(0.914, 0.933, 0.957); // very light blue header band
const C_SUP_BG = rgb(0.961, 0.969, 0.98); // #F5F7FA supplier card header
const C_INPUT_BG = rgb(0.972, 0.980, 0.992); // blank input tint (sign here)
const C_NOTE_BG = rgb(1, 0.976, 0.906); // light yellow AI note
const C_NOTE_BORDER = rgb(0.878, 0.792, 0.541);
const C_NOTE_INK = rgb(0.404, 0.318, 0.09);
const C_SPEC = rgb(0.286, 0.345, 0.616); // corporate indigo — "spec differs" status
const C_WHITE = rgb(1, 1, 1);

// Column geometry. The left block (#, PR Item Description, Qty, UOM) repeats on
// every supplier page; the supplier columns share what is left, at most 4 of them,
// all equal width. The PR-description column is sized to match a supplier column so
// the same long text wraps to the same number of lines on both sides of the table —
// which is what keeps rows from ballooning.
const IDX_W = 24;
const QTY_L_W = 46;
const UOM_W = 36;
const DESC_MIN = 132;
const DESC_MAX = 420; // a short last group widens the PR column instead of leaving a gap

const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US'));

// Compact one-line "spec differs" marker. The matcher's note repeats words the
// label already carries ("grade differs: quoted SS 310 vs PR 253 MA"), which cost
// two or three lines in a supplier cell; this keeps WHAT differs and drops the rest.
function specDiffLabel(note: string | null | undefined): string {
  const detail = (note ?? '')
    .replace(/^\s*(grade|dimension|spec|size)\s+differs\s*[:—-]?\s*/i, '')
    .replace(/^\s*quoted\s+/i, '')
    .replace(/\bvs\s+PR\s+/i, 'vs ')
    .replace(/\s+/g, ' ')
    .trim();
  return detail ? `spec differs: ${detail}` : 'spec differs';
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

type Align = 'left' | 'center' | 'right';

/** Build the Technical Approval Form as a FILLABLE (AcroForm) PDF Blob. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const qs = analysis.quotations;
  const fx = options?.fx !== undefined ? options.fx : await getFxRates();
  const model = buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx });
  const qById = new Map(qs.map((q) => [q.id, q]));
  const comments =
    options?.technicalComments ?? suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition, analysis.quotations);
  const warranties = options?.warranties ?? buildApprovalFields(qs, suggestWarranties(qs));
  const origins = options?.countriesOfOrigin ?? buildApprovalFields(qs, suggestOrigins(qs));
  const showWarranty = qs.some((q) => warranties[q.id]?.enabled);
  const showOrigin = qs.some((q) => origins[q.id]?.enabled);
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

  // Font metrics used to sit a baseline in the middle of its line slot.
  const ASC = font.heightAtSize(1, { descender: false }); // 0.718 for Helvetica
  const FULL = font.heightAtSize(1); // ascender − descender
  const lead = (size: number) => size * LEAD_RATIO;
  const baselineDrop = (size: number) => (lead(size) - FULL * size) / 2 + ASC * size;
  /** Height a cell needs for `lines` lines of `size` type, padding included. */
  const cellH = (lines: number, size: number) => lines * lead(size) + 2 * PAD_Y;
  /** Text width usable inside a cell of width `w`. */
  const textW = (w: number) => w - 2 * PAD_X;

  // ── primitives ────────────────────────────────────────────────────────────
  const rect = (x: number, yTop: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border = C_BORDER) =>
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderWidth: border ? 0.5 : 0, borderColor: border, color: fill });
  const vRule = (x: number, yTop: number, h: number, color = C_RULE, thickness = 0.9) =>
    page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - h }, thickness, color });
  const hRule = (x: number, y: number, w: number, color = C_RULE, thickness = 0.9) =>
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });

  /** A single line of static text on an exact baseline. */
  const textAt = (s: string, x: number, baseline: number, size: number, f: PDFFont, color = C_INK) =>
    page.drawText(s, { x, y: baseline, size, font: f, color });
  /** Baseline that visually centres `size` type on `centerY`. */
  const centerBaseline = (centerY: number, size: number) => centerY - font.heightAtSize(size, { descender: false }) / 2 + 0.02 * size;

  /** Static (non-field) text, laid out with the same padding/leading/alignment rules. */
  const label = (
    lines: string[],
    x: number,
    yTop: number,
    w: number,
    h: number,
    size: number,
    f: PDFFont,
    color = C_INK,
    align: Align = 'left',
  ) => {
    const blockH = lines.length * lead(size);
    const top = yTop - Math.max(PAD_Y, (h - blockH) / 2);
    lines.forEach((t, i) => {
      const lw = f.widthOfTextAtSize(t, size);
      const lx = align === 'right' ? x + w - PAD_X - lw : align === 'center' ? x + (w - lw) / 2 : x + PAD_X;
      page.drawText(t, { x: lx, y: top - i * lead(size) - baselineDrop(size), size, font: f, color });
    });
  };

  /**
   * An editable AcroForm text field whose appearance is drawn by US: real cell
   * padding, 1.35× leading, per-column alignment and vertical centring. pdf-lib's
   * own provider hard-codes 1pt padding and 1.2× leading and centres single lines,
   * which is what made the previous form feel cramped.
   */
  const field = (
    base: string,
    x: number,
    yTop: number,
    w: number,
    h: number,
    lines: string[],
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; align?: Align; bg?: ReturnType<typeof rgb> } = {},
  ) => {
    const f = opts.f ?? font;
    const size = opts.size ?? T_BODY;
    const color = opts.color ?? C_INK;
    const align = opts.align ?? 'left';
    const tf = form.createTextField(nm(base));
    tf.setText(lines.join('\n'));
    tf.enableMultiline(); // also makes a viewer's own re-render top-anchored, not centred
    tf.setAlignment(align === 'right' ? TextAlignment.Right : align === 'center' ? TextAlignment.Center : TextAlignment.Left);
    tf.addToPage(page, {
      x,
      y: yTop - h,
      width: w,
      height: h,
      font: f,
      textColor: color,
      backgroundColor: opts.bg,
      borderWidth: 0,
    });
    tf.setFontSize(size);
    tf.updateAppearances(f, (_field, widget) => {
      const { width, height } = widget.getRectangle();
      const blockH = lines.length * lead(size);
      const top = height - Math.max(PAD_Y, (height - blockH) / 2);
      const textLines = lines.map((t, i) => {
        const lw = f.widthOfTextAtSize(t, size);
        const lx = align === 'right' ? width - PAD_X - lw : align === 'center' ? (width - lw) / 2 : PAD_X;
        return { encoded: f.encodeText(t), x: lx, y: top - i * lead(size) - baselineDrop(size) };
      });
      return drawTextField({
        x: 0,
        y: 0,
        width,
        height,
        borderWidth: 0,
        color: opts.bg,
        borderColor: undefined,
        textLines,
        textColor: color,
        font: f.name,
        fontSize: size,
        padding: 0,
      });
    });
  };

  const checkbox = (base: string, x: number, yTop: number, size: number) => {
    const cb = form.createCheckBox(nm(base));
    cb.addToPage(page, { x, y: yTop - size, width: size, height: size, borderWidth: 0.8, borderColor: C_RULE, backgroundColor: C_WHITE });
  };

  /** Rounded rectangle (SVG path anchored at its TOP-left corner). */
  const roundedRect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    r: number,
    fill: ReturnType<typeof rgb>,
    border?: ReturnType<typeof rgb>,
  ) => {
    const d =
      `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
      `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    page.drawSvgPath(d, { x, y: yTop, color: fill, borderColor: border, borderWidth: border ? 0.8 : 0 });
  };

  // Wrap on WHITESPACE ONLY — never inside a word, so a part code, drawing number
  // or any identifier always stays intact on one line.
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

  // Largest size ≤ target at which the WIDEST single token of `s` fits `maxW`.
  // This is how a long identifier is kept whole without ever being split.
  const fitSize = (s: string, f: PDFFont, target: number, min: number, maxW: number): number => {
    let widest = 0;
    for (const t of String(s ?? '').split(/\s+/)) if (t) widest = Math.max(widest, f.widthOfTextAtSize(t, target));
    if (widest <= maxW || widest === 0) return target;
    return Math.max(min, Math.floor(target * (maxW / widest) * 20) / 20);
  };

  const bottomLimit = M + FOOTER_H;
  const fits = (h: number) => cursor - h >= bottomLimit;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    cursor = PAGE_H - M;
  };

  // ════════════════════════════════════════════════════════════════════════
  // Document header (page 1)
  // ════════════════════════════════════════════════════════════════════════
  {
    const t = 'TECHNICAL APPROVAL FORM';
    page.drawText(t, {
      x: (PAGE_W - bold.widthOfTextAtSize(t, T_TITLE)) / 2,
      y: cursor - T_TITLE,
      size: T_TITLE,
      font: bold,
      color: C_TITLE,
    });
    cursor -= T_TITLE + 8;
    hRule(M, cursor, CONTENT_W, C_TITLE, 1.2);
    cursor -= 14;
  }

  // A caption over its editable value — the meta strip and the PR description. The
  // caption is drawn at an exact baseline and the field box starts BELOW it, so a
  // tinted input never paints over the caption.
  const captionedField = (
    base: string,
    x: number,
    yTop: number,
    w: number,
    caption: string,
    valueLines: string[],
    opts: { size?: number; bg?: ReturnType<typeof rgb>; rows?: number } = {},
  ) => {
    const size = opts.size ?? T_BODY;
    const capH = lead(T_SECONDARY);
    const valueH = Math.max(opts.rows ?? 1, valueLines.length) * lead(size) + 2 * PAD_Y;
    const h = PAD_Y + capH + 2 + valueH;
    rect(x, yTop, w, h, C_WHITE);
    page.drawText(caption, {
      x: x + PAD_X,
      y: yTop - PAD_Y - baselineDrop(T_SECONDARY),
      size: T_SECONDARY,
      font: bold,
      color: C_MUTED,
    });
    field(base, x, yTop - PAD_Y - capH - 2, w, valueH, valueLines, { size, bg: opts.bg });
    return h;
  };

  // Meta strip: caption above value. The PR description takes the wide cell — it is
  // printed verbatim and in full, and wraps rather than being shortened.
  {
    const narrow = CONTENT_W * 0.15;
    const cells = [
      { caption: 'TA DATE', lines: [generatedOn], base: 'ta_date', w: narrow },
      { caption: 'PR NUMBER', lines: [prNumber || '—'], base: 'pr_number', w: narrow },
      { caption: 'GENERATED ON', lines: [generatedOn], base: 'generated_on', w: narrow },
      { caption: 'PR DESCRIPTION', lines: wrapWords(prSubject, font, T_BODY, textW(CONTENT_W * 0.55)), base: 'pr_description', w: CONTENT_W * 0.55 },
    ];
    const rows = Math.max(...cells.map((c) => c.lines.length));
    let x = M;
    let h = 0;
    for (const c of cells) {
      h = captionedField(c.base, x, cursor, c.w, c.caption, c.lines, { rows });
      x += c.w;
    }
    cursor -= h + SECTION_GAP;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Supplier groups — at most 4 columns per page
  // ════════════════════════════════════════════════════════════════════════
  for (const [gi, group] of groups.entries()) {
    const n = group.length;
    const fixedW = IDX_W + QTY_L_W + UOM_W;
    const descLW = Math.min(DESC_MAX, Math.max(DESC_MIN, (CONTENT_W - fixedW) / (n + 1)));
    const leftW = fixedW + descLW;
    const supW = (CONTENT_W - leftW) / n;
    const priceW = Math.min(supW * 0.62, supW - 40);
    const qtyW = supW - priceW;
    const rangeLabel = `Suppliers ${group[0].colIndex + 1}-${group[n - 1].colIndex + 1} of ${totalSuppliers}`;

    // ── ONE type size per column, chosen so the widest identifier in that column
    // fits at the largest size ≤ T_BODY. Uniform per table (rather than per cell)
    // so the page reads as one typographic system. ──
    const widestFit = (values: string[], w: number, f: PDFFont = font) =>
      values.reduce((size, v) => Math.min(size, fitSize(v, f, T_BODY, T_BODY_MIN, textW(w))), T_BODY);
    const leftSize = widestFit(model.rows.map((r) => r.label), descLW);
    const descSize = widestFit(
      model.rows.flatMap((r) => group.map((s) => r.cells[s.colIndex]?.description ?? '')),
      supW,
    );

    // Header band geometry.
    const nameLines = group.map((s) => wrapWords(s.supplier, bold, T_SUPPLIER, textW(supW)));
    const headNameH = Math.max(...nameLines.map((l) => l.length)) * lead(T_SUPPLIER) + lead(T_SECONDARY) + 2 * PAD_Y;
    const headSubH = lead(T_TH_SUB) + 2 * PAD_Y - 2;
    const headPriceH = lead(T_TH_SUB) + 2 * PAD_Y - 2;
    const headH = headNameH + headSubH + headPriceH;

    const drawHeader = (continued: boolean) => {
      label(
        [continued ? `${rangeLabel} (continued)` : rangeLabel],
        M - PAD_X,
        cursor,
        CONTENT_W,
        lead(T_SECTION) + 2,
        T_SECTION,
        bold,
        C_TITLE,
      );
      cursor -= lead(T_SECTION) + HEADER_GAP;

      const top = cursor;
      // Left column headers span the whole band.
      const leftCols: [string, number, number, Align][] = [
        ['#', M, IDX_W, 'center'],
        [model.hasPr ? 'PR ITEM DESCRIPTION' : 'ITEM DESCRIPTION', M + IDX_W, descLW, 'left'],
        ['QTY', M + IDX_W + descLW, QTY_L_W, 'center'],
        ['UOM', M + IDX_W + descLW + QTY_L_W, UOM_W, 'center'],
      ];
      for (const [text, x, w, align] of leftCols) {
        rect(x, top, w, headH, C_TH_BG);
        label(wrapWords(text, bold, T_TH, textW(w)), x, top, w, headH, T_TH, bold, C_TITLE, align);
      }
      // Supplier "cards": name + quotation reference over their own sub-columns.
      group.forEach((sup, i) => {
        const x = M + leftW + i * supW;
        rect(x, top, supW, headNameH, C_SUP_BG);
        const nameH = nameLines[i].length * lead(T_SUPPLIER) + PAD_Y;
        field(`sup_name.${sup.colIndex}`, x, top, supW, nameH, nameLines[i], {
          size: T_SUPPLIER, f: bold, color: C_TITLE,
        });
        field(`sup_ref.${sup.colIndex}`, x, top - nameH, supW, headNameH - nameH, [sup.reference ? `Ref. ${sup.reference}` : 'Ref. —'], {
          size: T_SECONDARY, color: C_MUTED,
        });
        const sub = top - headNameH;
        rect(x, sub, supW, headSubH, C_TH_BG);
        label(['ITEM QUOTED'], x, sub, supW, headSubH, T_TH_SUB, bold, C_TITLE);
        const sub2 = sub - headSubH;
        rect(x, sub2, qtyW, headPriceH, C_TH_BG);
        label(['QTY'], x, sub2, qtyW, headPriceH, T_TH_SUB, bold, C_TITLE, 'center');
        rect(x + qtyW, sub2, priceW, headPriceH, C_TH_BG);
        label(['UNIT PRICE'], x + qtyW, sub2, priceW, headPriceH, T_TH_SUB, bold, C_TITLE, 'right');
        vRule(x, top, headH);
      });
      vRule(M + leftW, top, headH);
      hRule(M, top - headH, CONTENT_W, C_RULE, 1);
      cursor -= headH;
    };

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
    let stripe = 0;
    for (const r of model.rows) {
      const rowKey = r.kind === 'charge' ? `c${r.index}` : `${r.index}`;
      const leftLines = wrapWords(
        `${r.label}${r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}`,
        font,
        leftSize,
        textW(descLW),
      );

      const cells = group.map((sup) => {
        const cell = r.cells[sup.colIndex] ?? null;
        const notQuoted = !cell && r.kind !== 'charge';
        const descVal = cell?.description ?? (notQuoted ? 'Not Quoted' : '');
        const descLines = wrapWords(descVal, notQuoted ? oblique : font, descSize, textW(supW));
        // "spec differs" is a STATUS marker (indigo/italic), not a best-value
        // highlight — one compact line under the description.
        const noteVal = cell?.matchState === 'quoted_spec_diff' ? specDiffLabel(cell.specDiffNote) : '';
        const noteSize = noteVal ? fitSize(noteVal, oblique, T_SECONDARY, 6, textW(supW)) : T_SECONDARY;
        const noteLines = noteVal ? wrapWords(noteVal, oblique, noteSize, textW(supW)) : [];
        let priceVal = '';
        if (cell && cell.unitPrice != null) {
          const sar = fx ? toSar(cell.unitPrice, cell.currency, fx) : null;
          const usd = fx ? toUsd(cell.unitPrice, cell.currency, fx) : null;
          priceVal =
            sar != null && usd != null
              ? `SAR ${money2(sar)} / USD ${money2(usd)}`
              : `${cell.currency} ${money2(cell.unitPrice)}`;
        }
        const priceSize = fitSize(priceVal, font, T_BODY, T_BODY_MIN, textW(priceW));
        const priceLines = wrapWords(priceVal, font, priceSize, textW(priceW));
        // The description and its status marker form ONE stack: padding above the
        // description, one pad between the two, one below — so neither is ever
        // clipped and the pair reads as a single statement.
        const noteH = noteLines.length ? noteLines.length * lead(noteSize) + 2 * PAD_Y : 0;
        const descFieldH = descLines.length * lead(descSize) + (noteH ? PAD_Y : 2 * PAD_Y);
        return {
          sup, cell, notQuoted, descLines, noteLines, noteSize, priceLines, priceSize,
          qtyLines: [cell ? plain(cell.qty) : ''],
          noteH, descFieldH, stackH: descFieldH + noteH,
        };
      });

      const descBandH = Math.max(...cells.map((c) => c.stackH), cellH(1, descSize));
      const valueBandH = Math.max(...cells.map((c) => c.priceLines.length * lead(c.priceSize)), lead(T_BODY)) + 2 * PAD_Y;
      const rowH = Math.max(cellH(leftLines.length, leftSize), descBandH + valueBandH, ROW_MIN);
      // Slack goes to the description band so the Qty/Unit-Price divider lines up
      // horizontally across every supplier column.
      const descH = rowH - valueBandH;
      ensureRow(rowH);
      const yTop = cursor;
      const bg = stripe++ % 2 === 1 ? C_ROW_ALT : C_WHITE;

      rect(M, yTop, IDX_W, rowH, bg);
      if (r.kind !== 'charge') label([String(r.index)], M, yTop, IDX_W, rowH, T_BODY, font, C_MUTED, 'center');
      rect(M + IDX_W, yTop, descLW, rowH, bg);
      field(`pr_item_desc.${rowKey}`, M + IDX_W, yTop, descLW, rowH, leftLines, { size: leftSize });
      rect(M + IDX_W + descLW, yTop, QTY_L_W, rowH, bg);
      field(`pr_item_qty.${rowKey}`, M + IDX_W + descLW, yTop, QTY_L_W, rowH, [plain(r.qty)], { align: 'center' });
      rect(M + IDX_W + descLW + QTY_L_W, yTop, UOM_W, rowH, bg);
      field(`pr_item_uom.${rowKey}`, M + IDX_W + descLW + QTY_L_W, yTop, UOM_W, rowH, [r.uom ?? ''], { align: 'center' });

      cells.forEach((c, i) => {
        const x = M + leftW + i * supW;
        rect(x, yTop, supW, descH, bg);
        // The description + status stack is vertically centred in the band as a unit.
        const stackTop = yTop - Math.max(0, (descH - c.stackH) / 2);
        field(`cell_desc.${rowKey}.s${c.sup.colIndex}`, x, stackTop, supW, c.descFieldH, c.descLines, {
          size: descSize, f: c.notQuoted ? oblique : font, color: c.notQuoted ? C_MUTED : C_INK,
        });
        if (c.noteH) {
          field(`cell_spec_note.${rowKey}.s${c.sup.colIndex}`, x, stackTop - c.descFieldH, supW, c.noteH, c.noteLines, {
            size: c.noteSize, f: oblique, color: C_SPEC,
          });
        }
        const vTop = yTop - descH;
        rect(x, vTop, qtyW, valueBandH, bg);
        field(`cell_qty.${rowKey}.s${c.sup.colIndex}`, x, vTop, qtyW, valueBandH, c.qtyLines, { align: 'center' });
        rect(x + qtyW, vTop, priceW, valueBandH, bg);
        field(`cell_price.${rowKey}.s${c.sup.colIndex}`, x + qtyW, vTop, priceW, valueBandH, c.priceLines, {
          size: c.priceSize, align: 'right',
        });
        vRule(x, yTop, rowH, C_BORDER, 0.5);
      });
      vRule(M + leftW, yTop, rowH);
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
    const terms: { label: string; valueFor: (q: ExtractedQuotation) => string; align?: Align; f?: PDFFont }[] = [
      // The ONLY total the TA form carries — the with-VAT row was removed from every
      // build of this form (see approval-form-pdf.tsx for the reasoning). VAT is a
      // pass-through that applies identically to whichever offer wins, so it was
      // never a differentiator, and printing both totals put a with-VAT figure next
      // to a without-VAT one where a signer could read the wrong row.
      { label: 'Total Price without VAT', valueFor: (q) => (q.totalCost == null ? '' : totalText(q.totalCost, q.currency)), align: 'right' },
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
      // Technical Comments — AI-suggested (italic until a human edits them).
      { label: 'Technical Comments', valueFor: (q) => comments[q.id]?.text ?? '', f: oblique },
    ];

    const measured = terms.map((t) => {
      const f = t.f ?? font;
      const cellsL = group.map((sup) => wrapWords(t.valueFor(qById.get(sup.quotationId)!), f, T_BODY, textW(supW)));
      const lbl = wrapWords(t.label, bold, T_BODY, textW(leftW));
      return {
        ...t, f, cellsL, lbl,
        h: Math.max(ROW_MIN, cellH(lbl.length, T_BODY), ...cellsL.map((l) => cellH(l.length, T_BODY))),
      };
    });
    // The terms block stays TOGETHER: if it doesn't fit under the item rows it moves
    // whole to a continuation page (which repeats this group's column header).
    ensureRow(measured.reduce((sum, t) => sum + t.h, 0));
    hRule(M, cursor, CONTENT_W, C_RULE, 1);
    for (const t of measured) {
      const yTop = cursor;
      const bg = stripe++ % 2 === 1 ? C_ROW_ALT : C_WHITE;
      rect(M, yTop, leftW, t.h, C_TH_BG);
      // Row labels wrap rather than ellipsize — never clipped, always bold.
      label(t.lbl, M, yTop, leftW, t.h, T_BODY, bold, C_TITLE);
      group.forEach((sup, i) => {
        const x = M + leftW + i * supW;
        rect(x, yTop, supW, t.h, bg);
        field(`term.${t.label}.s${sup.colIndex}`, x, yTop, supW, t.h, t.cellsL[i], {
          size: T_BODY, f: t.f, align: t.align ?? 'left',
        });
        vRule(x, yTop, t.h, C_BORDER, 0.5);
      });
      vRule(M + leftW, yTop, t.h);
      cursor -= t.h;
    }
    hRule(M, cursor, CONTENT_W, C_RULE, 1);
    cursor -= SECTION_GAP;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Final page only: AI note, Final Recommendation, approvals
  // ════════════════════════════════════════════════════════════════════════
  const ensure = (h: number) => { if (!fits(h)) newPage(); };

  if (ai) {
    const inset = 30; // room for the badge
    const lines = wrapWords(ai, oblique, T_BODY, CONTENT_W - inset - PAD_X * 2);
    const h = lead(T_SECONDARY) + lines.length * lead(T_BODY) + 2 * PAD_Y + 4;
    ensure(h + 8);
    roundedRect(M, cursor, CONTENT_W, h, 4, C_NOTE_BG, C_NOTE_BORDER);
    // Small "i" badge.
    page.drawCircle({ x: M + 16, y: cursor - 15, size: 6.5, borderWidth: 0.8, borderColor: C_NOTE_INK, color: C_NOTE_BG });
    page.drawText('i', { x: M + 14.7, y: cursor - 18, size: 7.5, font: bold, color: C_NOTE_INK });
    label(['AI SUGGESTED — system-generated, NOT an approval'], M + inset, cursor - PAD_Y + 2, CONTENT_W - inset, lead(T_SECONDARY), T_SECONDARY, bold, C_NOTE_INK);
    label(lines, M + inset, cursor - PAD_Y - lead(T_SECONDARY) + 2, CONTENT_W - inset, lines.length * lead(T_BODY), T_BODY, oblique, C_NOTE_INK);
    cursor -= h + SECTION_GAP;
  }

  // Final Recommendation — high-priority, so it gets a captioned input line.
  {
    const h = PAD_Y + lead(T_SECONDARY) + 2 + lead(T_TH) + 2 * PAD_Y;
    ensure(h + 8);
    const top = cursor;
    cursor -= captionedField(
      'final_recommendation', M, cursor, CONTENT_W, 'FINAL RECOMMENDATION',
      [selectedSupplier ? `${selectedSupplier} (selected by reviewer)` : ''],
      { size: T_TH, bg: C_INPUT_BG },
    );
    hRule(M, cursor, CONTENT_W, C_RULE, 0.8);
    void top;
    cursor -= SECTION_GAP;
  }

  // ── Approval blocks (the company's six, unchanged) ──
  {
    const gap = 10;
    const perRow = 3;
    const blockW = (CONTENT_W - (perRow - 1) * gap) / perRow;
    const roleLines = roles.map((r) => wrapWords(r, bold, T_TH, blockW - 2 * PAD_X).slice(0, 2));
    const roleH = Math.max(...roleLines.map((l) => l.length)) * lead(T_TH);
    const headerH = roleH + 2 * PAD_Y;
    const BOX = 11; // Approved / Denied checkbox
    const CHECK_H = 22; // checkbox row
    const LINE_H = 24; // signature / date rows — a generous area to sign in
    const blockH = headerH + PAD_Y + CHECK_H + 2 * LINE_H + PAD_Y;

    // The section header never strands itself at the foot of a page.
    ensure(lead(T_SECTION) + HEADER_GAP + blockH + 6);
    label(['APPROVALS'], M - PAD_X, cursor, CONTENT_W, lead(T_SECTION) + 2, T_SECTION, bold, C_TITLE);
    cursor -= lead(T_SECTION) + HEADER_GAP;

    roles.forEach((_role, i) => {
      const col = i % perRow;
      if (col === 0) ensure(blockH + 6);
      const x = M + col * (blockW + gap);
      const yTop = cursor;
      rect(x, yTop, blockW, blockH, C_WHITE, C_RULE);
      rect(x, yTop, blockW, headerH, C_SUP_BG, C_BORDER);
      label(roleLines[i], x, yTop, blockW, headerH, T_TH, bold, C_TITLE);

      // Approved / Denied, checkbox and caption on one baseline.
      const cbTop = yTop - headerH - PAD_Y - (CHECK_H - BOX) / 2;
      const capBase = centerBaseline(cbTop - BOX / 2, T_BODY);
      checkbox(`approved.${i}`, x + PAD_X, cbTop, BOX);
      textAt('Approved', x + PAD_X + BOX + 5, capBase, T_BODY, font);
      checkbox(`denied.${i}`, x + blockW / 2 + PAD_X, cbTop, BOX);
      textAt('Denied', x + blockW / 2 + PAD_X + BOX + 5, capBase, T_BODY, font);

      // Signature / Date: caption on the left, ruled input to the right.
      const lw = 54;
      const inputW = blockW - lw - PAD_X;
      const rows: [string, string][] = [['Signature', `signature.${i}`], ['Date', `sig_date.${i}`]];
      rows.forEach(([caption, base], k) => {
        const top = yTop - headerH - PAD_Y - CHECK_H - k * LINE_H;
        textAt(caption, x + PAD_X, centerBaseline(top - LINE_H / 2, T_SECONDARY), T_SECONDARY, font, C_MUTED);
        field(base, x + lw, top, inputW, LINE_H - 4, [''], { size: T_BODY, bg: C_INPUT_BG });
        hRule(x + lw, top - LINE_H + 4, inputW, C_BORDER, 0.6);
      });

      if (col === perRow - 1 || i === roles.length - 1) cursor -= blockH + gap;
    });
  }

  // ── Footer: lowest-priority information, on every page ──
  const fxLine = fx ? fxStampText(fx, qs.map((q) => q.currency)) : 'Live FX rate unavailable — amounts shown in each supplier’s own currency.';
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: PAGE_W - M, y: M + 14 }, thickness: 0.5, color: C_BORDER });
    p.drawText(`Generated by AI Procurement Copilot — ${generatedOn}`, { x: M, y: M, size: T_FOOTER, font, color: C_MUTED });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: (PAGE_W - font.widthOfTextAtSize(pn, T_FOOTER)) / 2, y: M, size: T_FOOTER, font, color: C_MUTED });
    const w = font.widthOfTextAtSize(fxLine, T_FOOTER);
    p.drawText(fxLine, { x: PAGE_W - M - w, y: M, size: T_FOOTER, font, color: C_MUTED });
  });

  // Register the standard fonts in the AcroForm Default Resources (/DR) + a default
  // appearance (/DA), so a viewer that re-renders field text can resolve the font
  // each field's /DA names instead of falling back to a ~12pt default.
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
  acro.dict.set(PDFName.of('DA'), PDFString.of(`0 g /Helvetica ${T_BODY} Tf`));

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
