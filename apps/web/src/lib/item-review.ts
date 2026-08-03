// Reviewer edits to the Technical Approval Form's comparison table.
//
// The form is generated from EXTRACTED data, but the reviewer gets the last word:
// before the PDF is produced they can correct any item description, quantity or
// unit price in the "Prepare the Technical Approval Form" dialog. This module is
// the data model behind that, and it follows the same audit-trail pattern as the
// Technical Comments:
//
//   • the AI/extracted ORIGINAL is always kept alongside the reviewer's EDIT, so a
//     field can say whether it is still the machine's value or a human's, and can
//     always be reset back to the original. The original is never overwritten;
//   • only the EDITS are persisted (small, and they survive a re-extraction);
//   • the PDF renderer prints `edited ?? original`, never the raw extraction when
//     an edit exists.
//
// ── What is NOT editable, and why ──────────────────────────────────────────
// The unit price is edited in the supplier's OWN quoted currency; the SAR / USD
// figures on the form are RECOMPUTED from it at the same live rate the rest of the
// form uses. The reviewer never edits a converted figure directly, so a corrected
// price can never drift out of step with the stamped rate.
//
// A "spec differs" flag — and the "cannot be converted to <unit>" unit warning
// beside it — are the matcher's factual FINDINGS, not values. Editing a
// description never silently clears one; the reviewer has to hide it explicitly,
// per cell, and hiding it changes nothing else on the form (in particular it never
// re-derives the supplier's total — see `editedSuppliers`).
// A row the supplier never quoted stays "Not Quoted" until the reviewer explicitly
// adds a quoted line for it, so an edit can never invent a quotation.
//
// SCORING IS UNAFFECTED. Reviewer edits change the FORM only. Scoring, risks and
// the recommendation stay deterministic and are computed from the extracted values.

import { toUsd, type FxRates } from './fx-rates';
import type { ComparisonModel, ComparisonRow, SupplierCell } from './pr-comparison';
import type { ExtractedQuotation } from './workspace-types';

/** One reviewable value: what the machine produced, and what the human made of it. */
export interface ReviewedValue {
  /** the AI/extracted value — never overwritten, and what "reset" restores */
  original: string;
  /** the reviewer's replacement, or null while untouched */
  edited: string | null;
}

/** What the form should print for a value. */
export const valueOf = (v: ReviewedValue): string => v.edited ?? v.original;
/** True once the reviewer has actually changed it (not merely retyped the same text). */
export const isEdited = (v: ReviewedValue): boolean => v.edited != null && v.edited !== v.original;

/** Every reviewable value of one supplier's cell on one comparison row. */
export interface ReviewedCell {
  rowKey: string;
  rowLabel: string;
  rowIndex: number;
  isCharge: boolean;
  quotationId: string;
  supplier: string;
  /** the supplier's own quoted currency — the unit price is edited in THIS currency */
  currency: string;
  /** the supplier quoted this row in the extracted data */
  quoted: boolean;
  /** the reviewer deliberately added a line for a row the supplier had not quoted */
  added: boolean;
  description: ReviewedValue;
  qty: ReviewedValue;
  /** unit price in `currency`; the form's SAR / USD are derived from this */
  unitPrice: ReviewedValue;
  /** the matcher's finding; stays on the form unless the reviewer clears it */
  specDiffNote: string | null;
  specDiff: boolean;
  specDiffCleared: boolean;
  /** the unit-normalisation warning ("cannot be converted to Each"), when one applies */
  unitWarningNote: string | null;
  unitWarning: boolean;
  unitWarningCleared: boolean;
}

/** The annotation notes a cell can print under its description, each independently hideable. */
export type CellNoteKind = 'specDiff' | 'unitWarning';

/** Does this cell carry that note at all (before any reviewer decision)? */
export const hasNote = (c: ReviewedCell, kind: CellNoteKind): boolean =>
  kind === 'specDiff' ? c.specDiff : c.unitWarning;
/** The note's text, or null when the cell doesn't carry it. */
export const noteText = (c: ReviewedCell, kind: CellNoteKind): string | null =>
  kind === 'specDiff' ? c.specDiffNote : c.unitWarningNote;
/** Has the reviewer hidden that note on this cell? */
export const noteCleared = (c: ReviewedCell, kind: CellNoteKind): boolean =>
  kind === 'specDiff' ? c.specDiffCleared : c.unitWarningCleared;
