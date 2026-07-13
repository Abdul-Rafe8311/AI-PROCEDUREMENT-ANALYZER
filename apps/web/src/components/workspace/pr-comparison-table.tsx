'use client';

import { Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type AnalysisResult, type ExtractedQuotation } from '@/lib/workspace-types';
import {
  buildComparisonModel,
  type ComparisonRow,
  type SupplierCol,
  supplierGroups,
} from '@/lib/pr-comparison';
import { useFxRates } from '@/lib/use-fx-rates';
import { type CurrencyMode, MoneyDual } from './currency-mode';

// A supplier column plus its absolute index into each row's `cells` array.
type IndexedSupplier = SupplierCol & { colIndex: number };

/**
 * Buyer-format comparison sheet (Phase 3): one row per Purchase Requisition item
 * — the company's own description / qty / UOM shown once on the left — then each
 * supplier's quoted qty + unit price for that same item (dash when not quoted),
 * with freight/transport as its own row. Lowest unit price per row is green.
 * 5+ suppliers wrap into additional stacked blocks, each repeating the left
 * item columns. Falls back to a union of supplier items when no PR was uploaded.
 */
export function PrComparisonTable({
  analysis,
  mode,
}: {
  analysis: AnalysisResult;
  mode: CurrencyMode;
}) {
  const { quotations } = analysis;
  const fx = useFxRates();
  // prOnly: rows come ONLY from the PR document — never a supplier-description
  // union. With no PR line items the grid shows none (+ an explanatory note).
  // USD per-unit is derived from the same live FX as the TA form (exact, 2 dp).
  const model = buildComparisonModel(quotations, analysis.purchaseRequisition, analysis.prMatch, { prOnly: true, fx });
  if (!model.suppliers.length) return null;

  const qById = new Map(quotations.map((q) => [q.id, q]));
  const indexed: IndexedSupplier[] = model.suppliers.map((s, i) => ({ ...s, colIndex: i }));
  const groups = supplierGroups(indexed);
  const hasCharge = model.rows.some((r) => r.kind === 'charge');

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Table2 className="h-4 w-4 text-primary" />
          Item Comparison — Company Format
          {model.hasPr && analysis.purchaseRequisition?.requestNo && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              PR {analysis.purchaseRequisition.requestNo}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {model.hasPr ? 'One row per requisition item' : 'No requisition items'} · unit price ·{' '}
          <span className="text-success">green = lowest</span>
        </span>
      </div>

      {model.rows.length > 0 && (
        <div className="space-y-6 py-2">
          {groups.map((group, gi) => (
            <GroupBlock
              key={gi}
              group={group}
              rows={model.rows}
              qById={qById}
              mode={mode}
              label={groups.length > 1 ? `Suppliers ${group[0].colIndex + 1}–${group[group.length - 1].colIndex + 1} of ${model.suppliers.length}` : null}
            />
          ))}
        </div>
      )}

      {!model.hasPr && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          The Purchase Requisition produced no line items, so there is nothing to compare against line by line.
          Re-upload the PR (with its item table) in the requisition slot to populate the rows.
        </p>
      )}
      {hasCharge && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          A dash in a freight/transport row can mean freight is included in the price or delivery terms — not
          necessarily that it is missing.
        </p>
      )}
    </div>
  );
}

