'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  Sparkles,
  Table2,
  Trophy,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { scoreSuppliers } from '@/lib/analysis-engine';
import {
  type AnalysisResult,
  DEFAULT_WEIGHTS,
  formatCurrency,
  formatDelivery,
  type ScoreWeights,
} from '@/lib/workspace-types';
import { WeightControls } from './weight-controls';

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
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
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
              {quotations.map((q) => (
                <tr key={q.id} className="transition hover:bg-muted/40">
                  <td className="px-5 py-4">
                    <div className="font-semibold">{q.supplierName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.supplierName === best && <Tag tone="primary" icon={Trophy} label="Best overall" />}
                      {q.supplierName === cheapest && <Tag tone="success" icon={Wallet} label="Lowest cost" />}
                      {q.supplierName === fastest && <Tag tone="warning" icon={Clock} label="Fastest" />}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-semibold tabular-nums">
                    {formatCurrency(q.totalCost, q.currency)}
                  </td>
                  <td className="px-5 py-4 tabular-nums text-muted-foreground">
                    {formatDelivery(q.deliveryDays)}
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{q.paymentTerms ?? '—'}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {q.warranty ?? <span className="text-amber-600">Missing</span>}
                  </td>
                </tr>
              ))}
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
          </ul>
        </div>

        {/* Risk detection */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <ShieldAlert className="h-4 w-4" />
            Risk Detection
          </div>
          {risks.length ? (
            <ul className="mt-4 space-y-2.5 text-sm text-amber-900">
              {risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {r.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-amber-800">No risks detected across these quotations.</p>
          )}
        </div>
      </div>
    </div>
  );
}

type Tone = 'primary' | 'success' | 'warning';
const toneClasses: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
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
