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
  ApprovalFieldValue,
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

/**
 * The DIMENSION numbers in a string — every 2-4 digit run, normalized (leading
 * zeros dropped): "REVA-W.10-200" → {10,200}; "REVA.10-070" → {10,70};
 * "TWS.10(60)-200(140)-40-253" → {10,60,200,140,40,253}; "10 X 70 MM" → {10,70}.
 * Used to line up part-number quotes by the SIZE they encode, not by source order.
 */
function dimNumbers(str: string): Set<string> {
  const out = new Set<string>();
  for (const m of str.matchAll(/\d{2,4}/g)) out.add(String(parseInt(m[0], 10)));
  return out;
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
 * The longest compacted spec/dimension code in a string — e.g.
 * "TWS.10(60)-200(140)-40-253" → "106020014040253" — or null when none is long
 * enough to be distinctive (short part-number codes like "10200" don't qualify).
 */
function longSpecCode(str: string): string | null {
  let best = '';
  for (const c of specCodes(str)) if (c.length > best.length) best = c;
  return best.length >= 8 ? best : null;
}

/**
 * A matched line "differs in spec" when it is clearly the same item but a
 * distinctive attribute disagrees:
 *   1) the stated material GRADE differs — "SS 310" vs "253 MA", "253 MA" vs "253 C";
 *   2) the anchor TYPE/DIMENSION code differs while sharing a long common prefix —
 *      "…-45-253…" vs "…-40-253…" (same anchor, different thickness).
 * Part-number quotes (no long distinctive code, no grade) are NOT flagged — they
 * map by line order and stay clean. This is the only thing that downgrades a
 * quoted cell to "spec differs"; nothing is ever dropped.
 */
function specConflict(name: string, prText: string): boolean {
  const g1 = gradeOf(name);
  const g2 = gradeOf(prText);
  if (g1 && g2 && g1 !== g2) return true;

  const a = longSpecCode(name);
  const b = longSpecCode(prText);
  if (a && b && a !== b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    if (p >= 8) return true; // same family (long shared prefix), codes disagree
  }
  return false;
}

/**
 * True when the supplier line is DESCRIPTIVE prose that disagrees with the PR
 * wording — i.e. it has several meaningful WORDS (not numbers/codes) that the PR
 * item does not. Used to decide whether a WEAK (quantity/order) match is a clean
 * lineup or a "spec differs" one: an opaque part code ("REVA-W.10-200", "ALF.2")
 * has ~no such words and stays clean; a free-text line like "V DIA 10MM H=70MM
 * AISI 310 CAPPED ACC DRWG" has many → flag it for the reviewer.
 */
function descriptiveMismatch(name: string, prText: string): boolean {
  const prTokens = wordTokens(prText);
  let n = 0;
  for (const t of wordTokens(name)) {
    if (t.length < 3 || /\d/.test(t)) continue; // skip tiny tokens and numbers/codes
    if (!prTokens.has(t)) n++;
  }
  return n >= 3;
}

/** Pretty-print a grade signature: "253ma" → "253 MA", "ss310" → "SS 310". */
function prettyGrade(g: string): string {
  const m = g.match(/^(ss)?(\d{2,4})([a-z]{1,3})?$/);
  if (!m) return g.toUpperCase();
  return [m[1] ? m[1].toUpperCase() : '', m[2], m[3] ? m[3].toUpperCase() : ''].filter(Boolean).join(' ');
}

/**
 * A SHORT, honest note on WHAT differs between a quoted line and its PR item, shown
 * next to the "spec differs" flag so the reviewer sees it at a glance. Never claims
 * a perfect match — it names the specific discrepancy:
 *   • a stated GRADE that disagrees ("grade differs: quoted SS 310 vs PR 253 MA");
 *   • a same-family long code whose DIMENSION disagrees ("dimension differs — verify size");
 *   • otherwise a free-text / quantity match where the same item is worded
 *     differently ("size/drawing described differently").
 */
export function specDiffNote(name: string, prText: string): string {
  const g1 = gradeOf(name);
  const g2 = gradeOf(prText);
  if (g1 && g2 && g1 !== g2) return `grade differs: quoted ${prettyGrade(g1)} vs PR ${prettyGrade(g2)}`;

  const a = longSpecCode(name);
  const b = longSpecCode(prText);
  if (a && b && a !== b) return 'dimension differs — verify size';

  return 'size/drawing described differently';
}

/**
 * Match ONE supplier's quoted product items against the PR items, producing a
 * three-state verdict PER PR ITEM (so nothing is double-counted). Charge lines
 * (freight/shipping/insurance/handling) are not requisition items and are excluded.
 *
 * Sameness is decided by DESCRIPTION, never by quantity — a supplier who quotes a
 * smaller/different quantity for the same item still belongs in that PR row.
 * Mapping (in priority order):
 *   1) DESCRIPTION/spec similarity — each supplier line claims the best still-free
 *      PR row it is the same item as (greedy, highest score first);
 *   2) LINE ORDER — remaining lines fill the remaining PR rows in document order
 *      (part-number quotes like "REVA-W.10-200" / "TWS.10(60)-…" quote in PR order,
 *      so this lines them up without a spurious "Not Quoted").
 * Quantity is NEVER a gate. A mapped line is quoted_match UNLESS a spec/grade
 * CONFLICT is detected (e.g. "SS 310" vs "253 MA", "253 MA" vs "253 C") →
 * quoted_spec_diff. A PR item that NO line maps to → not_quoted. Nothing is dropped.
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

  // Pass 1 — PRIMARY: description/spec similarity, assigned greedily from the
  // highest score down (quantity is NOT considered). Full-description suppliers
  // land on their matching row; a grade difference stays a match here and is
  // flagged separately below.
  const cands: { li: number; pr: number; sc: number }[] = [];
  products.forEach((li, i) =>
    prItems.forEach((pr, j) => {
      const sc = simOf(li, pr);
      if (sc >= threshold) cands.push({ li: i, pr: j, sc });
    }),
  );
  cands.sort((a, b) => b.sc - a.sc);
  for (const c of cands) {
    if (lineUsed[c.li] || prLine[c.pr] != null) continue;
    prLine[c.pr] = c.li;
    prBy[c.pr] = 'description';
    prScore[c.pr] = Math.round(c.sc * 100) / 100;
    lineUsed[c.li] = true;
  }

  // Pass 1.5 — DIMENSION match (part-number quotes): for lines the description pass
  // couldn't place, match by shared DISTINCTIVE dimension numbers. A part code like
  // "REVA-W.10-200" shares its distinctive "200" only with the PR's 200(140) row,
  // "REVA.10-070" shares "70" only with the 10×70 NCC-KL-42 anchor, etc. Numbers are
  // IDF-weighted so a size that appears in ONE PR row drives the match, while common
  // numbers (10, 40, 253) are down-weighted — the size decides, NOT source order.
  const N = prItems.length;
  const prDims = prItems.map((pr) => dimNumbers(prItemText(pr)));
  const df = new Map<string, number>();
  for (const dims of prDims) for (const n of dims) df.set(n, (df.get(n) ?? 0) + 1);
  const idf = (n: string) => 1 / (df.get(n) ?? N);

  const dimCands: { li: number; pr: number; sc: number }[] = [];
  products.forEach((li, i) => {
    if (lineUsed[i]) return;
    const lineDims = dimNumbers(li.name);
    prItems.forEach((_, j) => {
      if (prLine[j] != null) return;
      let sc = 0;
      let distinctive = false; // shares a number that is NOT in every PR row
      for (const n of lineDims) {
        if (!prDims[j].has(n)) continue;
        sc += idf(n);
        if ((df.get(n) ?? N) < N) distinctive = true;
      }
      if (sc > 0 && distinctive) dimCands.push({ li: i, pr: j, sc });
    });
  });
  dimCands.sort((a, b) => b.sc - a.sc);
  for (const c of dimCands) {
    if (lineUsed[c.li] || prLine[c.pr] != null) continue;
    prLine[c.pr] = c.li;
    prBy[c.pr] = 'dimension';
    prScore[c.pr] = Math.round(simOf(products[c.li], prItems[c.pr]) * 100) / 100;
    lineUsed[c.li] = true;
  }

  // Pass 1.75 — QUANTITY fallback: a FREE-TEXT line with no code and no dimension
  // to match on (e.g. Krosaki's "V DIA 10MM H=70MM AISI 310 CAPPED ACC DRWG") can
  // still be placed when its QUANTITY uniquely identifies a still-free PR row. Only
  // fires when the qty is unambiguous (exactly one free PR row has it), so it never
  // mis-assigns; among tied lines the best description wins. This is what stops a
  // genuinely-quoted item from falling through to "Not quoted". A quantity-only
  // match means the wording differs from the PR → flagged "spec differs" below.
  const freeRowQtyCount = new Map<number, number>();
  prItems.forEach((pr, j) => {
    if (prLine[j] == null && pr.quantity != null) {
      freeRowQtyCount.set(pr.quantity, (freeRowQtyCount.get(pr.quantity) ?? 0) + 1);
    }
  });
  const qtyCands: { li: number; pr: number; sc: number }[] = [];
  products.forEach((li, i) => {
    if (lineUsed[i] || li.quantity == null) return;
    prItems.forEach((pr, j) => {
      if (prLine[j] != null || pr.quantity == null) return;
      if (pr.quantity === li.quantity && freeRowQtyCount.get(pr.quantity) === 1) {
        qtyCands.push({ li: i, pr: j, sc: simOf(li, pr) });
      }
    });
  });
  qtyCands.sort((a, b) => b.sc - a.sc);
  for (const c of qtyCands) {
    if (lineUsed[c.li] || prLine[c.pr] != null) continue;
    prLine[c.pr] = c.li;
    prBy[c.pr] = 'quantity';
    prScore[c.pr] = Math.round(simOf(products[c.li], prItems[c.pr]) * 100) / 100;
    lineUsed[c.li] = true;
  }

  // Pass 2 — LINE ORDER (last resort, still no quantity gate): any lines the
  // description and dimension passes couldn't place fill remaining rows in order.
  const freeRows = prItems.map((_, j) => j).filter((j) => prLine[j] == null);
  const freeLines = products.map((_, i) => i).filter((i) => !lineUsed[i]);
  freeRows.forEach((j, k) => {
    const i = freeLines[k];
    if (i == null) return;
    prLine[j] = i;
    prBy[j] = 'order';
    prScore[j] = Math.round(simOf(products[i], prItems[j]) * 100) / 100;
    lineUsed[i] = true;
  });

  const prItemMatches: PrItemMatch[] = prItems.map((pr, j) => {
    const li = prLine[j];
    if (li == null) {
      return { prIndex: j, state: 'not_quoted' as PrItemMatchState, supplierItem: null, score: 0, mappedBy: null, note: null };
    }
    const line = products[li];
    const prText = prItemText(pr);
    // An item-code hit is a definitive same-item signal → always a clean match.
    // Otherwise a mapped line is "spec differs" when either a real grade/spec
    // CONFLICT is detected, OR it was placed by a WEAK signal (quantity/order — no
    // code, dimension or description agreed) AND it is descriptive prose that
    // disagrees with the PR wording (a free-text line, not an opaque part code).
    // Part-number quotes that line up by quantity/order stay CLEAN.
    const codeHit = itemCodeHit(line.name, pr.itemCode);
    const weak = prBy[j] === 'quantity' || prBy[j] === 'order';
    const conflict =
      !codeHit && (specConflict(line.name, prText) || (weak && descriptiveMismatch(line.name, prText)));
    const state: PrItemMatchState = conflict ? 'quoted_spec_diff' : 'quoted_match';
    const note = conflict ? specDiffNote(line.name, prText) : null;
    return { prIndex: j, state, supplierItem: line, score: prScore[j], mappedBy: prBy[j], note };
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
 * Resolve the PR Description shown on the Technical Approval Form, handling the two
 * real layouts:
 *   (a) an explicit header "PR Description"/"Subject" field (e.g. PR 12601612 →
 *       "Anchors for production department."), used verbatim; else
 *   (b) DERIVE it from the item table — a SINGLE-item PR (e.g. the 12601707
 *       conversion kit) uses that item's own description; a MULTI-item PR uses a
 *       short dominant-noun summary ("Anchors") when there is one, else the first
 *       item's description.
 * Returns '' only when the requisition genuinely carries no description anywhere.
 */
export function resolvePrDescription(
  pr: { description?: string | null; items: Pick<PrItem, 'description'>[] } | null | undefined,
): string {
  const explicit = pr?.description?.trim();
  if (explicit) return explicit;
  const descs = (pr?.items ?? [])
    .map((it) => it.description?.trim())
    .filter((d): d is string => !!d);
  if (!descs.length) return '';
  if (descs.length === 1) return descs[0];
  return derivePrSubject(descs) || descs[0];
}

/**
 * Build AI-SUGGESTED Technical Comment verdicts per supplier, based ONLY on how
 * the supplier's quoted items compare to the PR items by DESCRIPTION. These are
 * editable starting points — the AI never claims anything it can't see (supplier
 * experience/capability/commercial terms); the wording is strictly about item and
 * spec matching. Every entry is marked `aiSuggested: true` and prefixed
 * "AI SUGGESTED:" (rendered indigo/italic; the tag is dropped once a human edits).
 *
 *  - all PR items quoted, grades match → "AI SUGGESTED: Technically Accepted"
 *  - quoted but some spec/grade differs → "AI SUGGESTED: Technically Accepted —
 *      spec differs on items <list>, review grade" (a spec difference does NOT block)
 *  - genuinely missing PR items → "AI SUGGESTED: Review — items not quoted: <list>"
 */
export function suggestTechnicalComments(
  prMatch: PrMatchResult | null | undefined,
  pr: PurchaseRequisition | null | undefined,
): Record<string, TechnicalComment> {
  const out: Record<string, TechnicalComment> = {};
  if (!prMatch || !pr) return out;
  const nums = (items: PrItemMatch[], state: PrItemMatchState) =>
    items.filter((p) => p.state === state).map((p) => p.prIndex + 1).join(',');

  for (const sm of prMatch.bySupplier) {
    const prItems = sm.prItems ?? [];
    const specList = nums(prItems, 'quoted_spec_diff');
    const missingList = nums(prItems, 'not_quoted');

    let verdict: string;
    if (missingList) {
      verdict = `Review — items not quoted: ${missingList}`;
      if (specList) verdict += `; spec differs on items ${specList}, review grade`;
    } else if (specList) {
      verdict = `Technically Accepted — spec differs on items ${specList}, review grade`;
    } else {
      verdict = 'Technically Accepted';
    }
    out[sm.quotationId] = { text: `AI SUGGESTED: ${verdict}`, aiSuggested: true };
  }
  return out;
}

// The AI pre-fill VALUE (plain text) for the per-supplier Warranty field: the
// warranty verbatim from the quote when stated, else "Not stated" — NEVER an
// invented warranty. Keyed by quotation id.
export function suggestWarranties(quotations: ExtractedQuotation[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of quotations) out[q.id] = q.warranty?.trim() || 'Not stated';
  return out;
}

// The AI pre-fill VALUE for the per-supplier Country of Origin field: the origin
// already derived during extraction (stated, or inferred "Saudi Arabia" for a
// locally-registered supplier), else "Not stated". This is DISPLAY-ONLY — the VAT
// local/international rule always reads the underlying extracted `countryOfOrigin`,
// so editing/hiding this field never changes VAT. Keyed by quotation id.
export function suggestOrigins(quotations: ExtractedQuotation[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of quotations) out[q.id] = q.countryOfOrigin?.trim() || 'Not stated';
  return out;
}

/**
 * Build the per-supplier {@link ApprovalFieldValue} map for a toggleable field
 * (Warranty / Country of Origin) from the fresh AI values plus any persisted human
 * overrides. Fields default ON, showing the AI value (aiSuggested). A persisted
 * `enabled` overrides the toggle; a persisted `text` string (including "") is the
 * human's edit/clear and drops the AI marker. Shared by the PDF and the dialog so
 * both agree on the exact same state. Pure — no IO.
 */
export function buildApprovalFields(
  quotations: ExtractedQuotation[],
  aiText: Record<string, string>,
  overrides: Record<string, { enabled?: boolean; text?: string | null }> = {},
): Record<string, ApprovalFieldValue> {
  const out: Record<string, ApprovalFieldValue> = {};
  for (const q of quotations) {
    const o = overrides[q.id];
    const enabled = o?.enabled ?? true;
    if (o && typeof o.text === 'string') {
      out[q.id] = { enabled, text: o.text, aiSuggested: false };
    } else {
      const ai = aiText[q.id] ?? '';
      out[q.id] = { enabled, text: ai, aiSuggested: ai.trim() !== '' };
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
