// Shared builder for the buyer's own comparison-sheet format: ONE row per
// company Purchase Requisition (PR) item — the company's own description, qty
// and unit shown once on the left — then each supplier's quoted qty + unit
// price for that same item (blank when a supplier didn't quote it). Freight and
// other charges are shown as their own rows per supplier.
//
// Used by BOTH the on-screen comparison table (Phase 3) and the Technical
// Approval Form PDF (Phase 4) so the two always agree. When no PR was uploaded
// it falls back to a union of the suppliers' own line items (the previous
// behavior), so nothing regresses without a PR.

import { toUsd } from './analysis-engine';
import type {
  ExtractedQuotation,
  LineItemCategory,
  PrItemMatchState,
  PrMatchResult,
  PurchaseRequisition,
  SupplierMatch,
} from './workspace-types';

export interface SupplierCol {
  quotationId: string;
  supplier: string;
  reference: string | null;
  currency: string;
}

export interface SupplierCell {
  /** the supplier's OWN description for this row (their wording), null when not quoted */
  description: string | null;
  qty: number | null;
  /** unit price (charge rows: the lump-sum amount) in `currency` */
  unitPrice: number | null;
  currency: string;
  /** USD-normalized unit price — drives the "lowest" highlight across currencies */
  unitPriceUsd: number | null;
  /** PR-item match state for this cell (PR rows only) — 'quoted_spec_diff' flags a grade/spec difference */
  matchState?: PrItemMatchState | null;
}

export interface ComparisonRow {
  kind: 'pr' | 'product' | 'charge';
  /** display index (1-based within its section) */
  index: number;
  /** the company's item description (PR rows) or the item/charge label */
  label: string;
  descriptionArabic?: string | null;
  /** the company's requisitioned qty (PR rows) / agreed qty (union rows) */
  qty: number | null;
  uom: string | null;
  category: LineItemCategory;
  /** one cell per supplier (same order as `suppliers`); null = not quoted */
  cells: (SupplierCell | null)[];
  /** the lowest USD unit price among present cells (only when ≥2 differ) — for green highlight */
  lowestUsd: number | null;
}

