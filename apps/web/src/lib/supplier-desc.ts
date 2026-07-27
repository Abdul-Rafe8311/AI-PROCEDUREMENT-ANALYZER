// Trims boilerplate from a supplier's quoted description for the Technical
// Approval Form's narrow supplier cells.
//
// A supplier column is 71pt of text at 6.5pt Helvetica — about 22 characters a
// line — and a quoted description runs to 95:
//
//   "Anchor, Corrugated, Type. TWS.10(60)-200(140)-40-253, Material Grade 253 MA.
//    With Plastic Caps."
//
// That wraps to FIVE lines, and react-pdf is already packing optimally: the part
// code alone (87pt) is wider than the column, so no wrapping strategy can do
// better. The only lever is characters.
//
// The opening "Anchor, Corrugated, Type." and closing "With Plastic Caps." are
// boilerplate repeated in every supplier's cell on that row — and the PR Item
// Description column, two columns to the left, already states both. Dropping them
// from the CELL takes the same row to two lines while keeping the part code and
// the grade, which is the field the "spec differs" flag is about.
//
// Nothing is dropped that the row does not already show. Anything unrecognised is
// returned untouched — this never truncates to a character budget.

/** Leading category boilerplate: "Anchor, Corrugated, Type." / "Anchor Corrugated Type:" */
const LEADING = /^\s*anchor[\s,]+corrugated[\s,]*(?:type)?\s*[.:]?\s*/i;

/** Trailing packaging boilerplate: "With Plastic Caps." */
const TRAILING = /[\s,]*with\s+plastic\s+caps\.?\s*$/i;

/**
 * @param full     the supplier's quoted description, verbatim
 * @param prLabel  the PR row's own description — boilerplate is only removed when
 *                 the PR row genuinely carries it, so the cell never loses
 *                 something the row does not already say
 */
export function trimSupplierDescription(full: string, prLabel?: string | null): string {
  const raw = String(full ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const pr = String(prLabel ?? '');

  let out = raw;
  // Only strip what the PR row itself states — otherwise the cell would be the
  // only place that information appeared.
  if (LEADING.test(out) && LEADING.test(pr)) out = out.replace(LEADING, '');
  if (TRAILING.test(out) && TRAILING.test(pr)) out = out.replace(TRAILING, '');

  out = out.replace(/^[\s,.]+/, '').trim();
  // Never hand back less than the part code — if trimming emptied it, keep the
  // original. A blank cell is worse than a crowded one.
  return out.length >= 8 ? out : raw;
}
