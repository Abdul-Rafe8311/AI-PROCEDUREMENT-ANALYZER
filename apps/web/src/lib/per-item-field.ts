// Fields that are usually one value for a whole offer, but sometimes differ per
// line item — Country of Origin and Delivery Time.
//
// A supplier can quote five anchors where two are made in China and three in
// Germany, or where item 1 ships ex-stock and item 2 takes six weeks. Collapsing
// that to a single cell picks one and prints it as if it covered everything, which
// is how a buyer plans around a two-week lead time that only ever applied to one
// line. So when the values genuinely differ, the form names the items:
//
//   "Item #1 (China), Item #2 (Germany)"
//   "Item #1 (2 weeks), Item #2 (6 weeks)"
//
// and when they agree — the common case — it stays the single plain value it
// always was. Nothing is invented: an item with no stated value is simply left out
// of the list, and an offer with nothing stated anywhere returns ''.

/** One line item's value for a per-item field. */
export interface PerItemValue {
  /** 1-based item number as printed on the form */
  index: number;
  /** the value stated for that item, or null when the document states none */
  value: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

/**
 * Render a per-item field for one supplier.
 *
 * @param items      each product line's own stated value, in printed order
 * @param offerWide  the value the document states for the offer as a whole
 *
 * Precedence is deliberate: PER-ITEM values win when they disagree with each
 * other, because that disagreement is the whole point. When every item agrees (or
 * only one item states anything) the result is that single value. When no item
 * states anything, the offer-wide value is used. When nothing is stated at all the
 * result is '' — the caller prints "Not stated"; it is never back-filled from
 * somewhere else.
 */
export function describePerItem(items: PerItemValue[], offerWide?: string | null): string {
  const stated = items.map((it) => ({ ...it, value: clean(it.value) })).filter((it) => it.value);
  const wide = clean(offerWide);

  if (!stated.length) return wide ?? '';

  const distinct = new Set(stated.map((it) => it.value!.toLowerCase()));
  // Everything that stated a value agrees → one plain value, as before.
  if (distinct.size === 1) {
    // …unless the offer-wide value contradicts it, in which case the per-item
    // statement is the more specific fact and wins.
    return stated[0].value!;
  }
  // They genuinely differ → name the items so the buyer can see which is which.
  return stated.map((it) => `Item #${it.index} (${it.value})`).join(', ');
}

/** True when this supplier's items disagree — the form is showing a per-item list. */
export function variesPerItem(items: PerItemValue[]): boolean {
  const stated = items.map((it) => clean(it.value)).filter((v): v is string => !!v);
  return new Set(stated.map((v) => v.toLowerCase())).size > 1;
}
