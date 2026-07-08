// Deterministic line-item matching: match each supplier's quoted product line
// against the company's Purchase Requisition (PR) items by description
// similarity (meaning/spec — descriptions are never character-identical across
// documents). Pure and offline (no LLM), so it is fast, testable, and
// consistent with the rest of the analysis engine.
//
// The similarity blends two signals:
//   • word-token overlap (Jaccard) after light normalization + stopword removal;
//   • distinctive SPEC-CODE agreement (e.g. "Tws.10(60)-200(140)-40-253",
//     "Grade 253", "128kg/m3") — the strongest signal that two rows are the
//     SAME item, and the one that flips when a grade/dimension is wrong.
// A shared long spec code is treated as near-certain evidence of a match.

import type {
  ExtractedQuotation,
  LineItem,
  PrItem,
  PrItemMatch,
  PrItemMatchState,
  PrMatchResult,
  PurchaseRequisition,
  SupplierMatch,
  TechnicalComment,
} from './workspace-types';

/** score at/above which a supplier item is Technically Approved against a PR item */
export const MATCH_THRESHOLD = 0.5;

// Filler words that carry no distinguishing meaning for procurement items. The
// distinguishing information (grade/type/dimension) lives in the NUMBERS, which
// are never stopped — so "Grade 253" vs "Grade 304" still separates on 253/304.
const STOPWORDS = new Set([
  'with', 'and', 'the', 'for', 'of', 'to', 'type', 'material', 'mat', 'an', 'as',
  'per', 'on', 'in', 'by', 'or', 'grade', 'model', 'part', 'item', 'approx', 'incl',
  'including', 'include', 'each', 'set', 'pcs', 'no', 'nos', 'ea', 'unit', 'qty',
]);

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Meaningful word tokens (length > 1, minus stopwords). Numbers are kept. */
function wordTokens(str: string): Set<string> {
  return new Set(
    normalizeText(str)
      .split(' ')
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/**
 * Distinctive spec codes: runs that contain a digit and may carry internal
 * separators — "Tws.10(60)-200(140)-40-253" → "106020014040253", "253" → "253",
 * "128kg/m3" → "128kgm3". Compacting to alphanumerics makes formatting
 * differences ("Tws.10(60)" vs "tws 10 60") irrelevant while keeping the code's
 * identity, so the same item lines up and a changed grade/dimension does not.
 */
function specCodes(str: string): Set<string> {
  const codes = new Set<string>();
  const re = /[a-z]*\d[a-z0-9().\-/]*/gi;
  for (const m of str.matchAll(re)) {
    const compact = m[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (compact.length >= 3) codes.add(compact);
  }
  return codes;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * 0..1 similarity between two item descriptions. 1 ≈ certainly the same item;
 * near 0 ≈ unrelated. Exposed for unit testing.
 */
export function similarity(a: string, b: string): number {
  const jac = jaccard(wordTokens(a), wordTokens(b));

  const sa = specCodes(a);
  const sb = specCodes(b);
  let spec: number | null = null;
  if (sa.size && sb.size) {
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    // Containment of the smaller spec set — "did the distinctive codes line up?"
    spec = inter / Math.min(sa.size, sb.size);
  }
  // Sharing a LONG code (≥5 chars) is near-certain evidence of the same item.
  let longShared = false;
  for (const t of sa) {
    if (t.length >= 5 && sb.has(t)) {
      longShared = true;
      break;
    }
  }

  let score = jac;
  if (spec != null) score = 0.45 * jac + 0.55 * spec;
  if (longShared) score = Math.max(score, 0.85);
  return Math.max(0, Math.min(1, score));
}

/** Text used to represent a PR item for matching (description carries the spec). */
function prItemText(pr: PrItem): string {
  return [pr.description, pr.itemCode ?? ''].filter(Boolean).join(' ');
}

/** True when the supplier line explicitly cites the PR's own item code. */
function itemCodeHit(name: string, code: string | null): boolean {
  if (!code) return false;
  const c = code.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (c.length < 3) return false;
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(c);
}

/**
 * Extract a material-GRADE signature — "253 MA", "253 C", "Grade SS 310" →
 * "253ma" / "253c" / "ss310". This is the token that distinguishes an otherwise
 * identical anchor. Returns null when the text states no recognizable grade.
 */
function gradeOf(str: string): string | null {
  const s = str.toLowerCase().replace(/\s+/g, ' ');
  // Prefer an explicit "grade <x>" phrase.
  let m = s.match(/grade[\s:.-]*((?:ss\s*)?\d{2,4}(?:\s*[a-z]{1,3})?)/);
  if (m?.[1]) return m[1].replace(/[^a-z0-9]/g, '');
  // Else a bare material designation like "SS 310", "253 MA", "253 C".
  m = s.match(/\b(ss\s*\d{2,4}|\d{3,4}\s*mac?\b|\d{3,4}\s*c\b)/);
  if (m?.[1]) return m[1].replace(/[^a-z0-9]/g, '');
  return null;
}

/**
 * A quantity-mapped line "differs in spec" when both it and the PR item state a
 * material grade and those grades DISAGREE — e.g. "Grade SS 310" vs "253 Ma", or
 * "253 MA" vs "253 C". Dimension/part-number differences alone are NOT flagged:
 * quantity already lined the rows up and the buyer sees the exact wording in-cell.
 * This is the ONLY thing that downgrades a quoted cell to "spec differs".
 */
function specConflict(name: string, prText: string): boolean {
  const g1 = gradeOf(name);
  const g2 = gradeOf(prText);
  return !!(g1 && g2 && g1 !== g2);
}

/**
 * Match ONE supplier's quoted product items against the PR items, producing a
 * three-state verdict PER PR ITEM (so nothing is double-counted). Charge lines
 * (freight/shipping/insurance/handling) are not requisition items and are excluded.
 *
 * Mapping priority (quantity is the PRIMARY key — the 5 suppliers describe the
 * same anchors 5 different ways, so text similarity alone mis-places rows):
 *   1) EXACT QUANTITY — each supplier line, in order, claims the best still-free
 *      PR row sharing its quantity (description breaks ties among equal-qty rows;
 *      line order is the final tiebreaker);
 *   2) DESCRIPTION similarity — a secondary pass only for lines whose quantity
 *      matched no PR row (or a PR row with no quantity).
 * A mapped line is quoted_match UNLESS a spec/grade CONFLICT is detected
 * (same item family, distinctive codes disagree) → quoted_spec_diff. A PR item
 * that nothing maps to → not_quoted. Nothing is ever dropped or hidden.
 */
export function matchSupplierItems(
  quotation: ExtractedQuotation,
  prItems: PrItem[],
  threshold: number = MATCH_THRESHOLD,
): SupplierMatch {
  const products = (quotation.lineItems ?? []).filter((li) => (li.category ?? 'product') === 'product');

  const simOf = (li: LineItem, pr: PrItem): number => {
    let sc = similarity(li.name, prItemText(pr));
    if (itemCodeHit(li.name, pr.itemCode)) sc = Math.max(sc, 0.95);
    return sc;
  };

  const prLine: (number | null)[] = new Array(prItems.length).fill(null); // prIndex → product index
  const prBy: (PrItemMatch['mappedBy'])[] = new Array(prItems.length).fill(null);
  const prScore: number[] = new Array(prItems.length).fill(0);
  const lineUsed: boolean[] = new Array(products.length).fill(false);

  // Pass 1 — PRIMARY: exact quantity. Each supplier line, in document order,
  // claims the best still-free PR row that shares its quantity. Among several
  // equal-quantity rows, description similarity picks the best (order breaks ties).
  products.forEach((li, i) => {
    if (li.quantity == null) return;
    let bestJ = -1;
    let bestSc = -1;
    for (let j = 0; j < prItems.length; j++) {
      if (prLine[j] != null) continue;
      if (prItems[j].quantity == null || prItems[j].quantity !== li.quantity) continue;
      const sc = simOf(li, prItems[j]);
      if (sc > bestSc) {
        bestSc = sc;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      prLine[bestJ] = i;
      prBy[bestJ] = 'quantity';
      prScore[bestJ] = Math.round(bestSc * 100) / 100;
      lineUsed[i] = true;
    }
  });

  // Pass 2 — SECONDARY: description similarity for lines the quantity pass didn't
  // place (a supplier who quoted a quantity no PR row has, or a PR row with no qty).
  const cands: { li: number; pr: number; sc: number }[] = [];
  products.forEach((li, i) => {
    if (lineUsed[i]) return;
    prItems.forEach((pr, j) => {
      if (prLine[j] != null) return;
      const sc = simOf(li, pr);
      if (sc >= threshold) cands.push({ li: i, pr: j, sc });
    });
  });
  cands.sort((a, b) => b.sc - a.sc);
  for (const c of cands) {
    if (lineUsed[c.li] || prLine[c.pr] != null) continue;
    prLine[c.pr] = c.li;
    prBy[c.pr] = 'description';
    prScore[c.pr] = Math.round(c.sc * 100) / 100;
    lineUsed[c.li] = true;
  }

  const prItemMatches: PrItemMatch[] = prItems.map((pr, j) => {
    const li = prLine[j];
    if (li == null) {
      return { prIndex: j, state: 'not_quoted' as PrItemMatchState, supplierItem: null, score: 0, mappedBy: null };
    }
    const line = products[li];
    // Quantity-mapped lines are clean matches unless a real spec/grade conflict is
    // detectable; description-mapped lines are matches by construction.
    const conflict =
      prBy[j] === 'quantity' &&
      !itemCodeHit(line.name, pr.itemCode) &&
      specConflict(line.name, prItemText(pr));
    const state: PrItemMatchState = conflict ? 'quoted_spec_diff' : 'quoted_match';
    return { prIndex: j, state, supplierItem: line, score: prScore[j], mappedBy: prBy[j] };
  });

  const extraLines = products.filter((_, i) => !lineUsed[i]);
  const matchCount = prItemMatches.filter((p) => p.state === 'quoted_match').length;
  const specDiffCount = prItemMatches.filter((p) => p.state === 'quoted_spec_diff').length;
  const notQuotedCount = prItemMatches.filter((p) => p.state === 'not_quoted').length;

  return {
    supplier: quotation.supplierName,
    quotationId: quotation.id,
    prItems: prItemMatches,
    extraLines,
    matchCount,
    specDiffCount,
    notQuotedCount,
    allMatched: prItems.length > 0 && matchCount === prItems.length,
  };
}

const short = (s: string, n = 44) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// Common material / quality adjectives — excluded so a derived subject lands on
// the item NOUN ("anchor", "castable") rather than a describing word.
const SUBJECT_ADJECTIVES = new Set([
  'corrugated', 'stainless', 'galvanized', 'galvanised', 'refractory', 'carbon',
  'alloy', 'mild', 'heavy', 'duty', 'high', 'low', 'plastic', 'rubber', 'flexible',
  'rigid', 'industrial', 'standard', 'general', 'spare', 'spares', 'complete',
  'assorted', 'various', 'misc', 'miscellaneous', 'black', 'white', 'round',
  'square', 'new', 'used', 'left', 'right',
]);

/**
 * Best-effort short subject for a set of product line-item descriptions, used as
 * a FALLBACK PR description when the requisition has no header subject of its own.
 * Returns the dominant item noun (e.g. "Anchors") only when one word appears
 * across a STRICT MAJORITY of the items; otherwise '' — better blank than a wrong
 * guess. Spec codes, numbers and describing words are ignored.
 */
export function derivePrSubject(names: string[]): string {
  const clean = names.map((n) => n?.trim()).filter((n): n is string => !!n);
  if (!clean.length) return '';

  const docFreq = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const name of clean) {
    const seen = new Set<string>();
    for (const t of normalizeText(name).split(' ')) {
      if (t.length < 4 || /\d/.test(t) || STOPWORDS.has(t) || SUBJECT_ADJECTIVES.has(t)) continue;
      seen.add(t);
      if (!firstSeen.has(t)) firstSeen.set(t, order++);
    }
    for (const t of seen) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  let best = '';
  let bestN = 0;
  for (const [t, n] of docFreq) {
    if (n > bestN || (n === bestN && (firstSeen.get(t) ?? 0) < (firstSeen.get(best) ?? Infinity))) {
      best = t;
      bestN = n;
    }
  }
  // Require a strict majority (covers "all items share this noun").
  if (!best || bestN * 2 <= clean.length) return '';
  const label = best.charAt(0).toUpperCase() + best.slice(1);
  return label.endsWith('s') ? label : `${label}s`;
}

/**
 * Build AI-SUGGESTED Technical Comments per supplier from the PR matching. These
 * are STARTING POINTS a human reviews/overwrites — item-description match is
 * never sufficient grounds for approval on its own (capability, track record,
 * trust and pricing are human judgment calls). Only emitted when a PR was
 * matched; every entry is marked `aiSuggested: true`.
 *  - all quoted items match  → "Technically accepted (AI-suggested: items match PR description)"
 *  - any item mismatches     → "AI note: items do not match PR description — review required (e.g. …)"
 */
export function suggestTechnicalComments(
  prMatch: PrMatchResult | null | undefined,
  pr: PurchaseRequisition | null | undefined,
): Record<string, TechnicalComment> {
  const out: Record<string, TechnicalComment> = {};
  if (!prMatch || !pr) return out;
  for (const sm of prMatch.bySupplier) {
    const prItems = sm.prItems ?? [];
    const specDiffCount = sm.specDiffCount ?? 0;
    const notQuotedCount = sm.notQuotedCount ?? 0;
    // Every PR item cleanly matched → suggest acceptance.
    if (specDiffCount === 0 && notQuotedCount === 0) {
      out[sm.quotationId] = {
        text: 'Technically accepted (AI-suggested: items match PR description)',
        aiSuggested: true,
      };
      continue;
    }
    const bits: string[] = [];
    if (specDiffCount > 0) {
      const eg = prItems.find((p) => p.state === 'quoted_spec_diff');
      const prIt = eg ? pr.items[eg.prIndex] : null;
      const example = eg?.supplierItem
        ? ` (e.g. "${short(eg.supplierItem.name)}"${prIt ? ` vs PR "${short(prIt.description)}"` : ''})`
        : '';
      bits.push(`${specDiffCount} item(s) quoted, spec differs — verify${example}`);
    }
    if (notQuotedCount > 0) {
      bits.push(`${notQuotedCount} requisition item(s) not quoted — review scope`);
    }
    out[sm.quotationId] = { text: `AI note: ${bits.join(' · ')}`, aiSuggested: true };
  }
  return out;
}

/** Match every supplier's line items against the company PR. */
export function matchQuotationsToPr(
  quotations: ExtractedQuotation[],
  pr: PurchaseRequisition,
  threshold: number = MATCH_THRESHOLD,
): PrMatchResult {
  return {
    bySupplier: quotations.map((q) => matchSupplierItems(q, pr.items, threshold)),
    threshold,
  };
}