/** Return a copy of the cell with that note shown/hidden. */
export const withNoteCleared = (c: ReviewedCell, kind: CellNoteKind, cleared: boolean): ReviewedCell =>
  kind === 'specDiff' ? { ...c, specDiffCleared: cleared } : { ...c, unitWarningCleared: cleared };

/** The full review, keyed by `cellKey(rowKey, quotationId)`. */
export type ItemReview = Record<string, ReviewedCell>;

/** Just the reviewer's overrides — this is what gets persisted. */
export interface CellOverride {
  description?: string;
  qty?: string;
  unitPrice?: string;
  specDiffCleared?: boolean;
  unitWarningCleared?: boolean;
  /** the reviewer deliberately turned a "Not Quoted" row into a quoted one */
  added?: boolean;
}
export type ItemReviewStore = Record<string, CellOverride>;

export const rowKeyOf = (r: Pick<ComparisonRow, 'kind' | 'index'>): string =>
  r.kind === 'charge' ? `c${r.index}` : `i${r.index}`;
export const cellKey = (rowKey: string, quotationId: string): string => `${rowKey}::${quotationId}`;

const dec2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('en-US'));

/** Parse a reviewer-typed number, tolerating thousands separators. Blank → null. */
export function parseNum(s: string): number | null {
  const t = String(s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const v = Number(t.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * Build the review model for a comparison model: one entry per (row, supplier),
 * with the extracted originals and any persisted reviewer edits laid on top.
 */
export function buildItemReview(
  model: ComparisonModel,
  quotations: ExtractedQuotation[],
  store: ItemReviewStore = {},
): ItemReview {
  const currencyOf = new Map(quotations.map((q) => [q.id, q.currency]));
  const out: ItemReview = {};
  for (const row of model.rows) {
    const rowKey = rowKeyOf(row);
    model.suppliers.forEach((sup, i) => {
      const cell = row.cells[i] ?? null;
      const k = cellKey(rowKey, sup.quotationId);
      const o = store[k] ?? {};
      const value = (original: string, edited: string | undefined): ReviewedValue => ({
        original,
        edited: edited === undefined ? null : edited,
      });
      out[k] = {
        rowKey,
        rowLabel: row.label,
        rowIndex: row.index,
        isCharge: row.kind === 'charge',
        quotationId: sup.quotationId,
        supplier: sup.supplier,
        currency: (cell?.currency ?? currencyOf.get(sup.quotationId) ?? 'SAR').toUpperCase(),
        quoted: !!cell,
        added: o.added ?? false,
        description: value(cell?.description ?? '', o.description),
        qty: value(plain(cell?.qty), o.qty),
        unitPrice: value(cell?.unitPrice == null ? '' : dec2(cell.unitPrice), o.unitPrice),
        specDiffNote: cell?.specDiffNote ?? null,
        specDiff: cell?.matchState === 'quoted_spec_diff',
        specDiffCleared: o.specDiffCleared ?? false,
        unitWarningNote: cell?.unitWarning ?? null,
        unitWarning: !!cell?.unitWarning,
        unitWarningCleared: o.unitWarningCleared ?? false,
      };
    });
  }
  return out;
}

/** Strip a review back to the overrides worth persisting. */
export function toStore(review: ItemReview): ItemReviewStore {
  const out: ItemReviewStore = {};
  for (const [k, c] of Object.entries(review)) {
    const o: CellOverride = {};
    if (c.description.edited != null) o.description = c.description.edited;
    if (c.qty.edited != null) o.qty = c.qty.edited;
    if (c.unitPrice.edited != null) o.unitPrice = c.unitPrice.edited;
    if (c.specDiffCleared) o.specDiffCleared = true;
    if (c.unitWarningCleared) o.unitWarningCleared = true;
    if (c.added) o.added = true;
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}

/**
 * True when the reviewer changed a PRINTED VALUE (description / qty / unit price)
 * or deliberately added a quoted line. Hiding an annotation note is NOT a value
 * edit — see `cellEdited`.
 */
export const cellValueEdited = (c: ReviewedCell): boolean =>
  isEdited(c.description) || isEdited(c.qty) || isEdited(c.unitPrice) || c.added;

/** True when the reviewer has touched anything in this cell, notes included. */
export const cellEdited = (c: ReviewedCell): boolean =>
  cellValueEdited(c) || c.specDiffCleared || c.unitWarningCleared;

/** How many cells the reviewer has edited. */
export const editedCount = (review: ItemReview): number => Object.values(review).filter(cellEdited).length;

/**
 * Suppliers whose printed VALUES the reviewer changed — the set whose Total Price
 * without VAT gets recomputed. Deliberately keyed on `cellValueEdited`, not
 * `cellEdited`: merely HIDING a "spec differs" / unit-conversion note is an
 * annotation decision and must never silently re-derive a supplier's total from
 * the line items when their quotation states one.
 */
export function editedSuppliers(review: ItemReview): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(review)) if (cellValueEdited(c)) out.add(c.quotationId);
  return out;
}

export interface ReviewedModel {
  model: ComparisonModel;
  /**
   * Total price WITHOUT VAT per supplier, recomputed from the reviewed rows —
   * present only for suppliers the reviewer actually edited. A supplier left
   * untouched keeps its own stated total from the quotation.
   */
  totals: Record<string, number>;
}

/**
 * Fold the reviewer's edits into a comparison model, producing the model the PDF
 * prints. Untouched values pass through exactly as extracted.
 *
 * For any supplier the reviewer edited, the Total Price without VAT is RECOMPUTED
 * from the reviewed rows — quantity × unit price for item rows, plus every charge
 * row's own amount (freight stays its own line AND stays in the total) — so the
 * printed total can never contradict the printed lines.
 */
export function applyItemReview(
  model: ComparisonModel,
  review: ItemReview | undefined,
  fx: FxRates | null,
): ReviewedModel {
  if (!review || !Object.keys(review).length) return { model, totals: {} };
  const touched = editedSuppliers(review);

  const rows = model.rows.map((row) => {
    const rowKey = rowKeyOf(row);
    return {
      ...row,
      cells: row.cells.map((cell, i) => {
        const sup = model.suppliers[i];
        if (!sup) return cell;
        const c = review[cellKey(rowKey, sup.quotationId)];
        if (!c || !cellEdited(c)) return cell;
        // A row the supplier never quoted stays "Not Quoted" until the reviewer
        // deliberately adds a line for it — an edit alone never invents a quote.
        if (!cell && !c.added) return cell;
        // Hiding a note is not a value edit: leave every printed figure exactly as
        // extracted and only carry the reviewer's show/hide decisions through.
        if (!cellValueEdited(c)) {
          return { ...cell!, specDiffCleared: c.specDiffCleared, unitWarningCleared: c.unitWarningCleared };
        }
        const unitPrice = parseNum(valueOf(c.unitPrice));
        const next: SupplierCell = {
          ...(cell ?? {
            description: null,
            qty: null,
            unitPrice: null,
            currency: c.currency,
            unitPriceUsd: null,
            matchState: null,
            specDiffNote: null,
          }),
          description: valueOf(c.description) || null,
          qty: parseNum(valueOf(c.qty)),
          unitPrice,
          // SAR / USD on the form are DERIVED from the edited price at the same live
          // rate the rest of the form uses — never typed in by hand.
          unitPriceUsd: unitPrice != null && fx ? toUsd(unitPrice, c.currency, fx) : null,
          specDiffCleared: c.specDiffCleared,
          unitWarningCleared: c.unitWarningCleared,
        };
        return next;
      }),
    };
  });

  // Recompute Total Price without VAT for every supplier the reviewer touched.
  const totals: Record<string, number> = {};
  model.suppliers.forEach((sup, i) => {
    if (!touched.has(sup.quotationId)) return;
    let sum = 0;
    let any = false;
    for (const row of rows) {
      const cell = row.cells[i];
      if (!cell || cell.unitPrice == null) continue;
      // Charge rows (freight / transport) carry a lump sum, not a unit rate.
      const line = row.kind === 'charge' ? cell.unitPrice : cell.unitPrice * (cell.qty ?? 0);
      if (!Number.isFinite(line)) continue;
      sum += line;
      any = true;
    }
    if (any) totals[sup.quotationId] = Math.round(sum * 100) / 100;
  });

  return { model: { ...model, rows }, totals };
}
