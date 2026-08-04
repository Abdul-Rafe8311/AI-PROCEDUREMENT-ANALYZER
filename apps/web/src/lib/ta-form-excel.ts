// Technical Approval Form as an Excel workbook — the same form the PDF renders,
// in the format Farid can edit and circulate.
//
// A PURE function of the analysis plus the Customize options: no AI call, no
// extraction, no database. Both exports are handed the SAME (analysis, options),
// so whatever has been edited in the Customize dialog — technical comments,
// warranty, country of origin, the item review — appears identically in each.
//
// One sheet per supplier group, matching the PDF's pagination: at most
// SUP_PER_GROUP (4) supplier columns each, because that is the cap the PDF uses
// and the two must not disagree about which supplier appears where.
//
// The PDF renderer is untouched by this file.
//
// ── The merged-border rule ──────────────────────────────────────────────────
// ExcelJS applies a style to the top-left cell of a merge only, and Excel then
// draws that range's interior with NO grid lines — merged blocks come out as
// blank gaps punched through the table. Every cell of every merged range is
// therefore styled individually here, the same lesson the tender sheet taught.

import { type FxRates, sarPerUnit, toUsd } from './fx-rates';
import {
  buildApprovalFields,
  resolvePrDescription,
  suggestDeliveryTimes,
  suggestOrigins,
  suggestTechnicalComments,
  suggestWarranties,
} from './item-matching';
import { applyItemReview, valueOf } from './item-review';
import { buildComparisonModel, SUPPLIERS_PER_GROUP, supplierGroups } from './pr-comparison';
import {
  type AnalysisResult,
  type ApprovalFieldValue,
  DEFAULT_SIGNATURE_ROLES,
  deliveryNormalizedHint,
  type ExtractedQuotation,
} from './workspace-types';
import {
  headerLabel,
  resolveMoneyLines,
  TA_CURRENCY_DISPLAY_DEFAULT,
  type TaCurrencySelection,
} from './ta-currency';
import type { ApprovalFormOptions } from './approval-form-pdf';

// ── palette (mirrors the PDF's greys) ──
const HEAD_BG = 'FFE2E8F0'; // header band
const SUP_BG = 'FFEDF2F7'; // supplier name band
const ROW_ALT = 'FFF7FAFC'; // alternating item row
const TERM_BG = 'FFEDF2F7'; // term-row label
const AI_INK = 'FF6366F1'; // AI-suggested comment
const MUTED = 'FF64748B';
const INK = 'FF0F172A';
const BLACK = 'FF000000';
const FONT = 'Arial';

// ── Type scale ──
// The workbook is printed and read across a meeting table, not just scrolled on a
// laptop, so the body is 12pt rather than the 9pt this started at, and it is laid
// out for A3. Everything that derives from the base size (row heights, the title,
// the supplier band) is computed from FS_BODY so the scale stays proportional if
// it is ever changed again.
const FS_BODY = 12; // item text, terms, prices
const FS_TITLE = Math.round(FS_BODY * 1.5); // "TECHNICAL APPROVAL FORM"
const FS_SUPPLIER = FS_BODY + 4; // supplier name band — the column heading
const FS_SUPPLIER_REF = FS_BODY; // its REF# line
/** Points of row height one line of `size` type needs, plus cell padding. */
const lineHeight = (size = FS_BODY) => Math.round(size * 1.35);

// A3 is paperSize 8 in the OOXML spec (ECMA-376 §17.6.2, w:paperSize). ExcelJS's
// own PaperSize enum only declares a handful of sizes and omits A3, so the literal
// is asserted rather than looked up — the number is the spec's, not a guess.
const PAPER_A3 = 8 as unknown as import('exceljs').PaperSize;

const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US'));