export interface ComparisonModel {
  suppliers: SupplierCol[];
  rows: ComparisonRow[];
  /** true when rows are driven by an uploaded company PR */
  hasPr: boolean;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Canonical charge buckets — different suppliers label freight differently
// ("Sea freight", "Transport Price CIF Jeddah", "Freight and FOB charges"), so
// they collapse into one "Freight / Transport" row rather than fragmenting.
const CHARGE_BUCKET: Record<Exclude<LineItemCategory, 'product'>, { key: string; label: string; rank: number }> = {
  freight: { key: 'freight', label: 'Freight / Transport', rank: 1 },
  shipping: { key: 'freight', label: 'Freight / Transport', rank: 1 },
  insurance: { key: 'insurance', label: 'Insurance', rank: 2 },
  handling: { key: 'handling', label: 'Handling', rank: 2 },
  other: { key: 'other', label: 'Other Charges', rank: 3 },
};

function cellUsd(unitPrice: number | null, currency: string): number | null {
  return unitPrice == null ? null : toUsd(unitPrice, currency);
}

function lowestUsdOf(cells: (SupplierCell | null)[]): number | null {
  const usd = cells.filter((c): c is SupplierCell => !!c && c.unitPriceUsd != null).map((c) => c.unitPriceUsd!);
  if (usd.length < 2) return null;
  const min = Math.min(...usd);
  const max = Math.max(...usd);
  return min === max ? null : min;
}

// PR-item rows: the company's own description/qty/uom on the left; each
// supplier's cell is the item it quoted for that row — its OWN wording, qty and
// unit price — shown whether the match is a clean match OR a spec-diff, so the
// buyer sees exactly what was quoted. A cell is null only when the supplier didn't
// quote that PR item at all (→ "Not Quoted"). The match model already assigns one
// quoted line per PR item (description match, else exact-quantity fallback).
function prRows(
  pr: PurchaseRequisition,
  quotations: ExtractedQuotation[],
  prMatch: PrMatchResult | null,
): ComparisonRow[] {
  const byQuotation = new Map<string, SupplierMatch>(
    (prMatch?.bySupplier ?? []).map((sm) => [sm.quotationId, sm]),
  );
  return pr.items.map((it, idx) => {
    const cells = quotations.map<SupplierCell | null>((q) => {
      const pm = byQuotation.get(q.id)?.prItems?.[idx] ?? null;
      const li = pm?.supplierItem ?? null;
      if (!li) return null;
      return {
        description: li.name,
        qty: li.quantity,
        unitPrice: li.unitPrice,
        currency: li.currency,
        unitPriceUsd: cellUsd(li.unitPrice, li.currency),
        matchState: pm?.state ?? null,
      };
    });
    return {
      kind: 'pr',
      index: idx + 1,
      label: it.description || '—',
      descriptionArabic: it.descriptionArabic ?? null,
      qty: it.quantity,
      uom: it.unit,
      category: 'product',
      cells,
      lowestUsd: lowestUsdOf(cells),
    };
  });
}

// Union of the suppliers' own PRODUCT line items (no PR uploaded).
function unionProductRows(quotations: ExtractedQuotation[]): ComparisonRow[] {
  const meta = new Map<string, { label: string; seq: number }>();
  let seq = 0;
  for (const q of quotations) {
    for (const li of q.lineItems) {
      if ((li.category ?? 'product') !== 'product') continue;
      const k = norm(li.name);
      if (!k || meta.has(k)) continue;
      meta.set(k, { label: li.name, seq: seq++ });
    }
  }
  const keys = [...meta.keys()].sort((a, b) => meta.get(a)!.seq - meta.get(b)!.seq);
  return keys.map((k, i) => {
    const lines = quotations.map((q) => q.lineItems.find((l) => norm(l.name) === k && (l.category ?? 'product') === 'product') ?? null);
    const cells = lines.map<SupplierCell | null>((li) =>
      li
        ? { description: li.name, qty: li.quantity, unitPrice: li.unitPrice, currency: li.currency, unitPriceUsd: cellUsd(li.unitPrice, li.currency) }
        : null,
    );
    const qtys = lines.filter((l) => l).map((l) => l!.quantity).filter((v): v is number => v != null);
    const qty = qtys.length && qtys.every((v) => v === qtys[0]) ? qtys[0] : null;
    const uom = lines.find((l) => l?.uom)?.uom ?? null;
    return {
      kind: 'product',
      index: i + 1,
      label: meta.get(k)!.label,
      qty,
      uom,
      category: 'product',
      cells,
      lowestUsd: lowestUsdOf(cells),
    };
  });
}

// Charge rows (freight/insurance/handling/other), collapsed into canonical
// buckets, one row per bucket present, each supplier's summed amount in its cell.
function chargeRows(quotations: ExtractedQuotation[], startIndex: number): ComparisonRow[] {
  const buckets = new Map<string, { label: string; rank: number; cat: LineItemCategory }>();
  for (const q of quotations) {
    for (const li of q.lineItems) {
      const cat = li.category ?? 'product';
      if (cat === 'product') continue;
      const b = CHARGE_BUCKET[cat as Exclude<LineItemCategory, 'product'>];
      if (!buckets.has(b.key)) buckets.set(b.key, { label: b.label, rank: b.rank, cat: cat as LineItemCategory });
    }
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[1].rank - b[1].rank);
  return ordered.map(([key, b], i) => {
    const cells = quotations.map<SupplierCell | null>((q) => {
      const lines = q.lineItems.filter((li) => {
        const cat = li.category ?? 'product';
        return cat !== 'product' && CHARGE_BUCKET[cat as Exclude<LineItemCategory, 'product'>].key === key;
      });
      if (!lines.length) return null;
      const amount = lines.reduce((sum, li) => sum + (li.totalPrice ?? li.unitPrice ?? 0), 0);
      // Keep the supplier's OWN charge wording (e.g. "Sea freight", "Transport CIF").
      return { description: lines[0]?.name ?? null, qty: null, unitPrice: amount, currency: q.currency, unitPriceUsd: cellUsd(amount, q.currency) };
    });
    return {
      kind: 'charge',
      index: startIndex + i,
      label: b.label,
      qty: null,
      uom: null,
      category: b.cat,
      cells,
      lowestUsd: lowestUsdOf(cells),
    };
  });
}

/**
 * Build the buyer-format comparison model. When a PR is present, rows are the
 * company's requisition items (+ charge rows); otherwise a union of supplier
 * line items (+ charge rows).
 */
export function buildComparisonModel(
  quotations: ExtractedQuotation[],
  pr: PurchaseRequisition | null | undefined,
  prMatch: PrMatchResult | null | undefined,
  opts?: { prOnly?: boolean },
): ComparisonModel {
  const suppliers: SupplierCol[] = quotations.map((q) => ({
    quotationId: q.id,
    supplier: q.supplierName,
    reference: q.reference ?? null,
    currency: q.currency,
  }));
  const hasPr = !!(pr && pr.items.length);
  // Product rows come from the PR. `prOnly` (the Technical Approval Form) NEVER
  // fabricates rows from supplier descriptions — with no PR items it shows none.
  // The on-screen comparison view leaves prOnly unset and keeps the union fallback.
  const productRows = hasPr
    ? prRows(pr!, quotations, prMatch ?? null)
    : opts?.prOnly
      ? []
      : unionProductRows(quotations);
  const charges = chargeRows(quotations, productRows.length + 1);
  return { suppliers, rows: [...productRows, ...charges], hasPr };
}

/** Supplier-group chunk size for wrapping 5+ suppliers into stacked blocks. */
export const SUPPLIERS_PER_GROUP = 4;

/** Split supplier indices into groups so 5+ suppliers wrap into extra blocks. */
export function supplierGroups<T>(items: T[], size = SUPPLIERS_PER_GROUP): T[][] {
  if (items.length <= size) return [items];
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}
