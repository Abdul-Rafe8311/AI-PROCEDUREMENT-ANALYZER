// One quotation, several priced ALTERNATIVES for the same item → one supplier
// COLUMN per alternative.
//
// FAOZ's QT 000030292 against PR 12602262 prints an Option column reading A, B, 2:
//
//   A   cover (roller stop inside) part no 866, ident no. 146328.02 … AISI 4140   22,000.00
//   B   cover (roller stop inside) part no 866, ident no. 146328.02 … ST-52        8,000.00
//   2   Bolt part no 874, ident no. 146332.06 …                42CrMo4                850.00
//
// A and B are mutually EXCLUSIVE — the buyer picks one — so they are not two
// purchasable line items (which would total 30,850). Nor is either droppable: the
// choice is the point of the quote. The buyer compares them side by side, exactly
// as they would two different suppliers. The 2, meanwhile, is not an option at
// all: it is simply the second ROW, and the Bolt is payable either way.
//
// ── Why the requisition decides this, and not the supplier's wording ─────────
// Telling an option label from a row number by comparing supplier lines to each
// other does not work. These two items share almost all of their words ("for
// grinding roller stop - inside for VRM"), so a text-similarity test scores them
// 0.714 on terse wording — above any workable threshold — and the Bolt becomes a
// phantom third column. The only reliable evidence that they are different items
// is the PART and IDENT numbers, and the authority on those is the company's own
// requisition, not the seller's prose.
//
// So: anchor each quoted line to a PR item by its codes, THEN look for several
// lines landing on the SAME PR item at DIFFERENT prices. That is an option.
// A PR item with exactly one quoted line never is, whatever the label says.
//
// With no requisition uploaded (it is optional), fall back to comparing the
// supplier's own lines — weaker, but better than ignoring options entirely.
//
// Runs at ANALYSIS time (assembleAnalysis), because that is where the PR first
// meets the quotations. Pure and offline: no LLM, no network.

import { matchSupplierItems, MATCH_THRESHOLD, similarity, specCodes } from './item-matching';
import type { ExtractedQuotation, LineItem, PrItem, PurchaseRequisition } from './workspace-types';

/** Product lines only — charges (freight, handling) are never an alternative. */
const productsOf = (q: ExtractedQuotation) =>
  (q.lineItems ?? []).filter((li) => (li.category ?? 'product') === 'product');

/**
 * An option label written into the item's NAME rather than its own column —
 * matched as a LEADING marker only ("Option A — cover …", "OPTION # B:"), so a
 * description merely mentioning options in passing is never treated as labelled.
 */
