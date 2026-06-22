'use client';

import { Fragment, type ReactNode, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  Sparkles,
  Table2,
  TrendingDown,
  Trophy,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { scoreSuppliers, warrantyMonths } from '@/lib/analysis-engine';
import {
  type AnalysisResult,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  type FieldKey,
  type FieldProvenance,
  formatCurrency,
  formatDelivery,
  type ScoreWeights,
} from '@/lib/workspace-types';
import { WeightControls } from './weight-controls';

type Extreme = 'best' | 'worst' | 'none';

// Best (green) / worst (amber) per numeric column; neutral otherwise.
function extremeTone(
  value: number | null,
  min: number,
  max: number,
  lowerIsBetter: boolean,
): Extreme {
  if (value == null || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return 'none';
  }
  if (value === (lowerIsBetter ? min : max)) return 'best';
  if (value === (lowerIsBetter ? max : min)) return 'worst';
  return 'none';
}

function cellText(tone: Extreme, mutedWhenNone: boolean): string {
  if (tone === 'best') return 'bg-success/10 text-success';
  if (tone === 'worst') return 'bg-warning/10 text-warning';
  return mutedWhenNone ? 'text-muted-foreground' : '';
}

function NotFoundTag() {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      Not found
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const tone =
    confidence === 0
      ? 'bg-muted-foreground/40'
      : confidence >= 0.85
        ? 'bg-success'
        : confidence >= 0.65
          ? 'bg-warning'
          : 'bg-danger';
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', tone)}
      title={`Confidence: ${Math.round(confidence * 100)}%`}
    />
  );
}

const FIELD_LABELS: Record<FieldKey, string> = {
  supplierName: 'Supplier name',
  totalCost: 'Total cost',
  deliveryDays: 'Delivery time',
  paymentTerms: 'Payment terms',
  warranty: 'Warranty',
};

function FieldButton({
  q,
  field,
  display,
  active,
  onToggle,
  className,
}: {
  q: ExtractedQuotation;
  field: FieldKey;
  display: ReactNode;
  active: boolean;
  onToggle: (id: string, field: FieldKey) => void;
  className?: string;
}) {
  const meta = q.fields[field];
  const notFound = meta.confidence === 0 || display == null || display === '';
  return (
    <button
      type="button"
      onClick={() => onToggle(q.id, field)}
      title="Show source"
      className={cn(
        'inline-flex items-center gap-1.5 rounded text-left transition hover:underline',
        active && 'underline',
        className,
      )}
    >
      {notFound ? <NotFoundTag /> : <span>{display}</span>}
      <ConfidenceDot confidence={meta.confidence} />
    </button>
  );
}

function SourceDetail({ field, meta }: { field: FieldKey; meta: FieldProvenance }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{FIELD_LABELS[field]} — source</span>
        {meta.page != null && <span>page {meta.page}</span>}
        <span className="inline-flex items-center gap-1">
          <ConfidenceDot confidence={meta.confidence} />
          {Math.round(meta.confidence * 100)}% confidence
        </span>
      </div>
      <p className="mt-2 rounded bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
        {meta.snippet ?? 'Not found in the document — please verify manually.'}
      </p>
    </div>
  );
}

