// SINGLE SOURCE OF TRUTH for the Technical Approval Form's page geometry.
//
// Both halves of the form import this module:
//   • approval-form-pdf.tsx  — the react-pdf renderer that draws the layout
//   • approval-form-overlay.ts — the pdf-lib pass that drops editable AcroForm
//     fields on top of the rendered page
//
// Keeping the numbers here is what stops the two drifting apart — changing one
// changes the printed layout.
//
// ── PAPER: A3 LANDSCAPE ────────────────────────────────────────────────────
// The form is printed and signed around a table, so it is laid out for A3, the
// same as the .xlsx export. It was A4 at 6.5pt body text: legible on screen at
// 150% zoom, genuinely hard to read on paper.
//
// The A4 ancestor of each number is kept in a comment so the change stays
// checkable. They are NOT a uniform scale, and the reason is worth knowing:
//
// A3 buys 44% more usable width, but a point is a point — bigger paper does not
// make 6.5pt text more readable, it just leaves room to raise the type. The
// binding constraint on how far it can be raised is the longest UNBREAKABLE token
// on the form: a part code like "TWS.10(60)-200(140)-45-253MA-C" has no space to
// wrap at, and react-pdf does not clip, so a token wider than its column silently
// overruns the column beside it. (At 9.5pt the supplier description was being
// written straight through the quantity column.)
//
// So the type went 6.5 → 8 (+23%), the column widths went up by rather more than
// that, and the extra width was spent where the codes live: the description
// sub-column now takes 58% of a supplier group instead of 50%, and the left block
// gave back width the PR-description column did not need. The result has ~10pt of
// slack on the fixture's worst case rather than a 45pt overrun.
//
// Readability is the tie-breaker, per Farid: prefer a legible sheet over a tight
// one, and let the signature blocks fall to a second page rather than shrink to fit.
//
// NOTE on row geometry: column widths and page padding are static and live here,
// but ROW HEIGHTS are not knowable up front — react-pdf's flexbox engine derives
// them from how each cell's text wrapped. The overlay therefore MEASURES the row
// bands back off the rendered page (see approval-form-overlay.ts) rather than
// guessing them; this module supplies the horizontal half of the grid and the
// wrapping/threshold constants that measurement needs.

/** A3 landscape, in points (420 × 297 mm). react-pdf takes the name; pdf-lib and
 *  the overlay need the numbers. */
export const PAGE_SIZE = 'A3';
export const PAGE_W = 1190.55;
export const PAGE_H = 841.89;

/** Suppliers per stacked block — "Suppliers 1–4 of 5", then 5 wraps to a new block.
 *  Stays at 4 on A3: the cap is what makes a supplier column wide enough to read
 *  (commit 68d1775), and A3 spends its extra width on wider columns, not more. */
export const SUP_PER_GROUP = 4;

/** Page padding (react-pdf `page` style). */
export const PAGE_PAD_X = 20; // A4: 16
export const PAGE_PAD_Y = 18; // A4: 14

/** Landscape A3 usable width (pt) inside the page padding. */
export const USABLE = PAGE_W - 2 * PAGE_PAD_X; // 1150.55 — A4: 797

/**
 * Base type size for table body text — A4: 6.5.
 *
 * 8pt is not a taste call: it is the LARGEST size at which the fixture's longest
 * part code ("TWS.10(60)-200(140)-45-253MA-C", 30 characters with no space to wrap
 * at) still fits BOTH a supplier's description sub-column and the PR Item
 * Description column, at four suppliers to a page. react-pdf does not clip, so a
 * token wider than its column silently overruns the one beside it — at 9.5pt the
 * quantity column was being written through. See the column maths below.
 */
export const FS = 8; // A4: 6.5

/** Leftmost reference columns, in order. Sized so the PR description column holds
 *  the same longest token a supplier column does — it has the identical problem. */
export const IDX_W = 20; // A4: 14
export const PR_DESC_W = 136; // A4: 118 — >= longest unbreakable token at FS
export const QTY_L_W = 28; // A4: 22
export const UOM_W = 30; // A4: 24
export const LEFT_W = IDX_W + PR_DESC_W + QTY_L_W + UOM_W; // 214

