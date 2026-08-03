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
// `profile` is the column fit the RENDERER used, recovered from the document's
// Keywords. Column widths are content-derived now, so the overlay cannot re-derive
// them from `n` alone — without the stamp it would place widgets on the default
// grid, and a document with unusually long descriptions would get its fields half a
// column off. Documents without the stamp decode to DEFAULT_PROFILE.
function planPlacements(
  runs: TextRun[],
  pageCount: number,
  profile: L.ColumnProfile,
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
  /** A widget sized to the run it replaces, with a little slack for the viewer's own inset. */
  const overRun = (
    r: TextRun,
    name: string,
    opts: { align?: Align; font?: FontKind; color?: ReturnType<typeof rgb>; x?: number; w?: number; tight?: boolean } = {},
  ) =>
    push({
      name,
      page: r.page,
      // A viewer insets field text by a point or two before drawing it, so the widget
      // is a shade wider than the run it replaces — otherwise the last glyph clips.
      // `tight` keeps the left edge where a value sits directly after its caption, so
      // the space between the two is not swallowed.
      x: (opts.x ?? r.x) - (opts.tight ? 0.5 : 2),
      y: r.y - r.size * 0.3,
      w: (opts.w ?? r.w) + (opts.tight ? 3 : 4.5),
      h: r.size * 1.32,
      value: r.str,
      size: r.size,
      align: opts.align ?? 'left',
      // The face is MEASURED, never assumed, so a bold total stays bold and an
      // AI-suggested value keeps its italic.
      font: opts.font ?? faceOf(r.fontId),
      color: opts.color ?? (faceOf(r.fontId) === 'oblique' ? INDIGO : BODY),
    });

  for (let page = 0; page < pageCount; page++) {
    const pageRuns = runs.filter((r) => r.page === page);
    const lines = toLines(pageRuns);

    // How many supplier groups does this page carry? One "Description" sub-header each.
    //
    // A page can legitimately carry NONE. On A3 the whole grid fits on page 1 and
    // the sign-off (Final Recommendation + signature blocks) flows onto page 2 by
    // itself. This used to `continue` past such a page, which skipped the table
    // work AND everything after it — so the sign-off page came out with no
    // editable fields at all. The table work is now scoped to pages that have a
    // table; the sign-off pass below runs on every page either way.
    const descHeaders = lines.filter((l) => l.str.trim() === 'Description');

    // Group the sub-headers into BLOCKS by baseline. A page can carry more than one
    // supplier block: on A3 the whole grid normally fits on page 1, as "Suppliers
    // 1–4 of 5" stacked above "Suppliers 5–5 of 5". Counting every "Description" on
    // the page and sizing ONE grid from the total is how a 5-column layout got
    // computed for a page that actually holds a 4-column block above a 1-column one
    // — which put the price sub-column at 17pt and filed quantities as prices.
    const headerBands: TextRun[][] = [];
    for (const h of [...descHeaders].sort((a, b) => b.y - a.y)) {
      const cur = headerBands[headerBands.length - 1];
      if (cur && Math.abs(cur[0].y - h.y) < 2) cur.push(h);
      else headerBands.push([h]);
    }

    for (let bi = 0; bi < headerBands.length; bi++) {
    const band = headerBands[bi];
    const n = band.length;
    const cols = L.columnRanges(n, profile);
    const subHeaderY = Math.max(...band.map((l) => l.y));
    // This block ends just above the next block's sub-header — or at the foot of the
    // page when it is the last one.
    const blockFloor =
      bi + 1 < headerBands.length ? Math.max(...headerBands[bi + 1].map((l) => l.y)) + 2 : -Infinity;

    // ── header meta block (first block of page 1 only): the value beside each bold caption ──
    if (bi === 0) for (const [caption, base] of [
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
    const leftLines = lines.filter((l) => inCol(l, cols.leftBlock) && l.y < subHeaderY - 2 && l.y > blockFloor);
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
    if (!rows.length) continue; // this block has no rows — try the next
    // The sub-header band ("Description | Qty | Unit Price (SAR / USD)") can wrap onto
    // a second line, which would otherwise read as row-1 data. Bound the table by the
    // LOWEST line of that band, not by the first row's own extent.
    const headerBottom = Math.min(
      ...lines.filter((l) => l.y <= subHeaderY + 1 && l.y >= subHeaderY - 12).map((l) => l.y),
    );
    const tableTop = Math.min(Math.max(...rows.map((r) => r.band.top)) + 8, headerBottom - 1);
    const tableBottom = Math.min(...rows.map((r) => r.band.bottom)) - 8;
    const rowOf = (y: number) => rows.reduce((best, r) => (Math.abs(r.band.centre - y) < Math.abs(best.band.centre - y) ? r : best), rows[0]);
    const inTable = (l: TextRun) => l.y <= tableTop && l.y >= tableBottom;
    const key = (r: (typeof rows)[number]) => (r.kind === 'item' ? `r${r.index + 1}` : r.label.replace(/\s+/g, '_'));

    // ── left reference columns (the PR's own description / qty / uom) ──
    for (const [col, base, align] of [
      [cols.left.prDesc, 'pr_item_desc', 'left'],
      [cols.left.prQty, 'pr_item_qty', 'center'],
      [cols.left.uom, 'pr_item_uom', 'center'],
    ] as const) {
      const cells = lines.filter((l) => inCol(l, col) && inTable(l));
      const perRow = new Map<string, TextRun[]>();
      for (const l of cells) {
        const r = rowOf(l.y);
        if (r.kind !== 'item') continue;
        const k = key(r);
        perRow.set(k, [...(perRow.get(k) ?? []), l]);
      }
      for (const [k, ls] of perRow) {
        ls.sort((a, b) => b.y - a.y).forEach((l, i) => overRun(l, `${base}.${k}.l${i}`, { align }));
      }
    }

    // ── supplier columns ──
    for (let s = 0; s < n; s++) {
      const col = cols.supplier[s];
      const cells = lines.filter((l) => inCol(l, col.group) && inTable(l));
      for (const l of cells) {
        const r = rowOf(l.y);
        const k = key(r);
        if (r.kind === 'term') {
          // Term-row values span the whole supplier group. The totals row prints the
          // original currency + SAR (both body size) and a smaller muted USD line.
          const isUsd = Math.abs(l.size - L.TYPE.priceUsd) < 0.3;
          overRun(l, `term.${k}.s${s}.l${Math.round(l.y * 10)}`, {
            align: r.label.startsWith('Total Price') ? 'right' : 'left',
            ...(isUsd ? { color: MUTED } : {}),
          });
          continue;
        }
        if (inCol(l, col.desc)) {
          // The amber "spec differs" note shares the description cell but is smaller —
          // it is a status flag, not a value, so it stays as printed.
          if (Math.abs(l.size - L.TYPE.specDiff) < 0.3) continue;
          overRun(l, `cell_desc.${k}.s${s}.l${Math.round(l.y * 10)}`);
        } else if (inCol(l, col.qty)) {
          overRun(l, `cell_qty.${k}.s${s}`, { align: 'center' });
        } else if (inCol(l, col.price)) {
          // An item row's price is ONE line, in the supplier's own quoted currency —
          // line items are no longer converted, so the field is simply `cell_price`
          // (it was `cell_price_sar` back when every line was restated in SAR).
          // The smaller muted size is still recognised as a secondary line; only the
          // TOTAL rows, handled above under `term.`, print SAR + USD now.
          const secondary = Math.abs(l.size - L.TYPE.priceUsd) < 0.3;
          overRun(l, `cell_price${secondary ? '_alt' : ''}.${k}.s${s}`, {
            align: 'right',
            color: secondary ? MUTED : INK,
          });
        }
      }
    }
    } // end per-block loop

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
        y: finalLabel.y - 2.5,
        w: Math.max(40, right - x),
        h: 11,
        value: existing.map((l) => l.str).join('').trim(),
        size: L.FS,
        align: 'left',
        font: 'bold',
        color: INK,
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
            y: l.y - 2.5,
            w: Math.max(30, blockRight - x),
            h: 10,
            value: '',
            size: L.FS,
            align: 'left',
            font: 'regular',
            color: INK,
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
  // The renderer stamped the column fit it used into Keywords — decode it so the
  // widgets land on the columns actually drawn, not on the default grid.
  const profile = L.decodeFit(doc.getKeywords());
  const { placements } = planPlacements(runs, pages.length, profile);
  const checkboxes = planCheckboxes(runs);

  const form = doc.getForm();
  const fonts: Record<FontKind, PDFFont> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    oblique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const WHITE = rgb(1, 1, 1);
  const LINE = rgb(0.2, 0.25, 0.33);

  const place = (p: Placement, page: PDFPage) => {
    const tf = form.createTextField(p.name);
    tf.setText(p.value);
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
