'use client';

import { useState } from 'react';
import { Bug, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ExtractionDebug as Debug, formatCurrency } from '@/lib/workspace-types';

export function ExtractionDebug({ debug }: { debug: Debug[] }) {
  const [open, setOpen] = useState(false);
  if (!debug.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Bug className="h-4 w-4 text-primary" />
          Extraction Debug
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {debug.length} file{debug.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-semibold">File</th>
                <th className="px-5 py-2.5 font-semibold">Supplier</th>
                <th className="px-5 py-2.5 font-semibold">Currency</th>
                <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                <th className="px-5 py-2.5 font-semibold">Delivery</th>
                <th className="px-5 py-2.5 font-semibold">Payment</th>
                <th className="px-5 py-2.5 font-semibold">Warranty</th>
                <th className="px-5 py-2.5 text-right font-semibold">Items</th>
                <th className="px-5 py-2.5 font-semibold">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {debug.map((d, i) => (
                <tr key={i} className="align-top">
                  <td className="max-w-[10rem] truncate px-5 py-3 font-medium" title={d.fileName}>
                    {d.fileName}
                    <div className="text-xs font-normal text-muted-foreground">
                      {d.textLength.toLocaleString('en-US')} chars
                    </div>
                  </td>
                  <td className="px-5 py-3">{d.supplier}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium">{d.currency}</span>
                    <div className="text-xs text-muted-foreground">
                      {Math.round(d.currencyConfidence * 100)}% conf.
                    </div>
                  </td>
                  <td className="nums px-5 py-3 text-right">
                    {d.total == null ? '—' : formatCurrency(d.total, d.currency)}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{d.delivery ?? '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{d.payment ?? '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{d.warranty ?? '—'}</td>
                  <td className="nums px-5 py-3 text-right">{d.lineItems}</td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        d.method === 'llm'
                          ? 'bg-success/15 text-success'
                          : d.method === 'vision'
                            ? 'bg-primary/10 text-primary'
                            : d.method === 'heuristic'
                              ? 'bg-warning/15 text-warning'
                              : 'bg-danger/15 text-danger',
                      )}
                      title={
                        d.method === 'vision'
                          ? 'Extracted from a scan/photo using Claude vision'
                          : undefined
                      }
                    >
                      {d.method === 'vision' ? 'vision (scan)' : d.method}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