function fieldText(map: Record<string, ApprovalFieldValue>, id: string): string {
  const f = map[id];
  return f?.enabled ? f.text?.trim() ?? '' : '';
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

/**
 * A money cell, in whichever currencies the reviewer selected for that part of the
 * form. One shared resolver with the PDF (see ta-currency.ts), so the workbook and
 * the document can never print different currencies for the same figure.
 */
function moneyCell(
  amount: number | null | undefined,
  currency: string,
  fx: FxRates | null,
  selection: TaCurrencySelection,
): string {
  return resolveMoneyLines(amount, currency, fx, selection)
    .map((l) => `${l.code} ${money2(l.amount)}`)
    .join('\n');
}

/** Border every cell of a range — never just the merge anchor. */
function borderRange(
  ws: import('exceljs').Worksheet,
  top: number,
  left: number,
  bottom: number,
  right: number,
  fill?: string,
) {
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: { style: 'thin', color: { argb: BLACK } },
        left: { style: 'thin', color: { argb: BLACK } },
        bottom: { style: 'thin', color: { argb: BLACK } },
        right: { style: 'thin', color: { argb: BLACK } },
      };
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
  }
}

const rowHeight = (texts: string[], size = FS_BODY) =>
  Math.max(lineHeight(size) + 6, Math.max(1, ...texts.map((t) => String(t ?? '').split('\n').length)) * lineHeight(size) + 6);

/**
 * Build the Technical Approval Form workbook from the SAME inputs the PDF
 * renderer receives, so both outputs reflect the same customized state.
 *
 * NOTE: the derivation below deliberately mirrors generateApprovalFormPdf. The
 * PDF is not modified by this file, so the two must be kept in step by hand — if
 * a default changes there, change it here too.
 */
