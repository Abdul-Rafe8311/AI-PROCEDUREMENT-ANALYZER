'use client';

import { ClipboardList, ScanLine } from 'lucide-react';
import type { PurchaseRequisition } from '@/lib/workspace-types';

/**
 * Shows the company's own Purchase Requisition exactly as extracted: the
 * Request No. + header fields, and one row per requisitioned item (item code,
 * description in English/Arabic, qty, unit). Read-only — it is the buyer's
 * document, and (from Phase 2) the basis for matching supplier line items.
 */
export function PrSummary({ pr }: { pr: PurchaseRequisition }) {
  const header: { label: string; value: string | null | undefined }[] = [
    { label: 'Request No.', value: pr.requestNo },
    { label: 'Date', value: pr.date },
    { label: 'Department', value: pr.departmentCode },
    { label: 'Requester', value: pr.requesterName },
    { label: 'Approved by', value: pr.approvedBy },
  ].filter((f) => f.value);

  const hasArabic = pr.items.some((it) => it.descriptionArabic);

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/5 px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-primary" />
          Company Purchase Requisition
          {pr.requestNo && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {pr.requestNo}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {pr.method === 'vision' && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
              title="Read from a scan/photo using Claude vision"
            >
              <ScanLine className="h-3 w-3" /> read from scan
            </span>
          )}
          {pr.items.length} item{pr.items.length === 1 ? '' : 's'}
        </span>
      </div>

      {header.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border bg-muted/20 px-5 py-3 text-sm">
          {header.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {f.label}
              </dt>
              <dd className="truncate font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {pr.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Item Code</th>
                <th className="px-5 py-3 font-semibold">Description</th>
                <th className="px-5 py-3 text-right font-semibold">Qty</th>
                <th className="px-5 py-3 font-semibold">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pr.items.map((it, i) => (
                <tr key={i} className="align-top transition hover:bg-muted/40">
                  <td className="nums px-5 py-3 font-medium">{it.itemCode ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium">{it.description || '—'}</span>
                    {it.descriptionArabic && (
                      <span dir="rtl" className="mt-0.5 block text-xs text-muted-foreground">
                        {it.descriptionArabic}
                      </span>
                    )}
                  </td>
                  <td className="nums px-5 py-3 text-right">
                    {it.quantity == null ? '—' : it.quantity.toLocaleString('en-US')}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{it.unit ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          No line items were extracted from this requisition.
        </p>
      )}

      {hasArabic && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          Bilingual requisition — Arabic descriptions shown beneath the English.
        </p>
      )}
    </div>
  );
}