/** Cell padding used by `cellBox` / supplier cells. */
export const CELL_PAD_X = 4; // A4: 3
export const CELL_PAD_Y = 3; // A4: 2

/** Fixed width of a supplier's Qty sub-column. Holds "10,000" plus padding. */
export const SUB_QTY_W = 34; // A4: 24

/** Width of ONE supplier column-group for a block of `n` suppliers. */
export const supplierColW = (n: number) => Math.max(180, (USABLE - LEFT_W) / n); // A4 min: 150

/** The three sub-columns inside a supplier column-group. */
export function supplierSubCols(n: number) {
  const supW = supplierColW(n);
  // The description takes 58% rather than the old 50%: it is the sub-column that
  // has to swallow an unbreakable part code, while the price column only ever
  // holds "EUR 3,590.00" and had slack to give.
  const desc = Math.max(136, Math.round(supW * 0.58)); // A4 min: 70
  return { supW, desc, qty: SUB_QTY_W, price: supW - desc - SUB_QTY_W };
}

/**
 * Absolute x-ranges (PDF user space, origin bottom-left) of every cell column for
 * a block of `n` suppliers. `supplier[i]` holds that supplier's three sub-columns.
 */
export function columnRanges(n: number) {
  const { supW, desc, qty, price } = supplierSubCols(n);
  const x0 = PAGE_PAD_X;
  const left = {
    index: { x: x0, w: IDX_W },
    prDesc: { x: x0 + IDX_W, w: PR_DESC_W },
    prQty: { x: x0 + IDX_W + PR_DESC_W, w: QTY_L_W },
    uom: { x: x0 + IDX_W + PR_DESC_W + QTY_L_W, w: UOM_W },
  };
  const supplier = Array.from({ length: n }, (_, i) => {
    const sx = x0 + LEFT_W + i * supW;
    return {
      group: { x: sx, w: supW },
      desc: { x: sx, w: desc },
      qty: { x: sx + desc, w: qty },
      price: { x: sx + desc + qty, w: price },
    };
  });
  return { left, supplier, leftBlock: { x: x0, w: LEFT_W } };
}

/**
 * Vertical gap (pt) that separates one table ROW from the next, as opposed to two
 * wrapped LINES inside one cell. On A4 wrapped lines sat 7.1pt apart, consecutive
 * single-line rows 12.1pt, and wrapped rows 26pt+, so 10pt split them cleanly.
 * Every one of those distances scales with the type, so the threshold scales too.
 */
export const ROW_GAP_THRESHOLD = 12; // A4: 10

/**
 * Type sizes react-pdf uses for the cell contents the overlay makes editable.
 *
 * The overlay identifies a run by matching its size to ±0.3pt, so these must stay
 * mutually distinct by more than 0.6 — `ref` and `priceUsd` are the close pair.
 */
export const TYPE = {
  body: FS, // 8.0 — descriptions, qty, terms
  supplierName: FS + 3, // 11.0 — the column heading: bigger AND bold (A4: FS + 0.5)
  ref: FS - 1, // 7.0 — "REF# 9100147169"
  priceSar: FS, // 8.0 — bold "SAR 10.36" (deliberately equal to body)
  priceUsd: FS - 1.8, // 6.2 — muted secondary currency line
  specDiff: FS - 2.6, // 5.4 — amber italic "spec differs: …" note
} as const;

/** Title / section type, scaled with the rest. */
export const TYPE_TITLE = 16.5; // A4: 11.5
export const TYPE_FOOTER = 7.5; // A4: 6

/** Signature block chrome (react-pdf `signBox` / `signWrap`). */
export const SIGN_BOX_PAD = 7; // A4: 5
export const SIGN_BOX_GAP = 8; // A4: 6
/** Minimum height of one signature block — four stacked lines plus breathing room. */
export const SIGN_BOX_MIN_H = 70; // A4: 48
