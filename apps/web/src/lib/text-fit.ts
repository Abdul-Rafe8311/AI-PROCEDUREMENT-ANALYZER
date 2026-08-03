// SHARED TEXT MEASUREMENT + WRAPPING for the Technical Approval Form.
//
// Both outputs import this module:
//   • approval-form-pdf.tsx — pre-wraps cell text so react-pdf never has to guess
//   • ta-form-excel.ts      — counts the lines a cell will wrap to, to set row height
//
// It exists because the two were wrapping differently and BOTH were wrong, in
// opposite directions:
//
//   PDF:   react-pdf only breaks at spaces and NEVER clips. A part code like
//          "TWS.10(60)-200(140)-45-253MA-C" has no space in it, so once it is wider
//          than its column it is drawn straight through the column beside it. That
//          single token is what pinned the body type at 8pt.
//   Excel: row height was computed from `text.split('\n').length` — the count of
//          EXPLICIT newlines. Excel's own wrapText then wrapped a long description
//          onto 3 lines inside a row reserved for 1, and clipped the rest.
//
// ── WHY NOT react-pdf's hyphenation callback ───────────────────────────────
// The obvious fix is Font.registerHyphenationCallback to let react-pdf break inside
// a long token. It cannot be used here. @react-pdf/textkit inserts a literal U+002D
// glyph at every intra-word break (textkit.js: `insertGlyph(..., HYPHEN, line)`),
// and the constant is hardcoded — there is no option to suppress it. A part code
// wrapped that way renders as "TWS.10(60)--" / "200(140)", i.e. with a character
// the supplier never quoted, on a form somebody signs. Returning parts separated by
// a literal ' ' suppresses the hyphen but puts a real space into the string whether
// it wraps or not, which is the same forgery with a different character.
//
// So we wrap the text OURSELVES and hand react-pdf explicit newlines: every line
// already fits, so react-pdf never breaks anything and never inserts anything.
// `wrapLines` is total — it only ever splits, so the joined output is always
// character-for-character the input (see the invariant test).

/**
 * Helvetica advance widths, ASCII 32–126, in 1/1000 em — the AFM metrics, which
 * are frozen by the PDF spec for the 14 standard fonts. Inlined rather than read
 * from @pdf-lib/standard-fonts because that package is a TRANSITIVE dependency of
 * pdf-lib (not declared in our package.json), and because this has to run in the
 * browser bundle where the PDF is generated.
 *
 * Arial — the workbook font — is metrically compatible with Helvetica by design,
 * so the same table measures the Excel side.
 */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

/** Width for anything outside ASCII 32–126 (–, ·, ’, …). "n" — deliberately a bit
 *  generous, since over-estimating only ever wraps a line early. */
const W_FALLBACK = 556;

/** Measures a string's width in points at one font size. */
export type Measurer = (text: string) => number;

/**
 * A Helvetica/Arial measurer at `size` points.
 *
 * Kerning is NOT applied, so this reads ~0.1% wider than pdf-lib's
 * `widthOfTextAtSize` (188.7 vs 188.5pt for the fixture's worst part code at 12pt).
 * That direction is deliberate: measuring wide can only wrap a line one word early,
 * whereas measuring narrow puts text through the next column.
 */
export function helveticaMeasurer(size: number, bold = false): Measurer {
  const table = bold ? W_BOLD : W_REGULAR;
  return (text: string) => {
    let units = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) - 32;
      units += c >= 0 && c < table.length ? table[c] : W_FALLBACK;
    }
    return (units * size) / 1000;
  };
}

/**
 * Break opportunities INSIDE a token that has no spaces, in the order a reader
 * would accept them. The lookbehind keeps the punctuation at the END of the piece
 * before the break, so "TWS.10(60)-200(140)" splits as "TWS.10(60)-" + "200(140)"
 * — the hyphen stays with the group it terminates, exactly as it reads on the page.
 */
const SEAMS = /(?<=[-–—_./\\()[\],:;+])/;

/**
 * Split one token into chunks that each fit `maxW`.
 *
 * Seam-first, characters only as a last resort: a part code broken at its own
 * hyphens still reads as the part code, one broken mid-group does not. Characters
 * are never added or dropped — `breakToken(t, …).join('') === t` always.
 */
export function breakToken(token: string, maxW: number, measure: Measurer): string[] {
  if (!token || measure(token) <= maxW) return [token];

  // Pass 1: pack the seam-delimited pieces greedily.
  const pieces = token.split(SEAMS);
  const chunks: string[] = [];
  let cur = '';
  for (const piece of pieces) {
    const next = cur + piece;
    if (cur && measure(next) > maxW) {
      chunks.push(cur);
      cur = piece;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);

  // Pass 2: any single chunk still too wide has no usable seam (a 40-character
  // run of letters) — cut it by character. Guaranteed to terminate: a chunk is
  // only re-cut when it is longer than one character.
  const out: string[] = [];
  for (const chunk of chunks) {
    if (measure(chunk) <= maxW || chunk.length <= 1) {
      out.push(chunk);
      continue;
    }
    let line = '';
    for (const ch of chunk) {
      if (line && measure(line + ch) > maxW) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Word-wrap `text` to `maxW`, hard-breaking only the tokens that do not fit on a
 * line of their own. Explicit newlines in the input are honoured as hard breaks.
 *
 * Word-wrap is the default and character-wrap is the fallback — never the reverse.
 */
export function wrapLines(text: string, maxW: number, measure: Measurer): string[] {
  const src = String(text ?? '');
  if (!src) return [''];
  // A column narrower than a single character would loop forever below.
  if (!(maxW > 0)) return [src];

  const out: string[] = [];
  for (const paragraph of src.split('\n')) {
    const tokens = paragraph.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const token of tokens) {
      const candidate = line ? `${line} ${token}` : token;
      if (measure(candidate) <= maxW) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // The token could not join the current line; if it cannot hold a line of its
      // own either, break it and carry the remainder forward.
      const chunks = breakToken(token, maxW, measure);
      out.push(...chunks.slice(0, -1));
      line = chunks[chunks.length - 1];
    }
    out.push(line);
  }
  return out;
}

/** `wrapLines` joined for a renderer that honours "\n" (react-pdf's <Text>). */
export function fitText(text: string, maxW: number, measure: Measurer): string {
  return wrapLines(text, maxW, measure).join('\n');
}

/** How many lines a cell will occupy once wrapped — the Excel row-height input. */
export function countLines(text: string, maxW: number, measure: Measurer): number {
  return wrapLines(text, maxW, measure).length;
}

/**
 * Usable width in POINTS of an Excel column declared as `chars` wide.
 *
 * Excel's column-width unit is digits of the workbook's DEFAULT font (11pt
 * Calibri), not of the font in the cell — so it cannot be converted with the
 * measurer above. OOXML defines the mapping as `pixels = chars * 7 + 5` at 96 DPI
 * (ECMA-376 §18.3.1.13), and points are pixels × 72/96.
 *
 * `pad` drops the couple of points Excel insets cell text by, so a string that
 * measures exactly the column width is treated as wrapping rather than fitting.
 */
export function excelColPoints(chars: number, pad = 4): number {
  return Math.max(1, (chars * 7 + 5) * 0.75 - pad);
}
