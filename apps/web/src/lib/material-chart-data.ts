// Pure data model for the "Material Price Comparison" chart. Kept out of the
// React component so it can be unit-tested. It compares UNIT PRICES only,
// anchored to the company's PR items (the same PR-matched rows the TA form uses):
// freight/charge lines are excluded (lump sums, not per-unit prices), each cell is
// the supplier's matched unit price in USD (+ SAR) at the live rate, to 2 decimals.

import { type FxRates, toSar, toUsd } from './fx-rates';
import type {
  ExtractedQuotation,
  LineItem,
  PrMatchResult,
  PurchaseRequisition,
} from './workspace-types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MatMeta {
  desc: string;
  qty: number | null;
  sar: number | null;
  usd: number;
}

export type MatRow = {
  /** short x-axis label, e.g. "200(140)" */
  item: string;
  /** full PR item description (tooltip title) */
  fullItem: string;
  /** per-supplier unit price in USD (keyed by full supplier name); null = not quoted */
  [supplier: string]: number | null | string | Record<string, MatMeta>;
  _meta: Record<string, MatMeta>;
};

/**
 * A short, readable x-axis label for a PR item (e.g. "200(140)", "SS 310 / KL-42",
 * "170(80)"). Prefers the embedded size, then a grade + drawing code, then a size
 * like "10 X 70", finally the item code / first words. Never invents a value.
 */
export function shortItemLabel(description: string, itemCode?: string | null): string {
  // Anchor names read TYPE(sub)-SIZE(sub) (e.g. "TWS.10(60)-200(140)-…"); the
  // DISTINCTIVE size is the LAST dimension group, not the shared "10(60)" prefix.
  const dims = [...description.matchAll(/(\d{2,4})\s*\(\s*(\d{2,4})\s*\)/g)];
  if (dims.length) {
    const m = dims[dims.length - 1];
    return `${m[1]}(${m[2]})`;
  }
  const bits: string[] = [];
  const grade = description.match(/\bSS\s*\d{3}\b/i);
  if (grade) bits.push(grade[0].replace(/\s+/g, ' ').toUpperCase());
  const drw = description.match(/\bKL[-\s]?\d+\b/i);
  if (drw) bits.push(drw[0].replace(/\s+/g, '').replace(/^KL-?/i, 'KL-').toUpperCase());
  if (bits.length) return bits.join(' / ');
  const size = description.match(/\b\d+\s*[xX]\s*\d+\b/);
  if (size) return size[0].replace(/\s+/g, ' ');
  return (itemCode || description.split(/\s+/).slice(0, 2).join(' ')).slice(0, 16);
}

/** UNIT-price cell for a matched line — null for freight/charges or missing price/rate. */
function priceCell(li: LineItem | null, fx: FxRates | null): MatMeta | null {
  if (!li || (li.category && li.category !== 'product')) return null;
  if (li.unitPrice == null || !fx) return null;
  const u = toUsd(li.unitPrice, li.currency, fx);
  if (u == null) return null;
  const sar = toSar(li.unitPrice, li.currency, fx);
  return { desc: li.name, qty: li.quantity, sar: sar != null ? r2(sar) : null, usd: r2(u) };
}

/**
 * Build the grouped bar-chart rows. PR-anchored when a PR + match are present
 * (x-axis = the PR items, one bar per supplier); otherwise a product-only union
 * of the quoted lines (freight excluded), grouped by a normalized name.
 */
export function buildMaterialData(
  quotations: ExtractedQuotation[],
  prMatch: PrMatchResult | null | undefined,
  pr: PurchaseRequisition | null | undefined,
  fx: FxRates | null,
): { materialData: MatRow[]; materialSuppliers: string[] } {
  const supNames = quotations.map((q) => q.supplierName);
  const makeRow = (item: string, fullItem: string, cellFor: (name: string) => MatMeta | null): MatRow => {
    const row = { item, fullItem, _meta: {} as Record<string, MatMeta> } as MatRow;
    for (const name of supNames) {
      const m = cellFor(name);
      (row as Record<string, number | null>)[name] = m ? m.usd : null;
      if (m) row._meta[name] = m;
    }
    return row;
  };

  // PR-anchored (primary): x-axis = the PR items, in PR order.
  if (prMatch && pr && pr.items.length) {
    const bySup = new Map(prMatch.bySupplier.map((s) => [s.supplier, s]));
    const materialData = pr.items.map((it, j) =>
      makeRow(shortItemLabel(it.description, it.itemCode), it.description, (name) =>
        priceCell(bySup.get(name)?.prItems[j]?.supplierItem ?? null, fx),
      ),
    );
    return { materialData, materialSuppliers: supNames };
  }

  // No PR: group PRODUCT lines (freight excluded) by a normalized name.
  const norm = (s: string) =>
    s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const seen = new Map<string, string>();
  for (const q of quotations) {
    for (const li of q.lineItems) {
      if (li.category && li.category !== 'product') continue;
      const k = norm(li.name);
      if (k && !seen.has(k)) seen.set(k, li.name);
    }
  }
  const materialData = [...seen.entries()].slice(0, 8).map(([key, label]) =>
    makeRow(shortItemLabel(label), label, (name) => {
      const q = quotations.find((x) => x.supplierName === name);
      const li = q?.lineItems.find((l) => (!l.category || l.category === 'product') && norm(l.name) === key);
      return priceCell(li ?? null, fx);
    }),
  );
  return { materialData, materialSuppliers: supNames };
}
