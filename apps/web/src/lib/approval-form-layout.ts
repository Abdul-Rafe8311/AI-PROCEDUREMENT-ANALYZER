// SINGLE SOURCE OF TRUTH for the Technical Approval Form's page geometry.
//
// Both halves of the form import this module:
//   • approval-form-pdf.tsx  — the react-pdf renderer that draws the layout
//   • approval-form-overlay.ts — the pdf-lib pass that drops editable AcroForm
//     fields on top of the rendered page
//
// Keeping the numbers here is what stops the two drifting apart. Every value is
// exactly what the react-pdf renderer used before this module existed — changing
// one changes the printed layout, so don't.
//
// NOTE on row geometry: column widths and page padding are static and live here,
// but ROW HEIGHTS are not knowable up front — react-pdf's flexbox engine derives
// them from how each cell's text wrapped. The overlay therefore MEASURES the row
// bands back off the rendered page (see approval-form-overlay.ts) rather than
// guessing them; this module supplies the horizontal half of the grid and the
// wrapping/threshold constants that measurement needs.

/** Suppliers per stacked block — "Suppliers 1–4 of 5", then 5 wraps to page 2. */
export const SUP_PER_GROUP = 4;

/** Landscape A4 usable width (pt) inside the page padding. */
export const USABLE = 797;

/** Page padding (react-pdf `page` style). */
export const PAGE_PAD_X = 16;
export const PAGE_PAD_Y = 14;

/** Base type size for table body text. */
export const FS = 6.5;

/** Leftmost reference columns, in order. */
export const IDX_W = 14;
export const PR_DESC_W = 118;
export const QTY_L_W = 22;
export const UOM_W = 24;
export const LEFT_W = IDX_W + PR_DESC_W + QTY_L_W + UOM_W;

/** Cell padding used by `cellBox` / supplier cells. */
export const CELL_PAD_X = 3;
export const CELL_PAD_Y = 2;

/** Fixed width of a supplier's Qty sub-column. */
export const SUB_QTY_W = 24;

/** Width of ONE supplier column-group for a block of `n` suppliers. */
export const supplierColW = (n: number) => Math.max(150, (USABLE - LEFT_W) / n);

/** The three sub-columns inside a supplier column-group. */
export function supplierSubCols(n: number) {
  const supW = supplierColW(n);
  const desc = Math.max(70, Math.round(supW * 0.5));
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
 * wrapped LINES inside one cell. Measured off the rendered form: wrapped lines sit
 * 7.1pt apart, consecutive single-line rows 12.1pt, and rows with wrapped content
 * 26pt or more. 10pt splits lines from rows cleanly.
 */
export const ROW_GAP_THRESHOLD = 10;

/** Type sizes react-pdf uses for the cell contents the overlay makes editable. */
export const TYPE = {
  body: FS, // descriptions, qty, terms
  supplierName: FS + 0.5,
  ref: FS - 0.5,
  priceSar: FS, // bold "SAR 10.36"
  priceUsd: FS - 1, // muted "USD 2.76"
  specDiff: FS - 1.5, // amber italic "spec differs: …" note
} as const;

/** Signature block chrome (react-pdf `signBox` / `signWrap`). */
export const SIGN_BOX_PAD = 5; // paddingHorizontal
export const SIGN_BOX_GAP = 6; // gap between blocks
