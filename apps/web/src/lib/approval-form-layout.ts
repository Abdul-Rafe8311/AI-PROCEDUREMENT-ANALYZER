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
// ── PAPER: A3 LANDSCAPE, BODY TYPE 12pt ────────────────────────────────────
// The form is printed and signed around a table, so it is laid out for A3, the
// same as the .xlsx export, and at the same 12pt body type the workbook uses.
//
// It was 8pt, and 8pt was not a taste call — it was the largest size at which the
// fixture's longest part code ("TWS.10(60)-200(140)-45-253MA-C", 30 characters
// with no space to wrap at) still fitted its column. react-pdf only breaks at
// spaces and NEVER clips, so a token wider than its column was drawn straight
// through the column beside it.
//
// That constraint is now GONE, and it is the reason the type could triple-jump to
// 12pt in one go: cell text is pre-wrapped by text-fit.ts before it reaches
// react-pdf, breaking an over-long token at its own punctuation seams
// ("TWS.10(60)-" / "200(140)-45-" / "253MA-C"). Nothing can overrun a column any
// more, so column width stops being a type-size ceiling and becomes purely a
// readability trade:
//
//   at 12pt, A3 landscape holds ~171 characters across the full usable width.
//   Fixed overheads (index, qty, uom, per-supplier qty + price) eat ~66 of them,
//   leaving ~105 to divide between the PR description and the supplier
//   descriptions. At THREE suppliers to a page that is ~30 characters for the PR
//   column and ~17–20 for each supplier's; at four it drops to ~12, which is a
//   description stacked six lines deep in a column too narrow to scan.
//
// Hence SUP_PER_GROUP 4 → 3. Readability is the tie-breaker, per Farid: prefer a
// legible sheet over a tight one, and let a 4th supplier fall to a second A3 page
// rather than shrink the whole grid to fit it.
//
// NOTE on row geometry: ROW HEIGHTS are still not knowable up front — react-pdf's
// flexbox engine derives them from how many pre-wrapped lines each cell holds. The
// overlay therefore MEASURES the row bands back off the rendered page (see
// approval-form-overlay.ts) rather than guessing them; this module supplies the
// horizontal half of the grid and the thresholds that measurement needs.

import { helveticaMeasurer } from './text-fit';

/** A3 landscape, in points (420 × 297 mm). react-pdf takes the name; pdf-lib and
 *  the overlay need the numbers. */
export const PAGE_SIZE = 'A3';
export const PAGE_W = 1190.55;
export const PAGE_H = 841.89;

/** Suppliers per stacked block — "Suppliers 1–3 of 5", then 4 wraps to a new block.
 *  4 → 3 when the body type went 8 → 12pt: see the header note. The cap is what
 *  keeps a supplier column wide enough to read (commit 68d1775). */
export const SUP_PER_GROUP = 3; // was 4 at 8pt

/** Page padding (react-pdf `page` style). */
export const PAGE_PAD_X = 20;
export const PAGE_PAD_Y = 18;

/** Landscape A3 usable width (pt) inside the page padding. */
export const USABLE = PAGE_W - 2 * PAGE_PAD_X; // 1150.55

/** Base type size for table body text — A4 original: 6.5, A3 first pass: 8. */
export const FS = 12;

/** Cell padding used by `cellBox` / supplier cells. */
export const CELL_PAD_X = 5; // 8pt layout: 4
export const CELL_PAD_Y = 4; // 8pt layout: 3

/**
 * Type sizes react-pdf uses for the cell contents the overlay makes editable.
 *
 * The overlay identifies a run by matching its size to ±0.3pt, so these must stay
 * mutually distinct by more than 0.6. That constraint is why `ref` and `priceUsd`
 * are 10 and 11 rather than both 10: at equal sizes the overlay cannot tell a
 * "REF# 9100147169" run from a secondary-currency price line, and would file the
 * reference number as a price.
 */
export const TYPE = {
  body: FS, // 12 — descriptions, qty, terms
  supplierName: FS + 5, // 17 — the column heading: bigger AND bold
  ref: FS - 2, // 10 — "REF# 9100147169"
  priceSar: FS, // 12 — bold "SAR 10.36" (deliberately equal to body)
  priceUsd: FS - 1, // 11 — muted secondary currency line
  specDiff: FS - 3, // 9 — amber italic "spec differs: …" note
} as const;

/** Column headers — bold, and a step ABOVE the body so the band reads as a header. */
export const TYPE_HEAD = 13.5;

/** Title / section type, scaled with the rest. */
export const TYPE_TITLE = 24; // 8pt layout: 16.5
export const TYPE_FOOTER = 10; // 8pt layout: 7.5

