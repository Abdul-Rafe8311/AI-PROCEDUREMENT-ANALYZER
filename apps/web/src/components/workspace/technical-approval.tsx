'use client';

import { AlertTriangle, CheckCircle2, ClipboardCheck, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ExtractedQuotation,
  formatCurrency,
  type PrMatchResult,
  type PurchaseRequisition,
  type SupplierItemMatch,
  type SupplierMatch,
} from '@/lib/workspace-types';

// Short quoted-value label, e.g. "×200 @ SAR 160" — used in approved cells.
function quotedLabel(m: SupplierItemMatch): string {
  const li = m.supplierItem;
  const qty = li.quantity != null ? `×${li.quantity.toLocaleString('en-US')}` : '';
  const price = li.unitPrice != null ? `@ ${formatCurrency(li.unitPrice, li.currency)}` : '';
  return [qty, price].filter(Boolean).join(' ');
}

/**
 * Technical Approval (Phase 2): each supplier's quoted line items matched
 * against the company's Purchase Requisition. Shows, at a glance:
 *  • a per-supplier "Items match PR" AI signal (kept SEPARATE from any human
 *    Technical Comments — it is a hint, not a verdict);
 *  • a PR-item × supplier grid — ✓ Technically Approved, or "—" not quoted;
 *  • the technical mismatches (quoted items that matched nothing) with the
 *    closest requisition item, so requested-vs-quoted is visible.
 */
export function TechnicalApproval({
  pr,
  match,
  quotations,
}: {
  pr: PurchaseRequisition;
  match: PrMatchResult;
  quotations: ExtractedQuotation[];
}) {
  if (!match.bySupplier.length || !pr.items.length) return null;

  const qById = new Map(quotations.map((q) => [q.id, q]));

  // For each supplier, map a PR index → the approved supplier item (for the cell).
  const approvedByPr = (sm: SupplierMatch) => {
    const m = new Map<number, SupplierItemMatch>();
    for (const it of sm.items) if (it.status === 'approved' && it.prIndex != null) m.set(it.prIndex, it);
    return m;
  };
  const supplierCells = match.bySupplier.map((sm) => ({ sm, byPr: approvedByPr(sm) }));

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          Technical Approval
          {pr.requestNo && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              PR {pr.requestNo}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
          </span>
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Mismatch
          </span>
          <span className="inline-flex items-center gap-1">
            <MinusCircle className="h-3.5 w-3.5" /> Not quoted
          </span>
        </span>
      </div>

      {/* Per-supplier AI item-match signal — deliberately labelled as a signal,
          NOT a technical accept/reject verdict (that stays a human decision). */}
      <div className="border-b border-border bg-muted/20 px-5 py-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          AI item-match signal · vs requisition
        </div>
        <div className="flex flex-wrap gap-2">
          {match.bySupplier.map((sm) => {
            const ok = sm.allMatched;
            const bits: string[] = [];
            if (sm.mismatchCount) bits.push(`${sm.mismatchCount} mismatch`);
            if (sm.missingPrIndexes.length) bits.push(`${sm.missingPrIndexes.length} not quoted`);
            return (
              <span
                key={sm.quotationId}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                )}
                title={
                  ok
                    ? 'Every requisitioned item was matched to a quoted item.'
                    : 'Some items did not match the requisition — review before technical approval.'
                }
              >
                {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span className="font-semibold">{sm.supplier}</span>
                <span className="opacity-90">
                  Items match PR: {ok ? '✓' : `✗ (${bits.join(' · ')})`}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* PR-item × supplier approval grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Requisition item</th>
              <th className="px-5 py-3 text-right font-semibold">Req. qty</th>
              {match.bySupplier.map(({ supplier, quotationId }) => (
                <th key={quotationId} className="px-5 py-3 text-center font-semibold">
                  {supplier}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pr.items.map((it, idx) => (
              <tr key={idx} className="align-top transition hover:bg-muted/40">
                <td className="px-5 py-3">
                  <span className="font-medium">{it.description || '—'}</span>
                  {it.itemCode && (
                    <span className="nums ml-1.5 text-xs text-muted-foreground">({it.itemCode})</span>
                  )}
                </td>
                <td className="nums px-5 py-3 text-right text-muted-foreground">
                  {it.quantity == null ? '—' : it.quantity.toLocaleString('en-US')}
                  {it.unit ? ` ${it.unit}` : ''}
                </td>
                {supplierCells.map(({ sm, byPr }) => {
                  const hit = byPr.get(idx);
                  return (
                    <td key={sm.quotationId} className="px-5 py-3 text-center">
                      {hit ? (
                        <span
                          className="inline-flex flex-col items-center gap-0.5 text-success"
                          title={`Technically Approved — matched "${hit.supplierItem.name}" (${Math.round(hit.score * 100)}% match)`}
                        >
                          <span className="inline-flex items-center gap-1 text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                          </span>
                          {quotedLabel(hit) && (
                            <span className="nums text-[11px] font-normal text-muted-foreground">
                              {quotedLabel(hit)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          title={`Not quoted by ${sm.supplier}`}
                        >
                          <MinusCircle className="h-3.5 w-3.5" /> Not quoted
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Technical mismatches — quoted items that matched no requisition item. */}
      <MismatchDetails pr={pr} match={match} qById={qById} />

      <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
        Matching is by item description &amp; spec, so wording differences between your requisition and a
        supplier&apos;s quote still line up. &quot;Items match PR&quot; is an AI signal to speed review — the final
        technical accept/reject stays a human decision.
      </p>
    </div>
  );
}

function MismatchDetails({
  pr,
  match,
  qById,
}: {
  pr: PurchaseRequisition;
  match: PrMatchResult;
  qById: Map<string, ExtractedQuotation>;
}) {
  const withMismatch = match.bySupplier.filter((sm) => sm.mismatchCount > 0);
  if (!withMismatch.length) return null;

  return (
    <div className="border-t border-border bg-warning/5 px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="h-4 w-4" />
        Technical mismatches — review requested vs quoted
      </div>
      <div className="space-y-3">
        {withMismatch.map((sm) => (
          <div key={sm.quotationId}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sm.supplier}
            </div>
            <ul className="mt-1.5 space-y-2">
              {sm.items
                .filter((i) => i.status === 'mismatch')
                .map((i, k) => {
                  const closest = i.closestPrIndex != null ? pr.items[i.closestPrIndex] : null;
                  const q = qById.get(sm.quotationId);
                  const currency = i.supplierItem.currency || q?.currency || 'USD';
                  return (
                    <li
                      key={k}
                      className="rounded-lg border border-warning/30 bg-card p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-warning">
                          Quoted
                        </span>
                        <span className="font-medium">{i.supplierItem.name}</span>
                        {i.supplierItem.unitPrice != null && (
                          <span className="nums text-xs text-muted-foreground">
                            {i.supplierItem.quantity != null
                              ? `×${i.supplierItem.quantity.toLocaleString('en-US')} `
                              : ''}
                            @ {formatCurrency(i.supplierItem.unitPrice, currency)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          Closest requisition item
                        </span>
                        {closest ? (
                          <>
                            <span>{closest.description}</span>
                            {closest.itemCode && (
                              <span className="nums text-xs">({closest.itemCode})</span>
                            )}
                            <span className="text-xs">· {Math.round(i.score * 100)}% match</span>
                          </>
                        ) : (
                          <span className="text-xs">none — no requisition item is close</span>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