export async function buildTaFormWorkbook(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions & { fx: FxRates | null },
): Promise<import('exceljs').Workbook> {
  const roles = options?.signatureRoles?.length ? options.signatureRoles : DEFAULT_SIGNATURE_ROLES;
  const comments =
    options?.technicalComments ??
    suggestTechnicalComments(analysis.prMatch, analysis.purchaseRequisition, analysis.quotations);
  const warranties =
    options?.warranties ?? buildApprovalFields(analysis.quotations, suggestWarranties(analysis.quotations));
  const origins =
    options?.countriesOfOrigin ?? buildApprovalFields(analysis.quotations, suggestOrigins(analysis.quotations));
  const fx = options?.fx ?? null;

  const qs = analysis.quotations;
  const qById = new Map(qs.map((q) => [q.id, q]));
  const reviewed = applyItemReview(
    buildComparisonModel(qs, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx }),
    options?.itemReview,
    fx,
  );
  const model = reviewed.model;
  const totalOf = (q: ExtractedQuotation) => reviewed.totals[q.id] ?? q.totalCost;

  const deliveries = suggestDeliveryTimes(qs);
  const currencyDisplay = options?.currencyDisplay ?? TA_CURRENCY_DISPLAY_DEFAULT;
  const showWarranty = qs.some((q) => warranties[q.id]?.enabled);
  const showOrigin = qs.some((q) => origins[q.id]?.enabled);

  const pr = analysis.purchaseRequisition;
  const prNumber = pr?.requestNo ?? qs.find((q) => q.prNumber)?.prNumber ?? '';
  // The reviewer's Customize-dialog edits win over the extracted values, exactly as
  // they do on the PDF — the two downloads must never disagree about a name.
  // Clearing the box is respected (matching the PDF); a BLANK supplier name is not,
  // because an unlabelled price column is never what the reviewer meant.
  const prSubject =
    (options?.prDescription ? valueOf(options.prDescription).trim() : resolvePrDescription(pr)) ||
    'Not stated on the requisition';
  const nameOf = (quotationId: string, extracted: string) => {
    const rv = options?.supplierNames?.[quotationId];
    return (rv ? valueOf(rv).trim() : '') || extracted;
  };
  const generatedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const indexed = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed, SUPPLIERS_PER_GROUP);

  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Procurement Copilot';

  groups.forEach((group, gi) => {
    const n = group.length;
    const title =
      groups.length > 1
        ? `Suppliers ${group[0].colIndex + 1}-${group[n - 1].colIndex + 1} of ${model.suppliers.length}`
        : 'Technical Approval Form';
    // A3 landscape, fitted to ONE page wide. The form is printed and signed round a
    // table, so it has to be legible on paper — at 12pt body text the grid no longer
    // fits A4, and letting Excel spill supplier columns onto a second sheet of paper
    // is what makes a comparison form useless. Height is left unbounded (`undefined`)
    // so a long requisition flows onto further pages instead of being scaled to
    // nothing; the header rows repeat on each via `printTitlesRow`.
    const ws = wb.addWorksheet(title.slice(0, 31), {
      pageSetup: {
        paperSize: PAPER_A3,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    const lastCol = 4 + n * 3; // #, PR desc, Qty, UOM, then 3 sub-columns each

    // Column widths scale with the body size — at 12pt the 9pt widths clipped text.
    const w = (chars: number) => Math.round(chars * (FS_BODY / 9));
    ws.columns = [
      { width: w(5) }, // #
      { width: w(44) }, // PR Item Description
      { width: w(10) }, // Qty
      { width: w(8) }, // UOM
      ...group.flatMap(() => [{ width: w(34) }, { width: w(9) }, { width: w(18) }]),
    ];

    let row = 1;
    const put = (
      r: number,
      c: number,
      v: string | number,
      opts: { bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; size?: number } = {},
    ) => {
      const cell = ws.getCell(r, c);
      cell.value = v;
      cell.font = { name: FONT, size: opts.size ?? FS_BODY, bold: !!opts.bold, color: { argb: opts.color ?? INK } };
      cell.alignment = { vertical: 'top', horizontal: opts.align ?? 'left', wrapText: true };
    };

    // ── header block ──
    put(row, 1, 'TECHNICAL APPROVAL FORM', { bold: true, size: FS_TITLE });
    ws.mergeCells(row, 1, row, lastCol);
    borderRange(ws, row, 1, row, lastCol, HEAD_BG);
    ws.getRow(row).height = rowHeight(['x'], FS_TITLE);
    row++;

    for (const [label, value] of [
      ['TA Date', generatedOn],
      ['PR #', prNumber || 'Not provided'],
      ['Generated on', generatedOn],
      ['PR Description', prSubject],
      ['SAR conversion rate', fx ? fxStampText(fx, qs.map((q) => q.currency)) : 'live rate unavailable — amounts in each supplier’s own currency'],
    ] as const) {
      put(row, 1, label, { bold: true });
      ws.mergeCells(row, 1, row, 2);
      put(row, 3, value);
      ws.mergeCells(row, 3, row, lastCol);
      borderRange(ws, row, 1, row, lastCol);
      ws.getRow(row).height = rowHeight([value]);
      row++;
    }
    row++; // spacer

    // ── supplier header band: name+REF# merged over the 3 sub-columns ──
    const bandTop = row;
    put(row, 1, '#', { bold: true, align: 'center' });
    put(row, 2, model.hasPr ? 'PR Item Description' : 'Item Description', { bold: true });
    put(row, 3, 'Qty', { bold: true, align: 'center' });
    put(row, 4, 'UOM', { bold: true, align: 'center' });
    for (const c of [1, 2, 3, 4]) ws.mergeCells(bandTop, c, bandTop + 1, c);
    group.forEach((sup, i) => {
      const c0 = 5 + i * 3;
      // "SUPPLIER #2 — Krosaki" : the number is the supplier's position in the WHOLE
      // analysis, so it survives the 4-per-sheet split and approvers can refer to a
      // column by number across sheets. Set as a rich-text run so the name can be
      // bigger than the body while the REF# line stays small.
      ws.getCell(bandTop, c0).value = {
        richText: [
          {
            text: `SUPPLIER #${sup.colIndex + 1} — ${nameOf(sup.quotationId, sup.supplier)}`,
            font: { name: FONT, size: FS_SUPPLIER, bold: true, color: { argb: INK } },
          },
          {
            text: `\nREF# ${sup.reference ?? '—'}`,
            font: { name: FONT, size: FS_SUPPLIER_REF, bold: false, color: { argb: MUTED } },
          },
        ],
      };
      ws.getCell(bandTop, c0).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      ws.mergeCells(bandTop, c0, bandTop, c0 + 2);
      put(bandTop + 1, c0, 'Description', { bold: true });
      put(bandTop + 1, c0 + 1, 'Qty', { bold: true, align: 'center' });
      // The sub-header names whatever this column ACTUALLY prints: the supplier's
      // own quoted currency normally, SAR when the reviewer chose a
      // single-currency sheet. Never a EUR heading over SAR figures.
      const priceCur = headerLabel(sup.currency, fx, currencyDisplay.lineItems);
      put(bandTop + 1, c0 + 2, `Unit Price (${priceCur})`, { bold: true, align: 'right' });
    });
    borderRange(ws, bandTop, 1, bandTop + 1, lastCol, HEAD_BG);
    // The supplier name band gets its own tint, over its whole merged width.
    group.forEach((_s, i) => borderRange(ws, bandTop, 5 + i * 3, bandTop, 7 + i * 3, SUP_BG));
    // Two lines of the LARGER supplier type, so the band reads as a column heading.
    ws.getRow(bandTop).height = rowHeight(['a\nb'], FS_SUPPLIER);
    ws.getRow(bandTop + 1).height = rowHeight(['x']);
    // Repeat the left reference columns + this band on every printed page.
    ws.pageSetup.printTitlesRow = `${bandTop}:${bandTop + 1}`;
    row = bandTop + 2;

    // ── item rows ──
    model.rows.forEach((r, idx) => {
      const texts: string[] = [];
      put(row, 1, r.kind === 'charge' ? '' : r.index, { align: 'center' });
      const label = `${r.label}${r.kind === 'charge' ? `  [${r.category.toUpperCase()}]` : ''}`;
      put(row, 2, label);
      put(row, 3, plain(r.qty), { align: 'center' });
      put(row, 4, r.uom ?? '', { align: 'center' });
      texts.push(label);
      group.forEach((sup, i) => {
        const cell = r.cells[sup.colIndex] ?? null;
        const notQuoted = !cell && r.kind !== 'charge';
        const desc = cell?.description ?? (notQuoted ? 'Not Quoted' : '');
        const note = cell?.matchState === 'quoted_spec_diff' && !cell.specDiffCleared
          ? `\nspec differs${cell.specDiffNote ? `: ${cell.specDiffNote}` : ''}`
          : '';
        const foc = cell?.foc ? '\nFOC — supplied free of charge' : '';
        const c0 = 5 + i * 3;
        put(row, c0, `${desc}${note}${foc}`, { color: notQuoted ? MUTED : INK });
        put(row, c0 + 1, cell ? plain(cell.qty) : '', { align: 'center' });
        // Quoted currency, UNCONVERTED — unless the reviewer chose a
        // single-currency sheet. Only the totals below convert by default.
        const price = cell ? moneyCell(cell.unitPrice, cell.currency, fx, currencyDisplay.lineItems) : '';
        put(row, c0 + 2, price, { align: 'right' });
        texts.push(`${desc}${note}${foc}`, price);
      });
      borderRange(ws, row, 1, row, lastCol, idx % 2 === 1 ? ROW_ALT : undefined);
      ws.getRow(row).height = rowHeight(texts);
      row++;
    });

    // ── term rows ──
    const terms: [string, (q: ExtractedQuotation) => string][] = [
      // The ONLY total the TA form carries — see the PDF renderer for why the
      // with-VAT row was removed. `withVatAmount()` is still exported and correct;
      // it simply is not printed on this form.
      ['Total Price without VAT', (q) => moneyCell(totalOf(q), q.currency, fx, currencyDisplay.totals)],
      ['Payment Terms', (q) => q.paymentTerms ?? ''],
      // Per-item aware: one lead time when the offer shares one, else
      // "Item #1 (2 weeks), Item #2 (6 weeks)".
      ['Delivery Time', (q) => {
        const text = deliveries[q.id] ?? '';
        if (!text || text === 'Not stated') return '';
        if (text !== (q.deliveryRaw?.trim() ?? '')) return text;
        const hint = deliveryNormalizedHint(q.deliveryRaw, q.deliveryDays);
        return hint ? `${text} (${hint})` : text;
      }],
      ['Delivery Terms', (q) => q.deliveryTerms ?? ''],
      ...(showOrigin ? [['Country of Origin', (q: ExtractedQuotation) => fieldText(origins, q.id)] as [string, (q: ExtractedQuotation) => string]] : []),
      ...(showWarranty ? [['Warranty', (q: ExtractedQuotation) => fieldText(warranties, q.id)] as [string, (q: ExtractedQuotation) => string]] : []),
      ['Technical Comments', (q) => comments[q.id]?.text ?? ''],
    ];

    for (const [label, valueFor] of terms) {
      put(row, 1, label, { bold: true });
      ws.mergeCells(row, 1, row, 4);
      const texts = [label];
      group.forEach((sup, i) => {
        const q = qById.get(sup.quotationId)!;
        const v = valueFor(q);
        const c0 = 5 + i * 3;
        const isComment = label === 'Technical Comments';
        put(row, c0, v, {
          color: isComment && comments[q.id]?.aiSuggested ? AI_INK : INK,
          align: label.startsWith('Total Price') ? 'right' : 'left',
        });
        ws.mergeCells(row, c0, row, c0 + 2);
        texts.push(v);
      });
      borderRange(ws, row, 1, row, lastCol, TERM_BG);
      // …then clear the tint from the value cells so only the label band is shaded.
      group.forEach((_s, i) => borderRange(ws, row, 5 + i * 3, row, 7 + i * 3));
      ws.getRow(row).height = rowHeight(texts);
      row++;
    }

    // Freeze the left reference columns and everything down to the sub-header row.
    ws.views = [{ state: 'frozen', xSplit: 4, ySplit: bandTop + 1 }];

    // ── last sheet only: Final Recommendation, signatures, footer ──
    if (gi === groups.length - 1) {
      row++;
      put(row, 1, 'Final Recommendation', { bold: true });
      ws.mergeCells(row, 1, row, 2);
      put(row, 3, options?.selectedSupplier ? `${options.selectedSupplier} (selected by reviewer)` : '');
      ws.mergeCells(row, 3, row, lastCol);
      borderRange(ws, row, 1, row, lastCol);
      ws.getRow(row).height = 20;
      row += 2;

      // Approval blocks — the caller's configured roles, same source as the PDF.
      put(row, 1, 'APPROVALS', { bold: true });
      ws.mergeCells(row, 1, row, lastCol);
      borderRange(ws, row, 1, row, lastCol, HEAD_BG);
      row++;
      for (const [h, c] of [['Role', 1], ['Approved', 3], ['Denied', 4], ['Signature', 5], ['Date', 6]] as const) {
        put(row, c, h, { bold: true, align: c === 1 ? 'left' : 'center' });
      }
      ws.mergeCells(row, 1, row, 2);
      borderRange(ws, row, 1, row, 6, HEAD_BG);
      row++;
      for (const role of roles) {
        put(row, 1, role, { bold: true });
        ws.mergeCells(row, 1, row, 2);
        put(row, 3, '☐', { align: 'center' });
        put(row, 4, '☐', { align: 'center' });
        put(row, 5, '');
        put(row, 6, '');
        borderRange(ws, row, 1, row, 6);
        ws.getRow(row).height = 24;
        row++;
      }
      row++;

      // Footer lines are deliberately NOT merged: a merged range with no borders
      // would breach the invariant every other range here upholds, and a footnote
      // needs no cell of its own — the text simply overflows column A.
      for (const line of [
        `Generated by AI Procurement Copilot — ${generatedOn}`,
        'Auto-filled from extracted data. Blank fields are for manual completion.',
      ]) {
        put(row, 1, line, { color: MUTED });
        ws.getCell(row, 1).alignment = { vertical: 'top', horizontal: 'left', wrapText: false };
        row++;
      }
    }
  });

  return wb;
}

/** The workbook as bytes, ready to stream as a download. */
export async function taFormWorkbookBuffer(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions & { fx: FxRates | null },
): Promise<Buffer> {
  const wb = await buildTaFormWorkbook(analysis, options);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
