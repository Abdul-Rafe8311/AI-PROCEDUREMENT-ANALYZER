'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toUsd } from '@/lib/analysis-engine';
import { type ExtractedQuotation, formatCurrency } from '@/lib/workspace-types';

export function ComparisonMatrix({ quotations }: { quotations: ExtractedQuotation[] }) {
  if (!quotations.length || !quotations[0].lineItems.length) return null;

  const items = quotations[0].lineItems.map((li) => li.name);
  const totals = quotations.map((q) => q.totalCostUsd);
  const minTotal = Math.min(...totals.filter((v): v is number => v != null));

  const unitUsd = (q: ExtractedQuotation, name: string): number | null => {
    const li = q.lineItems.find((l) => l.name === name);
    return li?.unitPrice == null ? null : toUsd(li.unitPrice, li.currency);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-primary" />
          Line-Item Comparison Matrix
        </span>
        <span className="text-xs text-muted-foreground">
          Unit price · USD-normalized · <span className="text-success">green = lowest</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Item</th>
              {quotations.map((q) => (
                <th key={q.id} className="px-5 py-3 text-right font-semibold">
                  {q.supplierName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((name) => {
              const vals = quotations.map((q) => unitUsd(q, name));
              const present = vals.filter((v): v is number => v != null);
              const min = present.length ? Math.min(...present) : null;
              const qty = quotations[0].lineItems.find((l) => l.name === name)?.quantity ?? null;
              return (
                <tr key={name} className="transition hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <div className="font-medium">{name}</div>
                    {qty != null && (
                      <div className="nums text-xs text-muted-foreground">
                        Qty {qty.toLocaleString('en-US')}
                      </div>
                    )}
                  </td>
                  {quotations.map((q, i) => {
                    const v = vals[i];
                    const isMin = v != null && v === min;
                    return (
                      <td
                        key={q.id}
                        className={cn(
                          'nums px-5 py-3 text-right',
                          isMin ? 'bg-success/10 font-semibold text-success' : 'text-muted-foreground',
                        )}
                      >
                        {v == null ? '—' : formatCurrency(v, 'USD')}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-5 py-3">Total quotation value</td>
              {quotations.map((q, i) => {
                const v = totals[i];
                const isMin = v != null && v === minTotal;
                return (
                  <td
                    key={q.id}
                    className={cn('nums px-5 py-3 text-right', isMin && 'text-success')}
                  >
                    {v == null ? '—' : formatCurrency(v, 'USD')}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