export function AnalysisResults({ analysis }: { analysis: AnalysisResult }) {
  const { quotations, recommendation: rec, risks } = analysis;
  const cheapest = rec.lowestCost?.supplier;
  const fastest = rec.fastestDelivery?.supplier;

  // Live deterministic re-ranking as the weight sliders move (no LLM).
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS);
  const scored = useMemo(
    () => scoreSuppliers(quotations, risks, weights),
    [quotations, risks, weights],
  );
  const best = scored[0]?.quotation.supplierName;
  const bestScorePct = scored[0] ? Math.round(scored[0].overall * 100) : null;

  // Per-column extremes for best/worst cell highlighting.
  const costs = quotations.map((q) => q.totalCostUsd).filter((v): v is number => v != null);
  const dels = quotations.map((q) => q.deliveryDays).filter((v): v is number => v != null);
  const warrs = quotations.map((q) => warrantyMonths(q.warranty));
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minDel = Math.min(...dels);
  const maxDel = Math.max(...dels);
  const minWarr = Math.min(...warrs);
  const maxWarr = Math.max(...warrs);

  // Savings of the recommended supplier vs the highest quote.
  const bestQ = scored[0]?.quotation;
  const savings =
    bestQ?.totalCostUsd != null && Number.isFinite(maxCost) && maxCost > bestQ.totalCostUsd
      ? {
          amount: maxCost - bestQ.totalCostUsd,
          pct: Math.round(((maxCost - bestQ.totalCostUsd) / maxCost) * 100),
        }
      : null;

  // Which field's source snippet is currently expanded.
  const [open, setOpen] = useState<{ id: string; field: FieldKey } | null>(null);
  const toggleSource = (id: string, field: FieldKey) =>
    setOpen((prev) => (prev?.id === id && prev.field === field ? null : { id, field }));

  return (
    <div className="space-y-6">
      {/* Comparison table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Table2 className="h-4 w-4 text-primary" />
            Quotation Comparison
          </span>
          {analysis.simulated && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
              Sample analysis
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Supplier</th>
                <th className="px-5 py-3 font-medium">Total Cost</th>
                <th className="px-5 py-3 font-medium">Delivery</th>
                <th className="px-5 py-3 font-medium">Payment Terms</th>
                <th className="px-5 py-3 font-medium">Warranty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotations.map((q) => {
                const costTone = extremeTone(q.totalCostUsd, minCost, maxCost, true);
                const delTone = extremeTone(q.deliveryDays, minDel, maxDel, true);
                const warrTone: Extreme =
                  q.warranty == null
                    ? 'worst'
                    : extremeTone(warrantyMonths(q.warranty), minWarr, maxWarr, false);
                const openMeta = open?.id === q.id ? q.fields[open.field] : null;
                const isOpen = (field: FieldKey) => open?.id === q.id && open.field === field;
                return (
                  <Fragment key={q.id}>
                    <tr className="transition hover:bg-muted/40">
                      <td className="px-5 py-4">
                        <FieldButton
                          q={q}
                          field="supplierName"
                          display={q.supplierName}
                          active={isOpen('supplierName')}
                          onToggle={toggleSource}
                          className="font-semibold"
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {q.supplierName === best && <Tag tone="primary" icon={Trophy} label="Best overall" />}
                          {q.supplierName === cheapest && <Tag tone="success" icon={Wallet} label="Lowest cost" />}
                          {q.supplierName === fastest && <Tag tone="warning" icon={Clock} label="Fastest" />}
                        </div>
                      </td>
                      <td className={cn('px-5 py-4 font-semibold tabular-nums', cellText(costTone, false))}>
                        <FieldButton q={q} field="totalCost" onToggle={toggleSource}
                          active={isOpen('totalCost')}
                          display={
                            q.totalCost == null ? null : (
                              <span className="inline-flex flex-col leading-tight">
                                <span>{formatCurrency(q.totalCost, q.currency)}</span>
                                {q.currency !== 'USD' && q.totalCostUsd != null && (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    ≈ {formatCurrency(q.totalCostUsd, 'USD')}
                                  </span>
                                )}
                              </span>
                            )
                          } />
                      </td>
                      <td className={cn('px-5 py-4 tabular-nums', cellText(delTone, true))}>
                        <FieldButton q={q} field="deliveryDays" onToggle={toggleSource}
                          active={isOpen('deliveryDays')}
                          display={q.deliveryDays == null ? null : formatDelivery(q.deliveryDays)} />
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        <FieldButton q={q} field="paymentTerms" display={q.paymentTerms}
                          active={isOpen('paymentTerms')} onToggle={toggleSource} />
                      </td>
                      <td className={cn('px-5 py-4', cellText(warrTone, true))}>
                        <FieldButton q={q} field="warranty" display={q.warranty}
                          active={isOpen('warranty')} onToggle={toggleSource} />
                      </td>
                    </tr>
                    {openMeta && open && (
                      <tr className="bg-muted/20">
                        <td colSpan={5} className="px-5 pb-4 pt-0">
                          <SourceDetail field={open.field} meta={openMeta} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <WeightControls weights={weights} onChange={setWeights} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI recommendation */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            AI Recommendation
          </div>
          <ul className="mt-4 space-y-3">
            {rec.lowestCost && (
              <RecRow icon={Wallet} tone="success" title="Lowest Cost Supplier"
                supplier={rec.lowestCost.supplier} detail={rec.lowestCost.detail} />
            )}
            {rec.fastestDelivery && (
              <RecRow icon={Clock} tone="warning" title="Fastest Delivery Supplier"
                supplier={rec.fastestDelivery.supplier} detail={rec.fastestDelivery.detail} />
            )}
            {best && (
              <RecRow icon={Trophy} tone="primary" title="Best Overall Supplier" highlight
                supplier={best}
                detail={`Highest weighted score (${bestScorePct}/100) for your current priorities.`} />
            )}
            {best && savings && (
              <li className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm font-medium text-success">
                <TrendingDown className="h-4 w-4 shrink-0" />
                {best} saves {formatCurrency(savings.amount, 'USD')} ({savings.pct}%) vs the
                highest quote.
              </li>
            )}
          </ul>
        </div>

        {/* Risk detection */}
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <ShieldAlert className="h-4 w-4" />
            Risk Detection
          </div>
          {risks.length ? (
            <ul className="mt-4 space-y-2.5 text-sm text-warning">
              {risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  {r.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-warning">No risks detected across these quotations.</p>
          )}
        </div>
      </div>
    </div>
  );
}

type Tone = 'primary' | 'success' | 'warning';
const toneClasses: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
};

function Tag({
  tone,
  icon: Icon,
  label,
}: {
  tone: Tone;
  icon: typeof Trophy;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        toneClasses[tone],
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function RecRow({
  icon: Icon,
  tone,
  title,
  supplier,
  detail,
  highlight,
}: {
  icon: typeof Trophy;
  tone: Tone;
  title: string;
  supplier: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={cn(
        'flex gap-3 rounded-xl border p-3',
        highlight ? 'border-primary/30 bg-card' : 'border-transparent',
      )}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{title}</span>
        </div>
        <div className="text-sm font-semibold">{supplier}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}
