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
  PrItem,
  PrMatchResult,
  PurchaseRequisition,
  SupplierItemMatch,
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
 * Match ONE supplier's quoted product items against the PR items. Charge lines
 * (freight/shipping/insurance/handling) are not requisition items and are
 * excluded from matching.
 */
export function matchSupplierItems(
  quotation: ExtractedQuotation,
  prItems: PrItem[],
  threshold: number = MATCH_THRESHOLD,
): SupplierMatch {
  const products = quotation.lineItems.filter((li) => (li.category ?? 'product') === 'product');

  const items: SupplierItemMatch[] = products.map((li) => {
    let bestIdx = -1;
    let bestScore = 0;
    prItems.forEach((pr, idx) => {
      let sc = similarity(li.name, prItemText(pr));
      if (itemCodeHit(li.name, pr.itemCode)) sc = Math.max(sc, 0.95);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = idx;
      }
    });
    const approved = bestScore >= threshold && bestIdx >= 0;
    return {
      supplierItem: li,
      prIndex: approved ? bestIdx : null,
      closestPrIndex: bestIdx >= 0 ? bestIdx : null,
      status: approved ? 'approved' : 'mismatch',
      score: Math.round(bestScore * 100) / 100,
    };
  });

  const covered = new Set<number>();
  for (const it of items) if (it.prIndex != null) covered.add(it.prIndex);
  const missingPrIndexes = prItems.map((_, i) => i).filter((i) => !covered.has(i));

  const approvedCount = items.filter((i) => i.status === 'approved').length;
  const mismatchCount = items.filter((i) => i.status === 'mismatch').length;
  const allMatched = prItems.length > 0 && mismatchCount === 0 && missingPrIndexes.length === 0;

  return {
    supplier: quotation.supplierName,
    quotationId: quotation.id,
    items,
    missingPrIndexes,
    approvedCount,
    mismatchCount,
    allMatched,
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
    if (sm.mismatchCount === 0) {
      let text = 'Technically accepted (AI-suggested: items match PR description)';
      if (sm.missingPrIndexes.length) {
        text += ` · Note: ${sm.missingPrIndexes.length} requisition item(s) not quoted — review scope.`;
      }
      out[sm.quotationId] = { text, aiSuggested: true };
    } else {
      const m = sm.items.find((i) => i.status === 'mismatch');
      const closest = m && m.closestPrIndex != null ? pr.items[m.closestPrIndex] : null;
      const eg = m
        ? ` (e.g. "${short(m.supplierItem.name)}"${closest ? ` vs PR "${short(closest.description)}"` : ''})`
        : '';
      out[sm.quotationId] = {
        text: `AI note: items do not match PR description — review required${eg}`,
        aiSuggested: true,
      };
    }
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
