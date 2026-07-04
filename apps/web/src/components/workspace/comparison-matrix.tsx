'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toUsd } from '@/lib/analysis-engine';
import { type ExtractedQuotation, type LineItemCategory } from '@/lib/workspace-types';
import { type CurrencyMode, MoneyDual } from './currency-mode';

// Loose key so the same material from different PDFs ("Reinforcement Steel Bars"
// vs "Steel Reinforcement Bar 12mm") lines up in one row.
const norm = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function ComparisonMatrix({
  quotations,
  mode,
}: {
  quotations: ExtractedQuotation[];
  mode: CurrencyMode;
}) {
  const hasItems = quotations.some((q) => q.lineItems.length > 0);
  if (!quotations.length || !hasItems) return null;

  // Union of item names across ALL suppliers (arbitrary per document).
  const seen = new Map<string, string>(); // normalized -> display name
  const catByKey = new Map<string, LineItemCategory>();
  for (const q of quotations) {
    for (const li of q.lineItems) {
      const k = norm(li.name);
      if (!k) continue;
      if (!seen.has(k)) seen.set(k, li.name);
      const cat = li.category ?? 'product';
      if (cat !== 'product' && !catByKey.has(k)) catByKey.set(k, cat);
    }
  }
  // Products first, then charge lines (freight/shipping/…) so charges read as
  // add-ons that are still counted in the total.
  const items = [...seen.entries()]
    .map(([key, label]) => ({ key, label, category: catByKey.get(key) ?? ('product' as LineItemCategory) }))
    .sort((a, b) => Number(a.category !== 'product') - Number(b.category !== 'product'));

  const totals = quotations.map((q) => q.totalCostUsd);
  const minTotal = Math.min(...totals.filter((v): v is number => v != null));

  const lineFor = (q: ExtractedQuotation, key: string) =>
    q.lineItems.find((l) => norm(l.name) === key);
  // USD value drives the "lowest" comparison regardless of display mode.
  const unitUsd = (q: ExtractedQuotation, key: string): number | null => {
    const li = lineFor(q, key);
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
          Unit price · {mode === 'usd' ? 'USD-normalized' : 'original currency'} ·{' '}
          <span className="text-success">green = lowest</span>
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
            {items.map(({ key, label, category }) => {
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
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{label}</span>
                      {category !== 'product' && (
                        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                          {category}
                        </span>
                      )}
                    </div>
                    {qty != null && category === 'product' && (
                      <div className="nums text-xs text-muted-foreground">
                        Qty {qty.toLocaleString('en-US')}
                      </div>
                    )}
                  </td>
                  {quotations.map((q, i) => {
                    const v = vals[i];
                    const isMin = v != null && v === min;
                    const li = lineFor(q, key);
                    return (
                      <td
                        key={q.id}
                        className={cn(
                          'nums px-5 py-3 text-right',
                          isMin ? 'bg-success/10 font-semibold text-success' : 'text-muted-foreground',
                        )}
                      >
                        {v == null ? (
                          '—'
                        ) : (
                          <MoneyDual
                            amount={li?.unitPrice ?? null}
                            currency={li?.currency ?? 'USD'}
                            usd={v}
                            mode={mode}
                          />
                        )}
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
                    {v == null && q.totalCost == null ? (
                      '—'
                    ) : (
                      <MoneyDual amount={q.totalCost} currency={q.currency} usd={v} mode={mode} />
                    )}
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
