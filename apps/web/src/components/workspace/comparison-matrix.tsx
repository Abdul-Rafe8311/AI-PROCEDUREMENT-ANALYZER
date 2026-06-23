'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toUsd } from '@/lib/analysis-engine';
import { type ExtractedQuotation, formatCurrency } from '@/lib/workspace-types';

// Loose key so the same material from different PDFs ("Reinforcement Steel Bars"
// vs "Steel Reinforcement Bar 12mm") lines up in one row.
const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function ComparisonMatrix({ quotations }: { quotations: ExtractedQuotation[] }) {
  const hasItems = quotations.some((q) => q.lineItems.length > 0);
  if (!quotations.length || !hasItems) return null;

  // Union of item names across ALL suppliers (arbitrary per document).
  const seen = new Map<string, string>(); // normalized -> display name
  for (const q of quotations) {
    for (const li of q.lineItems) {
      const k = norm(li.name);
      if (k && !seen.has(k)) seen.set(k, li.name);
    }
  }
  const items = [...seen.entries()].map(([key, label]) => ({ key, label }));

  const totals = quotations.map((q) => q.totalCostUsd);
  const minTotal = Math.min(...totals.filter((v): v is number => v != null));

  const unitUsd = (q: ExtractedQuotation, key: string): number | null => {
    const li = q.lineItems.find((l) => norm(l.name) === key);
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
            {items.map(({ key, label }) => {
              const vals = quotations.map((q) => unitUsd(q, key));
              const present = vals.filter((v): v is number => v != null);
              const min = present.length ? Math.min(...present) : null;
              const qty =
                quotations
                  .flatMap((q) => q.lineItems)
                  .find((l) => norm(l.name) === key)?.quantity ?? null;
              return (
                <tr key={key} className="transition hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <div className="font-medium">{label}</div>
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
      <FxNote quotations={quotations} />
    </div>
  );
}

// Shows the exchange rates used when suppliers quote in different currencies.
function FxNote({ quotations }: { quotations: ExtractedQuotation[] }) {
  const rates = new Map<string, number>();
  for (const q of quotations) {
    if (q.currency && q.currency !== 'USD') rates.set(q.currency, q.usdRate);
  }
  if (!rates.size) return null;
  return (
    <div className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
      Cross-currency totals normalized to USD —{' '}
      {[...rates.entries()].map(([c, r]) => `1 ${c} = $${r.toFixed(4)}`).join(' · ')}
    </div>
  );
}