function GroupBlock({
  group,
  rows,
  qById,
  mode,
  label,
}: {
  group: IndexedSupplier[];
  rows: ComparisonRow[];
  qById: Map<string, ExtractedQuotation>;
  mode: CurrencyMode;
  label: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      {label && (
        <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      <table className="w-full text-left text-sm">
        <thead className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th rowSpan={2} className="px-4 py-2 text-left font-semibold">Item Description</th>
            <th rowSpan={2} className="px-3 py-2 text-right font-semibold">Qty</th>
            <th rowSpan={2} className="px-3 py-2 text-left font-semibold">UOM</th>
            {group.map((s) => (
              <th key={s.quotationId} colSpan={2} className="border-l border-border px-3 py-2 text-center font-semibold">
                <span className="block truncate normal-case text-foreground">{s.supplier}</span>
                <span className="block text-[10px] font-normal normal-case text-muted-foreground">
                  {s.reference ? `REF# ${s.reference} · ` : ''}
                  {s.currency}
                </span>
              </th>
            ))}
          </tr>
          <tr>
            {group.map((s) => (
              <SubHeadCells key={s.quotationId} />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <RowView key={`${r.kind}-${r.index}-${r.label}`} row={r} group={group} mode={mode} />
          ))}
          <TotalsRow group={group} qById={qById} mode={mode} />
        </tbody>
      </table>
    </div>
  );
}

// The 2nd header row's per-supplier "Qty | Unit Price" sub-labels.
function SubHeadCells() {
  return (
    <>
      <th className="border-l border-border px-3 py-1.5 text-right font-medium">Qty</th>
      <th className="px-3 py-1.5 text-right font-medium">Unit Price</th>
    </>
  );
}

function RowView({
  row,
  group,
  mode,
}: {
  row: ComparisonRow;
  group: IndexedSupplier[];
  mode: CurrencyMode;
}) {
  return (
    <tr className="align-top transition hover:bg-muted/40">
      <td className="px-4 py-2.5">
        <span className="font-medium">{row.label}</span>
        {row.kind === 'charge' && (
          <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
            {row.category}
          </span>
        )}
        {row.descriptionArabic && (
          <span dir="rtl" className="mt-0.5 block text-xs text-muted-foreground">
            {row.descriptionArabic}
          </span>
        )}
      </td>
      <td className="nums px-3 py-2.5 text-right text-muted-foreground">
        {row.qty == null ? '' : row.qty.toLocaleString('en-US')}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{row.uom ?? ''}</td>
      {group.map((s) => {
        const cell = row.cells[s.colIndex] ?? null;
        const isLow = cell?.unitPriceUsd != null && row.lowestUsd != null && cell.unitPriceUsd === row.lowestUsd;
        return (
          <SupplierCells
            key={s.quotationId}
            qty={cell?.qty ?? null}
            unitPrice={cell?.unitPrice ?? null}
            currency={cell?.currency ?? 'USD'}
            unitPriceUsd={cell?.unitPriceUsd ?? null}
            specDiff={cell?.matchState === 'quoted_spec_diff'}
            isLow={isLow}
            mode={mode}
          />
        );
      })}
    </tr>
  );
}

function SupplierCells({
  qty,
  unitPrice,
  currency,
  unitPriceUsd,
  specDiff,
  isLow,
  mode,
}: {
  qty: number | null;
  unitPrice: number | null;
  currency: string;
  unitPriceUsd: number | null;
  specDiff: boolean;
  isLow: boolean;
  mode: CurrencyMode;
}) {
  return (
    <>
      <td className={cn('nums border-l border-border px-3 py-2.5 text-right text-muted-foreground', isLow && 'bg-success/10')}>
        {qty == null ? '—' : qty.toLocaleString('en-US')}
      </td>
      <td className={cn('nums px-3 py-2.5 text-right', isLow ? 'bg-success/10 font-semibold text-success' : 'text-muted-foreground')}>
        {unitPrice != null ? (
          <>
            <MoneyDual amount={unitPrice} currency={currency} usd={unitPriceUsd} mode={mode} precise />
            {specDiff && (
              <span className="mt-0.5 block text-[10px] font-medium italic text-warning">spec differs</span>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
    </>
  );
}

function TotalsRow({
  group,
  qById,
  mode,
}: {
  group: IndexedSupplier[];
  qById: Map<string, ExtractedQuotation>;
  mode: CurrencyMode;
}) {
  const totalsUsd = [...qById.values()].map((q) => q.totalCostUsd).filter((v): v is number => v != null);
  const minTotal = totalsUsd.length ? Math.min(...totalsUsd) : null;
  return (
    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
      <td className="px-4 py-2.5" colSpan={3}>Total quotation value</td>
      {group.map((s) => {
        const q = qById.get(s.quotationId);
        const isLow =
          q?.totalCostUsd != null && minTotal != null && q.totalCostUsd === minTotal && totalsUsd.length > 1;
        return (
          <td
            key={s.quotationId}
            colSpan={2}
            className={cn('nums border-l border-border px-3 py-2.5 text-right', isLow && 'text-success')}
          >
            {q && (q.totalCost != null || q.totalCostUsd != null) ? (
              <MoneyDual amount={q.totalCost} currency={q.currency} usd={q.totalCostUsd} mode={mode} />
            ) : (
              '—'
            )}
          </td>
        );
      })}
    </tr>
  );
}