const NAME_LABEL = /^\s*(?:option|opt|alt|alternative)\s*(?:#|no\.?|number)?\s*([a-z0-9])\s*[-–—:.)\]]*\s+/i;

/** "option a" / "A." / "#A" → "A", so one option is never counted as two. */
function normalizeLabel(raw: string): string {
  const cleaned = raw
    .replace(/^\s*(?:option|opt|alt|alternative)\s*/i, '')
    .replace(/^[#\s]*(?:no\.?|number)?[#\s]*/i, '')
    .replace(/[-–—:.)\]\s]+$/, '')
    .trim();
  return (cleaned || raw.trim()).toUpperCase();
}

/** The label as WRITTEN against a line — not yet a judgement that it IS an option. */
function rawLabelOf(li: LineItem): string | null {
  const explicit = String(li.optionLabel ?? '').trim();
  if (explicit) return normalizeLabel(explicit);
  const m = NAME_LABEL.exec(String(li.name ?? ''));
  return m ? normalizeLabel(m[1]) : null;
}

/** Strip a leading "Option A — " once the option has its own column. */
const stripNameLabel = (name: string) => name.replace(NAME_LABEL, '').trim() || name.trim();

/** What a line contributes to a total: its own total, else qty x unit price. */
function amountOf(li: LineItem): number {
  if (li.foc) return 0;
  if (li.totalPrice != null && Number.isFinite(li.totalPrice)) return li.totalPrice;
  const unit = li.unitPrice != null && Number.isFinite(li.unitPrice) ? li.unitPrice : 0;
  const qty = li.quantity != null && Number.isFinite(li.quantity) ? li.quantity : 1;
  return unit * qty;
}

/** The price a line is offered at — what distinguishes two alternatives. */
const priceOf = (li: LineItem): number | null => {
  const a = amountOf(li);
  return Number.isFinite(a) ? a : null;
};

// ── PR anchoring ────────────────────────────────────────────────────────────

/**
 * Anchor a quoted line to the PR item it answers, by DISTINCTIVE CODE.
 *
 * On 12602262 the authoritative identifiers — part no 866 / ident no 146328.02,
 * part no 874 / ident no 146332.06 — appear in the requisition's own item text.
 *
 * Only codes belonging to EXACTLY ONE PR item count. A requisition for five
 * anchors repeats "253" and "40" across nearly every line, so a shared code like
 * that says nothing about which item is meant; the size that appears on ONE row
 * is what identifies it. (The PR matcher's dimension pass weights numbers the
 * same way, for the same reason.) Without this, several lines of one offer anchor
 * to the same PR item on a common code and get mistaken for alternatives — the
 * 12601612 fixture split into 9 columns instead of 5.
 *
 * Among distinctive codes the LONGEST wins: "14632802" is decisive where a bare
 * "866" could coincide.
 *
 * Returns null when the line shares no distinctive code with any PR item. Such a
 * line is no evidence about options either way, and is carried into every column.
 */
function anchorToPr(li: LineItem, prCodes: Set<string>[], distinctive: Map<string, number>): number | null {
  const codes = specCodes(String(li.name ?? ''));
  if (!codes.size) return null;
  let bestIdx: number | null = null;
  let bestScore = 0;
  prCodes.forEach((pc, idx) => {
    let score = 0;
    for (const c of codes) {
      // `distinctive` maps a code to the ONE PR item carrying it; codes shared by
      // several items are absent and contribute nothing.
      if (pc.has(c) && distinctive.get(c) === idx) score += c.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    } else if (score === bestScore && score > 0) {
      bestIdx = null; // an ambiguous tie anchors nowhere
    }
  });
  return bestScore > 0 ? bestIdx : null;
}

/** Codes carried by exactly ONE PR item → the index of that item. */
function distinctiveCodes(prCodes: Set<string>[]): Map<string, number> {
  const count = new Map<string, number>();
  const owner = new Map<string, number>();
  prCodes.forEach((pc, idx) => {
    for (const c of pc) {
      count.set(c, (count.get(c) ?? 0) + 1);
      owner.set(c, idx);
    }
  });
  const out = new Map<string, number>();
  for (const [c, n] of count) if (n === 1) out.set(c, owner.get(c)!);
  return out;
}

const prItemText = (it: PrItem) => [it.description, it.itemCode ?? ''].filter(Boolean).join(' ');

// ── the split ───────────────────────────────────────────────────────────────

interface OptionPlan {
  /** for each column, the chosen line per option-group PR index */
  columns: { label: string; own: LineItem[] }[];
  /** lines shared by every column (single-line items, charges, unanchored) */
  shared: LineItem[];
}

/** Build columns from groups of lines that answer the SAME PR item differently. */
function planFromGroups(groups: Map<number, LineItem[]>, rest: LineItem[]): OptionPlan | null {
  // An option group: 2+ lines on one PR item, at 2+ DIFFERENT prices, carrying 2+
  // DISTINCT WRITTEN LABELS.
  //
  // The label requirement is what separates alternatives from parts of one price.
  // Saudi Fal's S1262128249 also puts two differently-priced lines on a single
  // requisition item — "GUARDIAN-AND-FMR-PORTABLE." at 16,430 plus a "Reactivation
  // Fee" at 6,735 — but those are ADDITIVE: both are payable, and the quote's own
  // total is their sum. FAOZ's A and B are EXCLUSIVE: one or the other.
  // Structurally the two cases are identical, so the document's own labelling is
  // the only honest way to tell them apart.
  //
  // When nothing is labelled the additive reading wins, because it preserves the
  // money: pricing a column at one of two lines that were meant to be summed
  // understates the offer, while showing both costs nothing but a wider cell (they
  // are combined into one — see pr-comparison).
  const optionGroups: LineItem[][] = [];
  const shared: LineItem[] = [...rest];
  for (const lines of groups.values()) {
    const prices = new Set(lines.map((l) => priceOf(l)));
    const labels = new Set(lines.map(rawLabelOf).filter(Boolean));
    if (lines.length >= 2 && prices.size >= 2 && labels.size >= 2) optionGroups.push(lines);
    else shared.push(...lines);
  }
  if (!optionGroups.length) return null;

  const width = Math.max(...optionGroups.map((g) => g.length));
  if (width < 2) return null;

  // Labels come from the document when it wrote them, else A, B, C… The widest
  // group names the columns, so "Option A"/"Option B" survive verbatim.
  const namer = optionGroups.find((g) => g.length === width)!;
  const labels: string[] = [];
  for (let k = 0; k < width; k++) {
    const written = rawLabelOf(namer[k]);
    const fallback = String.fromCharCode(65 + k);
    const label = written && !labels.includes(written) ? written : fallback;
    labels.push(labels.includes(label) ? `${label}${k + 1}` : label);
  }

  return {
    columns: labels.map((label, k) => ({
      label,
      // A group narrower than the widest simply has no line for this column.
      own: optionGroups.map((g) => g[k]).filter((l): l is LineItem => !!l),
    })),
    shared,
  };
}

/**
 * PRIMARY: group the quote's lines by the PR item each one answers.
 *
 * The assignment is done by `matchSupplierItems` — the app's own PR matcher —
 * rather than by anything invented here. It already resolves each quoted line to
 * one requisition row through description, part-code, dimension and quantity
 * passes, and it is what the rest of the form is built on, so options can never
 * disagree with the grid about which line answers which item.
 *
 * Reusing it also settles a case a bare code anchor gets wrong: Supply Wave
 * quotes every anchor in GRADE SS 310, and "310" happens to be distinctive to the
 * requisition's SS 310 row — so a code anchor pulls all five of its lines onto
 * that one item and calls them five alternatives. The matcher spreads them across
 * the five rows they actually answer, because a grade is not an identifier.
 *
 * A line the matcher could not place (`extraLines`, or the `additionalItems` a
 * single-item PR collects) is then offered back to the item its distinctive codes
 * point at — that is how FAOZ's second cover rejoins the first as its alternative.
 */
function planAgainstPr(q: ExtractedQuotation, pr: PurchaseRequisition): OptionPlan | null {
  const sm = matchSupplierItems(q, pr.items);
  const groups = new Map<number, LineItem[]>();
  for (const p of sm.prItems) {
    const own = [p.supplierItem, ...(p.additionalItems ?? [])].filter((l): l is LineItem => !!l);
    if (own.length) groups.set(p.prIndex, own);
  }

  // Charges are never an alternative; they belong to every column.
  const rest: LineItem[] = (q.lineItems ?? []).filter((li) => (li.category ?? 'product') !== 'product');

  const prCodes = pr.items.map((it) => specCodes(prItemText(it)));
  const distinctive = distinctiveCodes(prCodes);
  for (const li of sm.extraLines) {
    const idx = anchorToPr(li, prCodes, distinctive);
    if (idx != null && groups.has(idx)) groups.set(idx, [...groups.get(idx)!, li]);
    else rest.push(li);
  }

  // Keep every group in document order, so "Option A" is the one printed first.
  const order = new Map((q.lineItems ?? []).map((li, i) => [li, i]));
  for (const [idx, lines] of groups) {
    groups.set(idx, [...lines].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return planFromGroups(groups, rest);
}

/**
 * FALLBACK, no requisition uploaded: judge the labels by comparing the quote's own
 * lines to each other.
 *
 * Weaker than the PR anchor and known to be so — this is the test that scores
 * FAOZ's cover against its bolt at 0.714 on terse wording. It is kept only
 * because ignoring options entirely when no PR was uploaded would be worse.
 *
 * A label counts only when some OTHER line is the same item under a DIFFERENT
 * label: an alternative is one of several ways to buy one thing, so a real option
 * label always has a same-item sibling, whereas a row number sits on an item
 * nothing else describes.
 */
function planWithoutPr(q: ExtractedQuotation): OptionPlan | null {
  const products = productsOf(q);
  const raw = products.map(rawLabelOf);

  const genuine = new Set<string>();
  for (let i = 0; i < products.length; i++) {
    if (!raw[i]) continue;
    for (let j = i + 1; j < products.length; j++) {
      if (!raw[j] || raw[j] === raw[i]) continue;
      if (similarity(String(products[i].name ?? ''), String(products[j].name ?? '')) < MATCH_THRESHOLD) continue;
      genuine.add(raw[i]!);
      genuine.add(raw[j]!);
    }
  }
  if (genuine.size < 2) return null;

  // Anything not genuine reverts to an ordinary shared line.
  const byLabel = new Map<string, LineItem[]>();
  const rest: LineItem[] = (q.lineItems ?? []).filter((li) => (li.category ?? 'product') !== 'product');
  products.forEach((li, i) => {
    const label = raw[i] && genuine.has(raw[i]!) ? raw[i]! : null;
    if (!label) rest.push(li);
    else byLabel.set(label, [...(byLabel.get(label) ?? []), li]);
  });

  const labels = [...byLabel.keys()];
  const totals = labels.map((l) => byLabel.get(l)!.reduce((s, li) => s + amountOf(li), 0));
  if (new Set(totals).size < 2) return null;

  return { columns: labels.map((label) => ({ label, own: byLabel.get(label)! })), shared: rest };
}

/** Rebuild one quotation per column, in document order, with its own total. */
function applyPlan(q: ExtractedQuotation, plan: OptionPlan): ExtractedQuotation[] {
  const all = q.lineItems ?? [];
  return plan.columns.map((col, k) => {
    const keep = new Set<LineItem>([...col.own, ...plan.shared]);
    const lineItems = all
      .filter((li) => keep.has(li))
      .map((li) => ({ ...li, name: stripNameLabel(String(li.name ?? '')), optionLabel: null }));
    // The document's single stated total can only ever describe ONE option (FAOZ's
    // states none at all), so each column's total is its own sum: 22,000 + 850 =
    // 22,850 for A, 8,000 + 850 = 8,850 for B.
    const total = lineItems.reduce((s, li) => s + amountOf(li), 0);
    return {
      ...q,
      id: `${q.id}__opt${k}`,
      supplierName: `${(q.supplierName ?? '').trim() || 'Supplier'}, OPTION # ${col.label}`,
      lineItems,
      totalCost: total,
      // Re-derived downstream from `totalCost` by applyFxRates.
      totalCostUsd: null,
      totalCostInclVat: null,
    };
  });
}

/**
 * Split every quotation that offers priced alternatives into one column each.
 *
 * The requisition is the primary signal when one was uploaded; otherwise the
 * supplier's own labels are used. Quotations with no alternatives are returned
 * unchanged, by identity.
 */
export function splitQuotationOptions(
  quotations: ExtractedQuotation[],
  pr?: PurchaseRequisition | null,
): ExtractedQuotation[] {
  const usePr = !!(pr && pr.items?.length);
  return quotations.flatMap((q) => {
    if ((q.lineItems ?? []).length < 2) return [q];
    const plan = usePr ? planAgainstPr(q, pr!) : planWithoutPr(q);
    return plan ? applyPlan(q, plan) : [q];
  });
}
