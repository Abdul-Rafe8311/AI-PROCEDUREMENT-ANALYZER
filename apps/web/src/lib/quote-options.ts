// One quotation, several priced ALTERNATIVES for the same item → one supplier
// COLUMN per alternative.
//
// FAOZ's QT 000030292 against PR 12602262 offers the same cover two ways:
//
//   Option A  cover … Material: AISI 4140   1 PC  22,000.00
//   Option B  cover … Material: ST-52       1 PC   8,000.00
//   2         Bolt  … Material: 42CrMo4     1 PC      850.00
//
// A and B are mutually EXCLUSIVE — the buyer picks one — so they are not two
// purchasable line items (which would total 30,850). Nor is either droppable: the
// whole point of the quote is the choice. The buyer compares them side by side,
// exactly as they would two different suppliers.
//
// That is what this module produces: "FAOZ …, OPTION # A" and "FAOZ …, OPTION # B"
// as separate suppliers, each carrying its own option line PLUS every unlabelled
// line (the Bolt appears, at 850, under both), sharing the one REF#.
//
// The split happens at the LLM-boundary — before `mapSupplier` assigns ids and
// column positions — so nothing downstream needs to know. Supplier columns ARE
// the quotation array (see pr-comparison.buildComparisonModel), and the numbering
// "SUPPLIER #n" is positional, so both options take real supplier slots and the
// next distinct supplier continues the count.
//
// Pure and offline: no LLM, no network.

import type { LlmSupplier } from './extraction-server';

/** A line item as the model returns it — structurally what this module needs. */
interface OptionLine {
  name?: string | null;
  optionLabel?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  category?: string | null;
  foc?: boolean;
  [k: string]: unknown;
}

/**
 * An option label written into the item's NAME rather than its own field — the
 * fallback for when the model fills `name` but not `optionLabel`. Matches a
 * LEADING marker only ("Option A — cover …", "OPTION # B:", "Alt 2)"), so a part
 * description that merely mentions options in passing is never split on.
 */
const NAME_LABEL = /^\s*(?:option|opt|alt|alternative)\s*(?:#|no\.?|number)?\s*([a-z0-9])\s*[-–—:.)\]]*\s+/i;

/** The option a line belongs to, or null when it is common to every option. */
function labelOf(li: OptionLine): string | null {
  const explicit = String(li.optionLabel ?? '').trim();
  if (explicit) return normalizeLabel(explicit);
  const m = NAME_LABEL.exec(String(li.name ?? ''));
  return m ? normalizeLabel(m[1]) : null;
}

/** "option a" / "A." / "#A" → "A", so the same option is never counted twice. */
function normalizeLabel(raw: string): string {
  const cleaned = raw
    .replace(/^\s*(?:option|opt|alt|alternative)\s*/i, '')
    .replace(/^[#\s]*(?:no\.?|number)?[#\s]*/i, '')
    .replace(/[-–—:.)\]\s]+$/, '')
    .trim();
  return (cleaned || raw.trim()).toUpperCase();
}

/** Strip a leading "Option A — " from a description once it is its own column. */
function stripNameLabel(name: string): string {
  return name.replace(NAME_LABEL, '').trim() || name.trim();
}

/** What this line contributes to a total: its own total, else qty x unit price. */
function amountOf(li: OptionLine): number {
  if (li.foc) return 0;
  const total = typeof li.totalPrice === 'number' && Number.isFinite(li.totalPrice) ? li.totalPrice : null;
  if (total != null) return total;
  const unit = typeof li.unitPrice === 'number' && Number.isFinite(li.unitPrice) ? li.unitPrice : 0;
  const qty = typeof li.quantity === 'number' && Number.isFinite(li.quantity) ? li.quantity : 1;
  return unit * qty;
}

/**
 * Split one parsed supplier into one supplier PER PRICING OPTION.
 *
 * Returns `[supplier]` unchanged unless the document really does carry two or
 * more distinct option labels — every ordinary quotation is passed straight
 * through, so this can sit on the main extraction path safely.
 */
export function splitSupplierOptions(supplier: LlmSupplier): LlmSupplier[] {
  const lines = (supplier.lineItems ?? []) as OptionLine[];
  if (lines.length < 2) return [supplier];

  // Labels in the order the document states them, so "Option A" stays the first
  // column. A single label means "Option A" with no alternative — not a split.
  const labels: string[] = [];
  for (const li of lines) {
    const label = labelOf(li);
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (labels.length < 2) return [supplier];

  // Unlabelled lines belong to EVERY option: FAOZ's Bolt is quoted once and is
  // payable whichever cover the buyer takes, so it must appear under both columns
  // and count towards both totals. Charge lines (freight) work the same way.
  const shared = lines.filter((li) => labelOf(li) == null);

  return labels.map((label) => {
    const own = lines.filter((li) => labelOf(li) === label);
    // Document order is preserved so the option's own item keeps its position
    // relative to the shared ones (cover first, then bolt).
    const kept = lines.filter((li) => own.includes(li) || shared.includes(li));
    const lineItems = kept.map((li) => ({
      ...li,
      name: stripNameLabel(String(li.name ?? '')),
      optionLabel: null,
    }));

    // The stated grand total can only ever describe ONE option (FAOZ's document
    // states none at all), so it is recomputed per column instead of copied —
    // 22,000 + 850 = 22,850 for A, 8,000 + 850 = 8,850 for B. Everything that is
    // NOT a per-option figure (delivery, payment, warranty, origin, the REF#) is
    // a fact about the quotation and is shared verbatim.
    const total = kept.reduce((sum, li) => sum + amountOf(li), 0);
    const statedWithoutVat = supplier.totalWithoutVat != null;

    return {
      ...supplier,
      supplierName: `${(supplier.supplierName ?? '').trim() || 'Supplier'}, OPTION # ${label}`,
      lineItems: lineItems as LlmSupplier['lineItems'],
      totalAmount: total,
      // A VAT amount computed off the whole document would be wrong for a single
      // option; the without-VAT figure is this option's own sum.
      ...(statedWithoutVat ? { totalWithoutVat: total } : {}),
      vatAmount: null,
      totalsByCurrency: null,
    };
  });
}

/** Apply the option split across a parsed document's suppliers, in order. */
export function splitQuoteOptions(suppliers: LlmSupplier[]): LlmSupplier[] {
  return suppliers.flatMap(splitSupplierOptions);
}
