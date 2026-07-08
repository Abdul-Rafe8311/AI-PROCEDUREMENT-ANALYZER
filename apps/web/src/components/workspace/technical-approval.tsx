'use client';

import { AlertTriangle, CheckCircle2, ClipboardCheck, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ExtractedQuotation,
  formatUnitPrice,
  type LineItem,
  type PrItemMatch,
  type PrMatchResult,
  type PurchaseRequisition,
  type SupplierMatch,
} from '@/lib/workspace-types';

// Short quoted-value label, e.g. "×200 @ SAR 160.00" — used in quoted cells.
// Unit price keeps 2 decimals (never rounded to a whole number).
function quotedLabel(li: LineItem): string {
  const qty = li.quantity != null ? `×${li.quantity.toLocaleString('en-US')}` : '';
  const price = li.unitPrice != null ? `@ ${formatUnitPrice(li.unitPrice, li.currency)}` : '';
  return [qty, price].filter(Boolean).join(' ');
}

/**
 * Technical Approval (Phase 2): each supplier's quoted line items matched
 * against the company's Purchase Requisition. Shows, at a glance:
 *  • a per-supplier "Items match PR" AI signal (kept SEPARATE from any human
 *    Technical Comments — it is a hint, not a verdict);
 *  • a PR-item × supplier grid with THREE non-overlapping states per cell —
 *    ✓ Approved (quoted & spec matches), ⚠ Quoted · spec differs, or — Not quoted;
 *  • the spec-differences (quoted by part-number / different grade) with the
 *    requisition item, so requested-vs-quoted is visible.
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

  // For each supplier, map a PR index → its per-PR-item verdict (for the cell).
  const prByIndex = (sm: SupplierMatch) => {
    const m = new Map<number, PrItemMatch>();
    for (const p of sm.prItems ?? []) m.set(p.prIndex, p);
    return m;
  };
  const supplierCells = match.bySupplier.map((sm) => ({ sm, byPr: prByIndex(sm) }));

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
            <AlertTriangle className="h-3.5 w-3.5" /> Quoted · spec differs
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
            if (sm.specDiffCount) bits.push(`${sm.specDiffCount} spec differ`);
            if (sm.notQuotedCount) bits.push(`${sm.notQuotedCount} not quoted`);
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
                    : 'Some items were quoted with a differing spec or not quoted — review before technical approval.'
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
                  const p = byPr.get(idx);
                  const li = p?.supplierItem ?? null;
                  const quoted = p && p.state !== 'not_quoted' && li;
                  return (
                    <td key={sm.quotationId} className="px-5 py-3 text-center">
                      {quoted && p.state === 'quoted_match' ? (
                        <span
                          className="inline-flex flex-col items-center gap-0.5 text-success"
                          title={`Technically Approved — matched "${li.name}" (${Math.round(p.score * 100)}% match)`}
                        >
                          <span className="inline-flex items-center gap-1 text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                          </span>
                          {quotedLabel(li) && (
                            <span className="nums text-[11px] font-normal text-muted-foreground">
                              {quotedLabel(li)}
                            </span>
                          )}
                        </span>
                      ) : quoted ? (
                        <span
                          className="inline-flex flex-col items-center gap-0.5 text-warning"
                          title={`Quoted, but spec/description differs — "${li.name}" (mapped by ${p.mappedBy})`}
                        >
                          <span className="inline-flex items-center gap-1 text-xs font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5" /> Quoted · spec differs
                          </span>
                          {quotedLabel(li) && (
                            <span className="nums text-[11px] font-normal text-muted-foreground">
                              {quotedLabel(li)}
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

      {/* Spec differences — quoted (by different grade / part number) but not a clean match. */}
      <SpecDiffDetails pr={pr} match={match} qById={qById} />

      <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
        Matching is by item description &amp; spec, with an exact-quantity fallback so a supplier who quotes by
        internal part number still lines up against the requisition. &quot;Items match PR&quot; is an AI signal to
        speed review — the final technical accept/reject stays a human decision.
      </p>
    </div>
  );
}

function SpecDiffDetails({
  pr,
  match,
  qById,
}: {
  pr: PurchaseRequisition;
  match: PrMatchResult;
  qById: Map<string, ExtractedQuotation>;
}) {
  const withDiff = match.bySupplier.filter((sm) => sm.specDiffCount > 0);
  if (!withDiff.length) return null;

  return (
    <div className="border-t border-border bg-warning/5 px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="h-4 w-4" />
        Quoted, spec differs — review requested vs quoted
      </div>
      <div className="space-y-3">
        {withDiff.map((sm) => (
          <div key={sm.quotationId}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sm.supplier}
            </div>
            <ul className="mt-1.5 space-y-2">
              {(sm.prItems ?? [])
                .filter((p) => p.state === 'quoted_spec_diff' && p.supplierItem)
                .map((p, k) => {
                  const reqItem = pr.items[p.prIndex] ?? null;
                  const li = p.supplierItem!;
                  const q = qById.get(sm.quotationId);
                  const currency = li.currency || q?.currency || 'USD';
                  return (
                    <li key={k} className="rounded-lg border border-warning/30 bg-card p-3 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-warning">
                          Quoted
                        </span>
                        <span className="font-medium">{li.name}</span>
                        {li.unitPrice != null && (
                          <span className="nums text-xs text-muted-foreground">
                            {li.quantity != null ? `×${li.quantity.toLocaleString('en-US')} ` : ''}
                            @ {formatUnitPrice(li.unitPrice, currency)}
                          </span>
                        )}
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          mapped by {p.mappedBy}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          Requisition item
                        </span>
                        {reqItem ? (
                          <>
                            <span>{reqItem.description}</span>
                            {reqItem.itemCode && (
                              <span className="nums text-xs">({reqItem.itemCode})</span>
                            )}
                            <span className="text-xs">· {Math.round(p.score * 100)}% description match</span>
                          </>
                        ) : (
                          <span className="text-xs">none</span>
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