/**
 * Vertical gap (pt) that separates one table ROW from the next, as opposed to two
 * wrapped LINES inside one cell. Every distance involved scales with the type, so
 * the threshold scales with FS: it was 10 at 6.5pt and 12 at 8pt.
 */
export const ROW_GAP_THRESHOLD = 18; // 8pt layout: 12

/** Signature block chrome (react-pdf `signBox` / `signWrap`). */
export const SIGN_BOX_PAD = 9;
export const SIGN_BOX_GAP = 10;
/** Minimum height of one signature block — four stacked lines plus breathing room. */
export const SIGN_BOX_MIN_H = 96; // 8pt layout: 70

// ── CONTENT-DERIVED COLUMN WIDTHS ──────────────────────────────────────────
//
// The widths below are no longer hand-tuned magic numbers. Each fixed-content
// column is sized to the WIDEST STRING IT CAN EVER HOLD, measured with the real
// Helvetica metrics at the real type size (see text-fit.ts), then clamped. The two
// free-text columns — PR description and supplier description — split whatever is
// left in the ratio their actual content asks for.
//
// `fitColumns` is a PURE function of (profile, n). That matters: the renderer and
// the AcroForm overlay must compute identical geometry, and the overlay only knows
// `n`. The renderer therefore stamps the profile it used into the PDF's Keywords,
// and the overlay reads it back (see `encodeFit` / `decodeFit`).

const bodyW = helveticaMeasurer(FS);
const headW = helveticaMeasurer(TYPE_HEAD, true);
const pad = 2 * CELL_PAD_X;

/** Width a column needs to hold `samples` outright, plus cell padding. */
const holds = (samples: string[], measure = bodyW) =>
  Math.ceil(Math.max(0, ...samples.map(measure)) + pad);

/**
 * The widest content each fixed column can ever be asked to hold. These are
 * WORST-CASE strings, not samples from one document — a column that fits "10,000"
 * must fit it in every document, or the grid would reflow per PR.
 */
const FIXED = {
  /** row number: two digits, and the "#" header */
  index: Math.max(holds(['99']), holds(['#'], headW)),
  /** PR quantity and each supplier's quantity: five significant digits + separator */
  qty: Math.max(holds(['10,000']), holds(['Qty'], headW)),
  /** unit of measure */
  uom: Math.max(holds(['PCS', 'TON']), holds(['UOM'], headW)),
  /** a line-item price with a currency code — the header wraps, so only its
   *  longest single word has to fit */
  price: Math.max(holds(['EUR 3,590.00']), holds(['Price'], headW)),
} as const;

/** Floors below which a free-text column stops being readable at 12pt. */
const MIN_PR_DESC = 150;
const MIN_SUB_DESC = 110;
/** Ceiling on the PR column — past this it starves the supplier columns, which are
 *  the ones being compared. */
const MAX_PR_DESC = 300;

/**
 * How much width the free-text columns are ASKING for, from the document's own
 * content. `prChars` / `descChars` are the median-ish line lengths the caller
 * measured; both default to the balance that suits a typical requisition.
 */
export interface ColumnProfile {
  /** typical PR item description length, in characters */
  prChars: number;
  /** typical supplier description length, in characters */
  descChars: number;
  /**
   * Supplier count the WIDTHS are computed from, independent of how many columns a
   * given block actually draws.
   *
   * 5 suppliers render as a block of 3 above a block of 2, and the block of 2 must
   * keep the block of 3's column widths — two grids of different geometry stacked
   * on one sheet read as two different forms, and the AcroForm overlay (which sees
   * only "this band has 2 Description headers") would otherwise fit a wider grid
   * than the renderer drew and place every widget off-column.
   */
  basis?: number;
}

export const DEFAULT_PROFILE: ColumnProfile = { prChars: 46, descChars: 40 };

/** Measure a profile off the real rows — what the renderer passes to `fitColumns`. */
export function profileFrom(prLabels: string[], supplierDescs: string[], basis?: number): ColumnProfile {
  // The 75th percentile, not the max: one pathological 200-character description
  // should not hand its column half the page and squeeze every other row.
  const p75 = (xs: number[], fallback: number) => {
    const s = xs.filter((n) => n > 0).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.75))] : fallback;
  };
  return {
    prChars: p75(prLabels.map((t) => t.length), DEFAULT_PROFILE.prChars),
    descChars: p75(supplierDescs.map((t) => t.length), DEFAULT_PROFILE.descChars),
    basis,
  };
}

export interface FittedColumns {
  index: number;
  prDesc: number;
  qtyL: number;
  uom: number;
  left: number;
  supW: number;
  desc: number;
  qty: number;
  price: number;
}

