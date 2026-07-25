'use client';

// Makes the Technical Approval Form FILLABLE without touching its layout.
//
// react-pdf renders the pages (approval-form-pdf.tsx — the buyer's reference
// layout). This module then LOADS those bytes with pdf-lib and drops editable
// AcroForm widgets on top of the cells. The layout is never rebuilt with pdf-lib
// drawing primitives; nothing here draws a table.
//
// ── Where the coordinates come from ───────────────────────────────────────────
// Column x-ranges and page padding are static and come from ./approval-form-layout,
// the module the renderer itself uses. ROW geometry cannot come from a constants
// file: react-pdf's flexbox engine derives every row's height from how its text
// wrapped, so the numbers only exist once the page has been laid out. The overlay
// therefore MEASURES the rendered page back — every drawn text run, with its exact
// position, width and type size — and places each widget on the run it belongs to.
// That is the real layout, not a guess.
//
// ── One widget per rendered LINE ──────────────────────────────────────────────
// A wrapped cell becomes one field per visible line rather than a single multiline
// field. A multiline widget is re-wrapped by the viewer, which does not reproduce
// react-pdf's hyphenation ("Mater-" / "ial Grade"), so the text would visibly shift.
// Per-line widgets carry each line verbatim and cannot reflow.

import { PDFBool, PDFDocument, PDFName, PDFString, StandardFonts, TextAlignment, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import * as L from './approval-form-layout';

/** A single styled run of text measured off the rendered page. */
export interface TextRun {
  page: number; // 0-based
  x: number;
  y: number; // baseline, PDF user space (origin bottom-left)
  w: number;
  size: number;
  str: string;
  /** the renderer's font id for this run — resolved to bold/oblique/regular below */
  fontId: string;
}

type Align = 'left' | 'center' | 'right';
type FontKind = 'regular' | 'bold' | 'oblique';

interface Placement {
  name: string;
  page: number;
  /** widget rect, PDF user space */
  x: number;
  y: number;
  w: number;
  h: number;
  value: string;
  size: number;
  align: Align;
  font: FontKind;
  color: ReturnType<typeof rgb>;
  /** wrap + scroll instead of clipping (cells whose content spans several lines) */
  multiline: boolean;
}

const INK = rgb(0.059, 0.09, 0.165); // C.ink
const BODY = rgb(0.118, 0.161, 0.231); // C.body
const MUTED = rgb(0.392, 0.455, 0.545); // C.muted
const INDIGO = rgb(0.388, 0.4, 0.945); // C.aiBorder — AI-suggested comment

/** Term-row labels, in the order the renderer emits them. */
const TERM_LABELS = [
  'Total Price without VAT',
  'Total Price with VAT',
  'Payment Terms',
  'Delivery Time',
  'Delivery Terms',
  'Country of Origin',
  'Warranty',
  'Technical Comments',
];

// ── measurement ──────────────────────────────────────────────────────────────

/** Every non-blank text run on every page, with its exact geometry. */
export async function measureRuns(bytes: Uint8Array): Promise<TextRun[]> {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(bytes);
  const out: TextRun[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const raw of content.items as { str: string; transform: number[]; width: number; fontName: string }[]) {
      if (!raw.str || !raw.str.trim()) continue;
      out.push({
        page: p - 1,
        x: raw.transform[4],
        y: raw.transform[5],
        w: raw.width,
        size: raw.transform[0],
        str: raw.str,
        fontId: raw.fontName,
      });
    }
  }
  return out;
}

/**
 * Runs on the same baseline and at the same size, merged left-to-right into lines.
 * The sort keys on a ROUNDED baseline so sub-point rendering noise cannot interleave
 * two columns, and a run only joins the previous one when it actually FOLLOWS it
 * horizontally — a negative gap means a different column on the same baseline.
 */
