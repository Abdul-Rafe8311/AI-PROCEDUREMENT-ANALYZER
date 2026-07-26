// Unit-of-measure normalisation for the comparison grid.
//
// The buyer's PR states each row's unit ("10 Ton", "50,000 Kilogram"). Suppliers
// quote in whatever unit they like: Legion Exim prices per Ton, Siam per Kg, RHI
// per TO, Global Monarch per MT — and Alfran mixes both WITHIN one quotation.
// Printed side by side without normalisation, the columns are not comparable:
//
//   PR row 1 (10 Ton)
//     Legion Exim      qty 10      @ USD   570.00   per Ton  -> line USD  5,700
//     Siam Refractory  qty 10,000  @ USD     1.73   per Kg   -> line USD 17,300
//
// 1.73 next to 570.00 reads as ~300x cheaper. It is 3x MORE expensive. A reviewer
// scanning the row picks the wrong supplier.
//
// So every cell is converted to the PR row's own unit before it is displayed or
// scored: quantity in that unit, price per that unit. The conversion is exact
// (1 Ton = 1000 Kg), and the LINE TOTAL is the invariant — it is the same number
// in either unit, which is what lets a converted column still reconcile against
// the supplier's own stated total.
//
// Nothing is guessed. A unit we do not recognise is reported as unknown and the
// cell is flagged rather than silently converted or silently compared.

/** The dimensions we can convert within. Anything else is not comparable. */
export type UomKind = 'mass' | 'count' | 'unknown';

export interface UomInfo {
  /** canonical display label, e.g. "Ton" / "Kg" / "Set" */
  label: string;
  kind: UomKind;
  /** how many BASE units (kg for mass) one of these is; null when not convertible */
  perBase: number | null;
}

const KG: UomInfo = { label: 'Kg', kind: 'mass', perBase: 1 };
const TON: UomInfo = { label: 'Ton', kind: 'mass', perBase: 1000 };

// Every spelling seen across the real quotations, plus the obvious neighbours.
// TO is RHI's tonne; MT is Global Monarch's metric ton; Kgs/KG/kilogram are Siam,
// Refratechnik and Lilanand.
const ALIASES: Record<string, UomInfo> = {
  kg: KG, kgs: KG, kilo: KG, kilos: KG, kilogram: KG, kilograms: KG, kilogramme: KG, kilogrammes: KG,
  t: TON, to: TON, ton: TON, tons: TON, tonne: TON, tonnes: TON, mt: TON, 'm/t': TON, mton: TON,
  'metric ton': TON, 'metric tons': TON, 'metric tonne': TON, 'metric tonnes': TON,
};

const COUNT_ALIASES: Record<string, string> = {
  ea: 'EA', each: 'EA', pc: 'PCS', pcs: 'PCS', piece: 'PCS', pieces: 'PCS', no: 'NO', nos: 'NO',
  unit: 'Unit', units: 'Unit', set: 'Set', sets: 'Set', bag: 'Bag', bags: 'Bag', pack: 'Pack',
};