/**
 * Distribute the usable width across the grid for `n` suppliers.
 *
 * Fixed columns take exactly what their worst-case content measures. Everything
 * left over goes to the PR description and the `n` supplier descriptions, split in
 * proportion to what the profile asks for, then clamped to the readability floors.
 */
export function fitColumns(n: number, profile: ColumnProfile = DEFAULT_PROFILE): FittedColumns {
  const index = FIXED.index;
  const qtyL = FIXED.qty;
  const uom = FIXED.uom;
  const qty = FIXED.qty;
  const price = FIXED.price;

  // Widths always come from the FULL block size, so a trailing block of 2 keeps the
  // geometry of the blocks of 3 above it. See ColumnProfile.basis.
  const b = Math.max(1, profile.basis ?? n);

  // Width not spoken for by any fixed column, to be shared by the 1 PR description
  // and the b supplier descriptions.
  const free = USABLE - index - qtyL - uom - b * (qty + price);

  // Demand is per-column: the PR column carries one description, each supplier
  // column one of its own, so the split is prChars : b × descChars.
  const demand = profile.prChars + b * profile.descChars || 1;
  let prDesc = Math.round((free * profile.prChars) / demand);
  prDesc = Math.min(MAX_PR_DESC, Math.max(MIN_PR_DESC, prDesc));

  // Whatever the PR column did not take is divided evenly among the suppliers —
  // they are being compared against each other, so they must be equal.
  const desc = Math.max(MIN_SUB_DESC, Math.floor((free - prDesc) / b));

  const left = index + prDesc + qtyL + uom;
  const supW = desc + qty + price;
  return { index, prDesc, qtyL, uom, left, supW, desc, qty, price };
}

// ── Back-compatible constant view of the DEFAULT fit ────────────────────────
// Callers that only need "the usual numbers" (and every existing import) keep
// working; the renderer overrides them per document via `fitColumns`.
const DEFAULT_FIT = fitColumns(SUP_PER_GROUP);

export const IDX_W = DEFAULT_FIT.index;
export const PR_DESC_W = DEFAULT_FIT.prDesc;
export const QTY_L_W = DEFAULT_FIT.qtyL;
export const UOM_W = DEFAULT_FIT.uom;
export const LEFT_W = DEFAULT_FIT.left;
export const SUB_QTY_W = DEFAULT_FIT.qty;

/** Width of ONE supplier column-group for a block of `n` suppliers. */
export const supplierColW = (n: number, profile?: ColumnProfile) => fitColumns(n, profile).supW;

/** The three sub-columns inside a supplier column-group. */
export function supplierSubCols(n: number, profile?: ColumnProfile) {
  const f = fitColumns(n, profile);
  return { supW: f.supW, desc: f.desc, qty: f.qty, price: f.price };
}

/**
 * Absolute x-ranges (PDF user space, origin bottom-left) of every cell column for
 * a block of `n` suppliers. `supplier[i]` holds that supplier's three sub-columns.
 */
export function columnRanges(n: number, profile?: ColumnProfile) {
  const f = fitColumns(n, profile);
  const x0 = PAGE_PAD_X;
  const left = {
    index: { x: x0, w: f.index },
    prDesc: { x: x0 + f.index, w: f.prDesc },
    prQty: { x: x0 + f.index + f.prDesc, w: f.qtyL },
    uom: { x: x0 + f.index + f.prDesc + f.qtyL, w: f.uom },
  };
  const supplier = Array.from({ length: n }, (_, i) => {
    const sx = x0 + f.left + i * f.supW;
    return {
      group: { x: sx, w: f.supW },
      desc: { x: sx, w: f.desc },
      qty: { x: sx + f.desc, w: f.qty },
      price: { x: sx + f.desc + f.qty, w: f.price },
    };
  });
  return { left, supplier, leftBlock: { x: x0, w: f.left } };
}

// ── Profile hand-off, renderer → overlay ───────────────────────────────────
// The overlay reads geometry off the rendered page and knows only `n`, so a
// per-document fit would desync it. The renderer stamps the profile it used into
// the PDF's Keywords; the overlay decodes it and fits identically.

const STAMP = 'tafit';

export function encodeFit(profile: ColumnProfile): string {
  return `${STAMP}:${profile.prChars}:${profile.descChars}:${profile.basis ?? SUP_PER_GROUP}`;
}

export function decodeFit(keywords: string | undefined | null): ColumnProfile {
  const m = new RegExp(`${STAMP}:(\\d+):(\\d+):(\\d+)`).exec(keywords ?? '');
  if (!m) return DEFAULT_PROFILE;
  return { prChars: Number(m[1]), descChars: Number(m[2]), basis: Number(m[3]) };
}