function toLines(runs: TextRun[]): TextRun[] {
  const baseline = (v: number) => Math.round(v * 2) / 2;
  const sorted = [...runs].sort((a, b) => baseline(b.y) - baseline(a.y) || a.x - b.x);
  const lines: TextRun[] = [];
  for (const r of sorted) {
    const prev = lines[lines.length - 1];
    const gap = prev ? r.x - (prev.x + prev.w) : Infinity;
    const contiguous =
      prev && Math.abs(prev.y - r.y) < 0.4 && Math.abs(prev.size - r.size) < 0.1 && gap >= -0.5 && gap < 2.5;
    if (contiguous) {
      prev.str += r.str;
      prev.w = r.x + r.w - prev.x;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

/** Split lines into vertical clusters — one per table row (see ROW_GAP_THRESHOLD). */
function clusterRows(lines: TextRun[]): TextRun[][] {
  const sorted = [...lines].sort((a, b) => b.y - a.y);
  const groups: TextRun[][] = [];
  for (const l of sorted) {
    const cur = groups[groups.length - 1];
    if (cur && cur[cur.length - 1].y - l.y <= L.ROW_GAP_THRESHOLD) cur.push(l);
    else groups.push([l]);
  }
  return groups;
}

const bandOf = (rows: TextRun[]) => {
  const top = Math.max(...rows.map((r) => r.y + r.size));
  const bottom = Math.min(...rows.map((r) => r.y));
  return { top, bottom, centre: (top + bottom) / 2 };
};

const inCol = (r: TextRun, c: { x: number; w: number }) => r.x >= c.x - 1 && r.x < c.x + c.w - 0.5;

/**
 * The renderer draws in exactly three faces (Helvetica, -Bold, -Oblique) but the
 * measurement layer only reports opaque font ids. The document TITLE is always bold
 * and body text is always the most common face, which pins all three without
 * guessing at a run's appearance.
 */
function resolveFaces(runs: TextRun[]): (id: string) => FontKind {
  const freq = new Map<string, number>();
  for (const r of runs) freq.set(r.fontId, (freq.get(r.fontId) ?? 0) + 1);
  const boldId = runs.find((r) => r.str.trim() === 'TECHNICAL APPROVAL FORM')?.fontId;
  const regularId = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).find((id) => id !== boldId);
  const obliqueId = [...freq.keys()].find((id) => id !== boldId && id !== regularId);
  return (id) => (id === boldId ? 'bold' : id === obliqueId ? 'oblique' : 'regular');
}

// ── planning ─────────────────────────────────────────────────────────────────

/**
 * Work out where every editable widget goes, from the measured page.
 * `supplierCounts[p]` is how many supplier column-groups page `p` carries.
 */
function planPlacements(
  runs: TextRun[],
  pageCount: number,
  /** width of `text` at `size` in the given face — the real font, not an estimate */
  measure: (text: string, size: number, face: FontKind) => number,
): { placements: Placement[]; skipped: string[] } {
  const faceOf = resolveFaces(runs);
  const placements: Placement[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const push = (p: Placement) => {
    // Names are page-scoped, so the same cell on two supplier blocks stays distinct
    // and every name is stable across regenerations of the same analysis.
    let name = `p${p.page + 1}.${p.name}`;
    for (let i = 2; seen.has(name); i++) name = `p${p.page + 1}.${p.name}#${i}`;
    seen.add(name);
    placements.push({ ...p, name });
  };
  // ── How a widget is sized ────────────────────────────────────────────────
  // A widget used to be cut to the width of the text already printed under it,
  // which is why a reviewer typing into it saw "10,000" clipped to "10,00" and
  // "France" to "Franc": the box had no room beyond the pre-filled string, and the
  // viewer insets field text by several points before drawing it. Widgets are now
  // sized to their CELL — the column's inner width and the row's own vertical
  // territory — and widened further when the value needs it, bounded so the box can
  // never reach a neighbouring cell's text. Nothing in the printed layer moves.

  /** The page currently being planned — the neighbours a widget must not cover. */
  let pageRuns: TextRun[] = [];
  /** Points a viewer reserves inside a widget before it starts drawing text. */
  const VIEWER_INSET = 10;
  /** Cells whose content is unpredictable get at least this many lines of room. */
  const MIN_LINES = 3;

  /** One cell's worth of printed lines, to be replaced by a single widget. */
  interface CellPlacement {
    name: string;
    lines: TextRun[];
    /** the column the cell lives in (x + width, from the shared layout module) */
    col: { x: number; w: number };
    align?: Align;
    color?: ReturnType<typeof rgb>;
    /** hard vertical limits — the widget may not cross these (neighbouring rows) */
    top: number;
    bottom: number;
    /** never cover this y (the amber "spec differs" note keeps its own space) */
    floor?: number;
    /** force a generous, scrollable box even for a single printed line */
    variable?: boolean;
  }

  const placeCell = (c: CellPlacement) => {
    const ls = [...c.lines].sort((a, b) => b.y - a.y);
    if (!ls.length) return;
    const size = ls[0].size;
    const face = faceOf(ls[0].fontId);
    const align = c.align ?? 'left';
    // A cell that already WRAPS must keep its printed wrap width, or the viewer
    // re-flows the lines. A single-line cell has no wrap to protect, so it is free
    // to widen — which is what gives a reviewer room to type.
    // Only a cell that ALREADY wraps becomes multiline. A viewer draws a multiline
    // field from the top and a single-line field centred, so forcing multiline onto
    // a one-line cell shifts its text off the printed glyphs. One-line cells stay
    // single-line and get their extra room horizontally instead.
    const wraps = ls.length > 1;
    const multiline = wraps;
    const own = new Set(ls);
    const lineH = size * 1.32;

    // ── The rule that keeps the printed layer intact ─────────────────────────
    // A viewer draws field text from the widget's own edges: left-aligned from the
    // left edge, right-aligned from the right, single lines centred vertically and
    // multiline runs from the top. So the edge the text is drawn FROM is pinned to
    // where the text is already printed, and the box only ever grows in the free
    // direction. Grow the pinned edge and the visible text moves — which is exactly
    // what "only the field rectangles change" forbids.
    const INSET = 2; // what a viewer reserves before the first glyph

    const printedLeft = Math.min(...ls.map((l) => l.x));
    const printedRight = Math.max(...ls.map((l) => l.x + l.w));
    const printedTop = ls[0].y + size * 1.02;
    const printedBottom = ls[ls.length - 1].y - size * 0.3;

    // Neighbouring ink in this column sets the hard vertical limits.
    const column = pageRuns.filter((r: TextRun) => inCol(r, c.col) && !own.has(r));
    const ceiling = Math.min(
      c.top,
      ...column.filter((r: TextRun) => r.y > printedTop).map((r: TextRun) => r.y - r.size * 0.32),
    );
    const floorY = Math.max(
      c.bottom,
      c.floor ?? -Infinity,
      ...column.filter((r: TextRun) => r.y < printedBottom).map((r: TextRun) => r.y + r.size * 1.04),
    );

    let top: number;
    let bottom: number;
    if (multiline) {
      // Top-drawn: pin the top to the printed first line and grow DOWNWARD into
      // whatever room the row owns, so a longer value wraps and scrolls rather than
      // being clipped by a box cut to the extracted text.
      // A viewer puts the first baseline about one line-height below the box top.
      top = Math.min(ceiling, ls[0].y + size * 1.08);
      const want = Math.max(ls.length, MIN_LINES) * lineH;
      bottom = Math.max(floorY, top - Math.max(want, printedTop - printedBottom + 2));
    } else {
      // Centre-drawn: keep the printed line's centre and grow symmetrically.
      const centre = (printedTop + printedBottom) / 2;
      const half = Math.min(lineH / 2 + 1, ceiling - centre, centre - floorY);
      top = centre + Math.max(half, size * 0.55);
      bottom = centre - Math.max(half, size * 0.55);
    }
    const h = top - bottom;
    if (h < size * 0.9) return; // no safe room — leave the cell exactly as printed

    // ── width: pin the drawn-from edge, grow the other way. A multiline box also
    // keeps the printed wrap width, so the viewer breaks the lines where react-pdf
    // did instead of re-flowing the cell. ──
    const printedW = printedRight - printedLeft;
    const needed = Math.max(...ls.map((l) => measure(l.str, size, face))) + VIEWER_INSET;
    const inner = { x: c.col.x + L.CELL_PAD_X, w: c.col.w - 2 * L.CELL_PAD_X };
    let w = wraps ? printedW + 2 * INSET : Math.max(printedW + 2 * INSET, needed, inner.w);
    let x =
      align === 'right'
        ? printedRight + INSET - w
        : align === 'center'
          ? (printedLeft + printedRight) / 2 - w / 2
          : printedLeft - INSET;

    // Clamp against neighbouring ink, shrinking from the FREE edge only.
    const near = pageRuns.filter((r: TextRun) => !own.has(r) && r.y + r.size * 0.7 > bottom && r.y < top);
    const leftBound = Math.max(
      L.PAGE_PAD_X,
      ...near.filter((r: TextRun) => r.x + r.w <= printedLeft + 0.5).map((r: TextRun) => r.x + r.w + 0.5),
    );
    const rightBound = Math.min(
      L.PAGE_PAD_X + L.USABLE,
      ...near.filter((r: TextRun) => r.x >= printedRight - 0.5).map((r: TextRun) => r.x - 0.5),
    );
    if (align === 'right') {
      const left = Math.max(leftBound, x);
      w = x + w - left;
      x = left;
    } else if (align === 'left') {
      x = Math.max(leftBound, x);
      w = Math.min(w, rightBound - x);
    } else {
      const left = Math.max(leftBound, x);
      const right = Math.min(rightBound, x + w);
      x = left;
      w = right - left;
    }
    if (w < 6) return;

    push({
      name: c.name,
      page: ls[0].page,
      x,
      y: bottom,
      w,
      h,
      value: ls.map((l) => l.str).join('\n'),
      size,
      align,
      font: face,
      color: c.color ?? (face === 'oblique' ? INDIGO : BODY),
      multiline,
    });
  };

  /** A widget over a single run that is not part of the table grid. */
  const overRun = (
    r: TextRun,
    name: string,
    opts: { align?: Align; font?: FontKind; color?: ReturnType<typeof rgb>; x?: number; w?: number; tight?: boolean } = {},
  ) => {
    const face = opts.font ?? faceOf(r.fontId);
    const needed = measure(r.str, r.size, face) + VIEWER_INSET;
    push({
      name,
      page: r.page,
      x: (opts.x ?? r.x) - (opts.tight ? 0.5 : 2),
      y: r.y - r.size * 0.3,
      w: Math.max((opts.w ?? r.w) + (opts.tight ? 3 : 4.5), needed),
      h: r.size * 1.32,
      value: r.str,
      size: r.size,
      align: opts.align ?? 'left',
      font: face,
      color: opts.color ?? (face === 'oblique' ? INDIGO : BODY),
      multiline: false,
    });
  };

  for (let page = 0; page < pageCount; page++) {
    pageRuns = runs.filter((r) => r.page === page);
    const lines = toLines(pageRuns);

    // How many supplier groups does this page carry? One "Description" sub-header each.
    const descHeaders = lines.filter((l) => l.str.trim() === 'Description');
    const n = descHeaders.length;
    if (!n) continue;
    const cols = L.columnRanges(n);
    const subHeaderY = Math.max(...descHeaders.map((l) => l.y));

    // ── header meta block (page 1 only): the value beside each bold caption ──
    for (const [caption, base] of [
      ['TA Date:', 'ta_date'],
      ['PR#:', 'pr_number'],
      ['Generated on:', 'generated_on'],
      ['PR Description:', 'pr_description'],
    ] as const) {
      // Caption and value sit on one baseline at the same size, so they merge into a
      // single line — match the RAW runs instead and take the run after the caption.
      const label = pageRuns.find((l) => l.str.trim() === caption.trim() && l.y > subHeaderY);
      if (!label) continue;
      const value = pageRuns
        .filter((l) => Math.abs(l.y - label.y) < 0.5 && l.x > label.x + label.w - 1 && l.str.trim())
        .sort((a, b) => a.x - b.x)[0];
      if (value) overRun(value, base, { tight: true });
    }

    // ── table rows: anchors come from the leftmost block, which is never empty ──
    const leftLines = lines.filter((l) => inCol(l, cols.leftBlock) && l.y < subHeaderY - 2);
    const anchors = clusterRows(leftLines);

    const rows: { kind: 'item' | 'term'; label: string; band: ReturnType<typeof bandOf>; index: number }[] = [];
    let itemIndex = 0;
    for (const a of anchors) {
      const text = a.map((l) => l.str).join(' ').trim();
      const term = TERM_LABELS.find((t) => text.startsWith(t));
      if (term) rows.push({ kind: 'term', label: term, band: bandOf(a), index: rows.length });
      else if (!rows.some((r) => r.kind === 'term')) rows.push({ kind: 'item', label: text, band: bandOf(a), index: itemIndex++ });
      else break; // past Technical Comments — AI box / signatures start here
    }
    if (!rows.length) continue;
    // The sub-header band ("Description | Qty | Unit Price (SAR / USD)") can wrap onto
    // a second line, which would otherwise read as row-1 data. Bound the table by the
    // LOWEST line of that band, not by the first row's own extent.
    const headerBottom = Math.min(
      ...lines.filter((l) => l.y <= subHeaderY + 1 && l.y >= subHeaderY - 12).map((l) => l.y),
    );
    const tableTop = Math.min(Math.max(...rows.map((r) => r.band.top)) + 8, headerBottom - 1);
    // The last row's own label is one line, but a supplier's cell there can wrap
    // below it (a long Technical Comment). Reach far enough down to keep those
    // lines inside the table — stopping short of whatever follows it on the page.
    const afterTable = lines
      .filter((l) => /^(AI SUGGESTED\b|Final Recommendation|Generated by)/.test(l.str.trim()))
      .map((l) => l.y + l.size * 1.2);
    const tableBottom = Math.max(
      afterTable.length ? Math.max(...afterTable) : -Infinity,
      Math.min(...rows.map((r) => r.band.bottom)) - 3 * L.FS,
    );
    const rowOf = (y: number) => rows.reduce((best, r) => (Math.abs(r.band.centre - y) < Math.abs(best.band.centre - y) ? r : best), rows[0]);
    const inTable = (l: TextRun) => l.y <= tableTop && l.y >= tableBottom;
    const key = (r: (typeof rows)[number]) => (r.kind === 'item' ? `r${r.index + 1}` : r.label.replace(/\s+/g, '_'));

    // Each row owns the vertical band between the midpoints to its neighbours; a
    // widget may fill that band but never cross into the next row's text.
    const ordered = [...rows].sort((a, b) => b.band.centre - a.band.centre);
    const territory = new Map<string, { top: number; bottom: number }>();
    ordered.forEach((r, i) => {
      const above = ordered[i - 1];
      const below = ordered[i + 1];
      territory.set(key(r), {
        top: above ? (above.band.bottom + r.band.top) / 2 : Math.min(tableTop, headerBottom - 1),
        bottom: below ? (r.band.bottom + below.band.top) / 2 : r.band.bottom - 6,
      });
    });

    // Collect a column's printed lines into one group per row. Lines are clustered
    // WITHIN the column first (rows are far apart there), then each cluster is
    // assigned to the row whose band it OVERLAPS most. Assigning line-by-line to the
    // nearest row centre mis-files the lower lines of a supplier cell that is taller
    // than the PR cell beside it — which is how a widget ended up growing over its
    // neighbour's text.
    const cellsByRow = (col: { x: number; w: number }, keep: (l: TextRun) => boolean = () => true) => {
      const mine = lines.filter((l) => inCol(l, col) && inTable(l) && keep(l));
      const out = new Map<string, TextRun[]>();
      for (const cluster of clusterRows(mine)) {
        const band = bandOf(cluster);
        const best = rows.reduce(
          (acc, r) => {
            const overlap = Math.min(band.top, r.band.top) - Math.max(band.bottom, r.band.bottom);
            const score = overlap > 0 ? overlap : -Math.abs(r.band.centre - band.centre);
            return score > acc.score ? { row: r, score } : acc;
          },
          { row: rows[0], score: -Infinity },
        ).row;
        const k = key(best);
        out.set(k, [...(out.get(k) ?? []), ...cluster]);
      }
      return out;
    };
    const rowByKey = new Map(rows.map((r) => [key(r), r]));

    // ── left reference columns (the PR's own description / qty / uom) ──
    for (const [col, base, align, variable] of [
      [cols.left.prDesc, 'pr_item_desc', 'left', true],
      [cols.left.prQty, 'pr_item_qty', 'center', false],
      [cols.left.uom, 'pr_item_uom', 'center', false],
    ] as const) {
      for (const [k, ls] of cellsByRow(col)) {
        if (rowByKey.get(k)?.kind !== 'item') continue;
        placeCell({ name: `${base}.${k}`, lines: ls, col, align, variable, ...territory.get(k)! });
      }
    }

    // ── supplier columns ──
    for (let s = 0; s < n; s++) {
      const col = cols.supplier[s];
      const isNote = (l: TextRun) => Math.abs(l.size - L.TYPE.specDiff) < 0.3;

      // Item rows: description | qty | unit price, each in its own sub-column.
      for (const [sub, base, align, variable] of [
        [col.desc, 'cell_desc', 'left', true],
        [col.qty, 'cell_qty', 'center', false],
        [col.price, 'cell_price', 'right', false],
      ] as const) {
        for (const [k, ls] of cellsByRow(sub, (l) => !isNote(l))) {
          const row = rowByKey.get(k);
          if (!row || row.kind === 'term') continue;
          const t = territory.get(k)!;
          if (base === 'cell_price') {
            // The price cell prints a bold SAR line over a smaller muted USD line —
            // two different faces, so they stay two fields.
            for (const l of ls) {
              const usd = Math.abs(l.size - L.TYPE.priceUsd) < 0.3;
              placeCell({
                name: `cell_price_${usd ? 'usd' : 'sar'}.${k}.s${s}`,
                lines: [l],
                col: sub,
                align,
                color: usd ? MUTED : INK,
                top: Math.min(t.top, l.y + l.size * 1.3),
                bottom: Math.max(t.bottom, l.y - l.size * 0.45),
              });
            }
            continue;
          }
          // The amber "spec differs" note keeps its own space under the description.
          const note = lines.filter((l) => inCol(l, col.desc) && isNote(l) && key(rowOf(l.y)) === k);
          const floor = note.length ? Math.max(...note.map((l) => l.y)) + note[0].size * 1.2 : undefined;
          placeCell({ name: `${base}.${k}.s${s}`, lines: ls, col: sub, align, variable, ...t, floor });
        }
      }

      // Term rows: the value spans the whole supplier group.
      for (const [k, ls] of cellsByRow(col.group)) {
        const row = rowByKey.get(k);
        if (!row || row.kind !== 'term') continue;
        const t = territory.get(k)!;
        const isTotal = row.label.startsWith('Total Price');
        if (isTotal) {
          // The totals cell stacks original currency / SAR / USD in three faces.
          for (const l of ls) {
            const usd = Math.abs(l.size - L.TYPE.priceUsd) < 0.3;
            placeCell({
              name: `term.${k}.s${s}.l${Math.round(l.y * 10)}`,
              lines: [l],
              col: col.group,
              align: 'right',
              color: usd ? MUTED : undefined,
              top: Math.min(t.top, l.y + l.size * 1.3),
              bottom: Math.max(t.bottom, l.y - l.size * 0.45),
            });
          }
          continue;
        }
        placeCell({ name: `term.${k}.s${s}`, lines: ls, col: col.group, align: 'left', variable: true, ...t });
      }
    }

    // ── Final Recommendation: the ruled blank to the right of the caption ──
    const finalLabel = lines.find((l) => l.str.trim().startsWith('Final Recommendation'));
    if (finalLabel) {
      const right = L.PAGE_PAD_X + L.USABLE;
      const x = finalLabel.x + finalLabel.w + 6;
      const existing = lines
        .filter((l) => Math.abs(l.y - finalLabel.y) < 1 && l.x > x - 4)
        .sort((a, b) => a.x - b.x);
      push({
        name: 'final_recommendation',
        page,
        x,
        y: finalLabel.y - 3,
        w: Math.max(40, right - x),
        h: 12,
        value: existing.map((l) => l.str).join('').trim(),
        size: L.FS,
        align: 'left',
        font: 'bold',
        color: INK,
        multiline: false,
      });
    }

    // ── signature blocks: an input beside each "Signature:" / "Date:" caption.
    // The blocks are equal width, so the PITCH between two captions on one row gives
    // the block width for every block — including the last one on a short row, which
    // has no neighbour to measure against. ──
    const sigCaps = lines.filter((l) => l.str.trim() === 'Signature:').sort((a, b) => b.y - a.y || a.x - b.x);
    let pitch = Infinity;
    for (const a of sigCaps) {
      for (const b of sigCaps) {
        if (Math.abs(a.y - b.y) < 1 && b.x > a.x) pitch = Math.min(pitch, b.x - a.x);
      }
    }
    for (const [caption, base] of [['Signature:', 'signature'], ['Date:', 'sig_date']] as const) {
      lines
        .filter((l) => l.str.trim() === caption)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .forEach((l, i) => {
          const blockRight = Number.isFinite(pitch)
            ? l.x - L.SIGN_BOX_PAD + pitch - L.SIGN_BOX_GAP - L.SIGN_BOX_PAD
            : L.PAGE_PAD_X + L.USABLE - L.SIGN_BOX_PAD;
          const x = l.x + l.w + 3;
          push({
            name: `${base}.${i}`,
            page,
            x,
            y: l.y - 3,
            w: Math.max(30, blockRight - x),
            h: 11,
            value: '',
            size: L.FS,
            align: 'left',
            font: 'regular',
            color: INK,
            multiline: false,
          });
        });
    }
  }
  return { placements, skipped };
}

/** Approved / Denied checkbox squares, measured from their captions. */
function planCheckboxes(runs: TextRun[]): { name: string; page: number; x: number; y: number; size: number }[] {
  const out: { name: string; page: number; x: number; y: number; size: number }[] = [];
  const byKind: Record<string, number> = { Approved: 0, Denied: 0 };
  for (const caption of ['Approved', 'Denied']) {
    runs
      .filter((r) => r.str.trim() === caption)
      .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
      .forEach((r) => {
        const i = byKind[caption]++;
        // `checkRow` lays the 7pt box immediately before its caption with a 3pt gap.
        out.push({ name: `${caption.toLowerCase()}.${i}`, page: r.page, x: r.x - 3 - 7, y: r.y - 0.5, size: 7 });
      });
  }
  return out;
}

// ── application ──────────────────────────────────────────────────────────────

/**
 * Load a rendered Technical Approval Form and return the same document with
 * editable AcroForm fields laid over its value cells. Nothing on the page moves.
 */
export async function overlayEditableFields(bytes: Uint8Array): Promise<Uint8Array> {
  // pdf.js takes OWNERSHIP of the buffer it is handed and detaches it, so the
  // measurement pass gets its own copy and pdf-lib still sees the original bytes.
  const runs = await measureRuns(Uint8Array.from(bytes));
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const form = doc.getForm();
  const fonts: Record<FontKind, PDFFont> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    oblique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  // Sizing needs real font metrics, so the faces are embedded before planning.
  const { placements } = planPlacements(runs, pages.length, (text, size, face) =>
    fonts[face].widthOfTextAtSize(text, size),
  );
  const checkboxes = planCheckboxes(runs);
  const WHITE = rgb(1, 1, 1);
  const LINE = rgb(0.2, 0.25, 0.33);

  const place = (p: Placement, page: PDFPage) => {
    const tf = form.createTextField(p.name);
    tf.setText(p.value);
    // Multi-line cells wrap and SCROLL inside the widget instead of clipping, so a
    // reviewer can type more than the extraction produced.
    if (p.multiline) tf.enableMultiline();
    tf.setAlignment(p.align === 'right' ? TextAlignment.Right : p.align === 'center' ? TextAlignment.Center : TextAlignment.Left);
    tf.addToPage(page, {
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      font: fonts[p.font],
      textColor: p.color,
      // A widget that carries a value is opaque, so it REPLACES the printed glyphs
      // rather than double-printing over them: the cell keeps its exact position,
      // size and type, the value is simply drawn by the field from now on. A widget
      // over a BLANK (Signature, Date, Final Recommendation) stays transparent so it
      // cannot paint over the rule the reviewer signs on.
      backgroundColor: p.value ? WHITE : undefined,
      borderWidth: 0,
    });
    tf.setFontSize(p.size);
    tf.updateAppearances(fonts[p.font]);
  };

  for (const p of placements) {
    const page = pages[p.page];
    if (!page) continue;
    place(p, page);
  }
  for (const c of checkboxes) {
    const page = pages[c.page];
    if (!page) continue;
    const cb = form.createCheckBox(c.name);
    cb.addToPage(page, { x: c.x, y: c.y, width: c.size, height: c.size, borderWidth: 0.75, borderColor: LINE, backgroundColor: WHITE });
  }

  // Register the standard fonts in the AcroForm default resources so a viewer that
  // re-renders field text can resolve what each /DA names.
  const acro = form.acroForm;
  acro.dict.set(
    PDFName.of('DR'),
    doc.context.obj({
      Font: doc.context.obj({
        Helvetica: fonts.regular.ref,
        'Helvetica-Bold': fonts.bold.ref,
        'Helvetica-Oblique': fonts.oblique.ref,
      }),
    }),
  );
  acro.dict.set(PDFName.of('DA'), PDFString.of(`0 g /Helvetica ${L.FS} Tf`));
  // Ask viewers to render the field values themselves — they honour the /DA size
  // rather than falling back to a default that would not match the printed text.
  acro.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

  const out = await doc.save();
  const buf = new Uint8Array(out.byteLength);
  buf.set(out);
  return buf;
}
