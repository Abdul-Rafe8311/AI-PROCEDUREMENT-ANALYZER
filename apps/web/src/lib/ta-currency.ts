// Which currencies the Technical Approval Form prints, and how a chosen set turns
// into the actual lines in a cell.
//
// The reviewer picks any combination of Original / SAR / USD in the Customize
// dialog, separately for LINE ITEMS and for the TOTALS row, per download. Nothing
// is persisted: a three-currency sheet for one PR and a SAR-only one for the next
// is a normal thing to want, and silently carrying one PR's choice into the next
// produces a signed document nobody chose the shape of.
//
// ── Why two settings and not one ───────────────────────────────────────────
// Their defaults genuinely differ, and both defaults are load-bearing:
//
//   line items → ORIGINAL only. A unit price gets checked against the supplier's
//     own quotation, so by default it must read exactly as it does there.
//   totals     → ORIGINAL + SAR + USD. This is where cross-offer comparison
//     actually happens, and it is what every TA form to date has printed.
//
// Collapsing them into one control would have forced one of those two to change,
// which is the regression this module exists to avoid.
//
// ── What this module guarantees ────────────────────────────────────────────
//  • The printed lines and the column header are derived from the SAME call, so a
//    header can never name a currency the cell below it does not print.
//  • A selection is de-duplicated against the quoted currency: a SAR supplier with
//    {original, SAR} selected prints ONE line, not "SAR 10.36 / SAR 10.36".
//  • A currency whose rate is unavailable is dropped rather than guessed, and a
//    cell never resolves to nothing — it falls back to the quoted figure.
//
// Pure — no IO, no React, no pdf/xlsx types. Both renderers and the server-side
// .xlsx route import it.

import { type FxRates, toSar, toUsd } from './fx-rates';

/** One currency a cell can print. 'original' = whatever the supplier quoted in. */
export type TaCurrency = 'original' | 'sar' | 'usd';

/** The reviewer's choice, for one part of the form. Order is print order. */
export type TaCurrencySelection = TaCurrency[];

export interface TaCurrencyDisplay {
  /** currencies printed against each quoted line item */
  lineItems: TaCurrencySelection;
  /** currencies printed on the Total Price row */
  totals: TaCurrencySelection;
}

/**
 * What the form did before the control existed — and what it still does when the
 * reviewer touches nothing. Line items as quoted; totals in all three.
 */
export const TA_CURRENCY_DISPLAY_DEFAULT: TaCurrencyDisplay = {
  lineItems: ['original'],
  totals: ['original', 'sar', 'usd'],
};

/** Canonical print order, so the UI can offer the choices in a stable sequence. */
export const TA_CURRENCY_ORDER: TaCurrency[] = ['original', 'sar', 'usd'];

export const TA_CURRENCY_LABEL: Record<TaCurrency, string> = {
  original: 'Original (as quoted)',
  sar: 'SAR',
  usd: 'USD',
};

/** One resolved line of a money cell. */
export interface MoneyLine {
  /** which choice produced it */
  kind: TaCurrency;
  /** the ISO code actually printed (for 'original', the supplier's own) */
  code: string;
  /** the amount in `code` */
  amount: number;
  /** true when this figure was restated from the quoted currency */
  converted: boolean;
}

const upper = (c: string) => (c ?? '').toUpperCase();

/** Put a selection back into canonical order and drop duplicates/unknowns. */
export function normalizeSelection(sel: TaCurrencySelection | undefined, fallback: TaCurrencySelection): TaCurrencySelection {
  const seen = TA_CURRENCY_ORDER.filter((c) => (sel ?? []).includes(c));
  // An empty selection is not a form — it is a blank column. Fall back rather than
  // print nothing.
  return seen.length ? seen : fallback;
}

/**
 * Turn a chosen set of currencies into the lines a cell should actually print.
 *
 * De-duplicates by resulting currency code (a SAR quote with {original, SAR}
 * selected yields one line), drops any currency the rate feed cannot supply, and
 * never returns an empty list for a real amount.
 */
export function resolveMoneyLines(
  amount: number | null | undefined,
  quotedCurrency: string,
  fx: FxRates | null,
  selection: TaCurrencySelection,
): MoneyLine[] {
  if (amount == null || !Number.isFinite(amount)) return [];
  const own = upper(quotedCurrency) || 'SAR';
  const out: MoneyLine[] = [];
  const taken = new Set<string>();

  const push = (kind: TaCurrency, code: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return; // no rate → never guessed
    if (taken.has(code)) return; // same currency already printed
    taken.add(code);
    out.push({ kind, code, amount: value, converted: code !== own });
  };

  for (const kind of normalizeSelection(selection, ['original'])) {
    if (kind === 'original') push('original', own, amount);
    else if (kind === 'sar') push('sar', 'SAR', own === 'SAR' ? amount : fx ? toSar(amount, own, fx) : null);
    else push('usd', 'USD', own === 'USD' ? amount : fx ? toUsd(amount, own, fx) : null);
  }

  // Every requested currency was unavailable (no rate, and 'original' not chosen).
  // Show what the supplier actually quoted rather than an empty cell.
  if (!out.length) out.push({ kind: 'original', code: own, amount, converted: false });
  return out;
}

/**
 * The currency codes a column header should name — exactly the codes
 * `resolveMoneyLines` will print for that supplier, in the same order.
 *
 * Derived from the same inputs on purpose: a header reading "(EUR)" above SAR
 * figures is worse than either choice on its own.
 */
export function headerCurrencies(quotedCurrency: string, fx: FxRates | null, selection: TaCurrencySelection): string[] {
  // A representative non-zero amount — we only want the CODES, and 1 converts
  // through the same rate table as any other value.
  return resolveMoneyLines(1, quotedCurrency, fx, selection).map((l) => l.code);
}

/** "EUR / SAR" — the parenthetical for a Unit Price column header. */
export function headerLabel(quotedCurrency: string, fx: FxRates | null, selection: TaCurrencySelection): string {
  return headerCurrencies(quotedCurrency, fx, selection).join(' / ');
}

/**
 * True when this selection will restate a supplier's figures away from what they
 * quoted. Drives the Customize dialog's inline warning — the reviewer should know
 * they are about to print numbers that will not match the supplier's own document.
 */
export function convertsAwayFromQuoted(quotedCurrencies: string[], selection: TaCurrencySelection): boolean {
  const sel = normalizeSelection(selection, ['original']);
  if (sel.includes('original')) return false; // the quoted figure is still on the form
  return quotedCurrencies.some((c) => {
    const own = upper(c);
    // A SAR supplier under a SAR-only selection is not "converted" — same number.
    return !sel.some((k) => (k === 'sar' && own === 'SAR') || (k === 'usd' && own === 'USD'));
  });
}

/** True when anything on the form is a converted figure — the FX stamp must show. */
export function showsConvertedFigures(
  quotedCurrencies: string[],
  display: TaCurrencyDisplay,
): boolean {
  const anyConverted = (sel: TaCurrencySelection) =>
    quotedCurrencies.some((c) => {
      const own = upper(c);
      return normalizeSelection(sel, ['original']).some(
        (k) => (k === 'sar' && own !== 'SAR') || (k === 'usd' && own !== 'USD'),
      );
    });
  return anyConverted(display.lineItems) || anyConverted(display.totals);
}