const clean = (u: string | null | undefined): string =>
  String(u ?? '').toLowerCase().replace(/[().]/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve a written unit to something we can reason about. Never guesses. */
export function parseUom(raw: string | null | undefined): UomInfo {
  const c = clean(raw);
  if (!c) return { label: '', kind: 'unknown', perBase: null };
  if (ALIASES[c]) return ALIASES[c];
  if (COUNT_ALIASES[c]) return { label: COUNT_ALIASES[c], kind: 'count', perBase: null };
  // "1000 KG" (RHI's price basis) and "per ton" style phrasings.
  const per = /^(?:per\s+)?(?:(\d[\d,.]*)\s*)?([a-z/]+)$/.exec(c);
  if (per) {
    const unit = ALIASES[per[2]];
    if (unit) {
      const mult = per[1] ? Number(per[1].replace(/,/g, '')) : 1;
      if (Number.isFinite(mult) && mult > 0) {
        return mult === 1 ? unit : { label: unit.label, kind: 'mass', perBase: unit.perBase! * mult };
      }
    }
  }
  return { label: String(raw ?? '').trim(), kind: 'unknown', perBase: null };
}

/** Can a quantity/price stated in `from` be expressed in `to` exactly? */
export function isConvertible(from: UomInfo, to: UomInfo): boolean {
  return from.kind === 'mass' && to.kind === 'mass' && !!from.perBase && !!to.perBase;
}

/** Multiply a quantity in `from` by this to get the quantity in `to`. */
export function conversionFactor(from: UomInfo, to: UomInfo): number | null {
  return isConvertible(from, to) ? from.perBase! / to.perBase! : null;
}

export type NormalizeStatus =
  /** the quoted qty/price contradicted the line total; price re-derived from it */
  | 'derived-from-total'
  /** already in the PR's unit (or an exact synonym) — nothing changed */
  | 'same'
  /** converted exactly, e.g. Kg -> Ton */
  | 'converted'
  /** the supplier's unit is missing or unrecognised — shown as quoted, flagged */
  | 'unknown-unit'
  /** both units known but not the same dimension (e.g. Set vs Ton) — not comparable */
  | 'incompatible';

export interface NormalizedCell {
  /** quantity expressed in the PR row's unit */
  qty: number | null;
  /** unit price PER the PR row's unit */
  unitPrice: number | null;
  /** qty x unitPrice — invariant under conversion, so it reconciles either way */
  lineTotal: number | null;
  /** the unit everything above is expressed in */
  unit: string;
  status: NormalizeStatus;
  /** the supplier's own unit, kept for the audit trail and the honest label */
  sourceUnit: string;
  sourceQty: number | null;
  sourceUnitPrice: number | null;
}

/**
 * Express one supplier's quoted quantity and unit price in the PR row's unit.
 *
 * The line total is preserved exactly: converting Kg -> Ton multiplies the price
 * by 1000 and divides the quantity by 1000, so qty x price is unchanged. That is
 * deliberate — it is what keeps a normalised column reconcilable against the
 * supplier's own stated total.
 *
 * When the units are not convertible nothing is invented: the quoted figures are
 * returned as-is with a status the UI must surface.
 */
export function normalizeCell(
  quoted: { qty: number | null; unitPrice: number | null; uom: string | null | undefined },
  prUom: string | null | undefined,
  /** the supplier's own stated line total, when it gave one — preferred over qty x price */
  statedLineTotal?: number | null,
): NormalizedCell {
  const from = parseUom(quoted.uom);
  const to = parseUom(prUom);
  const sourceQty = Number.isFinite(quoted.qty as number) ? (quoted.qty as number) : null;
  const sourcePrice = Number.isFinite(quoted.unitPrice as number) ? (quoted.unitPrice as number) : null;
  const stated = Number.isFinite(statedLineTotal as number) ? (statedLineTotal as number) : null;
  const base = {
    sourceUnit: from.label || String(quoted.uom ?? '').trim(),
    sourceQty,
    sourceUnitPrice: sourcePrice,
  };
  const lineOf = (q: number | null, p: number | null) =>
    stated ?? (q != null && p != null ? round2(q * p) : null);

  // No PR unit to normalise to (charge rows, or a PR that states none): leave as quoted.
  if (!to.label) {
    return { qty: sourceQty, unitPrice: sourcePrice, lineTotal: lineOf(sourceQty, sourcePrice), unit: from.label, status: 'same', ...base };
  }
  if (from.kind === 'unknown' || !from.label) {
    return { qty: sourceQty, unitPrice: sourcePrice, lineTotal: lineOf(sourceQty, sourcePrice), unit: from.label, status: 'unknown-unit', ...base };
  }
  if (from.label === to.label) {
    return { qty: sourceQty, unitPrice: sourcePrice, lineTotal: lineOf(sourceQty, sourcePrice), unit: to.label, status: 'same', ...base };
  }
  const factor = conversionFactor(from, to);
  if (factor == null) {
    return { qty: sourceQty, unitPrice: sourcePrice, lineTotal: lineOf(sourceQty, sourcePrice), unit: from.label, status: 'incompatible', ...base };
  }
  const qty = sourceQty != null ? round4(sourceQty * factor) : null;
  // Price moves the opposite way, so the line total is untouched.
  const unitPrice = sourcePrice != null ? round2(sourcePrice / factor) : null;
  return { qty, unitPrice, lineTotal: lineOf(qty, unitPrice), unit: to.label, status: 'converted', ...base };
}

/**
 * Reconcile one line against the total the supplier itself printed for it.
 *
 * Some quotations state a quantity and a unit price that do not multiply out to
 * their own line total — RHI writes "10,000 TO" for ten tonnes (European decimal
 * comma) and Refratechnik pairs a kilogram quantity with a per-tonne price. Taken
 * literally either one is off by 1000x, which would put a wildly wrong figure in
 * a column a buyer is about to compare.
 *
 * The LINE TOTAL is the number the supplier stands behind, so when the two
 * disagree materially the price is re-derived from it over the buyer's own
 * requisitioned quantity. The result always reconciles, and the caller is told it
 * was derived rather than quoted.
 */
export function reconcileToLineTotal(
  cell: NormalizedCell,
  prQty: number | null | undefined,
  statedLineTotal: number | null | undefined,
): NormalizedCell {
  const total = Number.isFinite(statedLineTotal as number) ? (statedLineTotal as number) : null;
  const qty = Number.isFinite(prQty as number) && (prQty as number) > 0 ? (prQty as number) : null;
  if (total == null || qty == null || total === 0) return cell;
  const implied = cell.qty != null && cell.unitPrice != null ? cell.qty * cell.unitPrice : null;
  // Agreement within 1% is ordinary rounding — leave the quoted figures alone.
  if (implied != null && Math.abs(implied - total) <= Math.abs(total) * 0.01) return cell;
  return {
    ...cell,
    qty,
    unitPrice: round2(total / qty),
    lineTotal: round2(total),
    status: 'derived-from-total',
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** A short, honest note for a cell whose unit could not be normalised. */
export function unitWarning(c: NormalizedCell, prUnit: string): string | null {
  if (c.status === 'unknown-unit') {
    return c.sourceUnit
      ? `unit "${c.sourceUnit}" not recognised — shown as quoted, not converted to ${prUnit}`
      : `no unit stated — shown as quoted, not converted to ${prUnit}`;
  }
  if (c.status === 'incompatible') {
    return `quoted per ${c.sourceUnit}, which cannot be converted to ${prUnit} — not comparable`;
  }
  if (c.status === 'derived-from-total') {
    return `quoted ${c.sourceQty ?? '?'} ${c.sourceUnit} @ ${c.sourceUnitPrice ?? '?'} does not multiply out to the line total — price shown is the line total per ${prUnit}`;
  }
  return null;
}
