'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { type FxRates, toSar } from '@/lib/fx-rates';
import { DEFAULT_WEIGHTS, formatCurrency, type SupplierScore } from '@/lib/workspace-types';
import { cn } from '@/lib/utils';

// The five scored criteria + their system weights (Price 40 / Delivery 25 /
// Payment 15 / Warranty 10 / Risk 10). Weights are NOT editable here — the
// trade-off only re-anchors what we compare against, never the scoring.
const CRIT: { key: keyof typeof DEFAULT_WEIGHTS; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'payment', label: 'Payment' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'risk', label: 'Risk' },
];
const weightPct = (k: keyof typeof DEFAULT_WEIGHTS) => Math.round(DEFAULT_WEIGHTS[k] * 100);

/**
 * Side-by-side trade-off of the user's SELECTED supplier vs the AI-recommended
 * one: cost delta (SAR + USD), delivery delta (days), score delta, and the
 * per-criterion breakdown. Pure view over the existing deterministic scores —
 * it changes nothing about the data or the scoring.
 */
export function TradeOffPanel({
  selected,
  ai,
  fx,
}: {
  selected: SupplierScore;
  ai: SupplierScore;
  fx: FxRates | null;
}) {
  const selName = selected.quotation.supplierName;
  const aiName = ai.quotation.supplierName;
  const selPct = Math.round(selected.overall * 100);
  const aiPct = Math.round(ai.overall * 100);

  // Deltas are SELECTED − AI. Cost/delivery: negative = selected is better.
  const selUsd = selected.quotation.totalCostUsd;
  const aiUsd = ai.quotation.totalCostUsd;
  const costUsd = selUsd != null && aiUsd != null ? selUsd - aiUsd : null;
  const selSar = toSar(selected.quotation.totalCost, selected.quotation.currency, fx ?? ({} as FxRates));
  const aiSar = toSar(ai.quotation.totalCost, ai.quotation.currency, fx ?? ({} as FxRates));
  const costSar = fx && selSar != null && aiSar != null ? selSar - aiSar : null;

  const selDel = selected.quotation.deliveryDays;
  const aiDel = ai.quotation.deliveryDays;
  const delDelta = selDel != null && aiDel != null ? selDel - aiDel : null;

  // Human-readable phrases for the one-line summary.
  const costPhrase =
    costSar != null
      ? costSar === 0
        ? 'same cost'
        : `${formatCurrency(Math.abs(costSar), 'SAR')} ${costSar < 0 ? 'cheaper' : 'more expensive'}`
      : costUsd != null
        ? costUsd === 0
          ? 'same cost'
          : `${formatCurrency(Math.abs(costUsd), 'USD')} ${costUsd < 0 ? 'cheaper' : 'more expensive'}`
        : 'cost n/a';
  const delPhrase =
    delDelta == null
      ? 'delivery n/a'
      : delDelta === 0
        ? 'same delivery'
        : `${Math.abs(delDelta)} days ${delDelta > 0 ? 'slower' : 'faster'}`;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/[0.03] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4 text-primary" />
          Trade-off — your selection vs the AI recommendation
        </span>
        <span className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
            AI SUGGESTED: {aiName}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
            YOUR SELECTION: {selName}
          </span>
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-foreground">
        <span className="font-semibold">{selName}</span> vs <span className="font-semibold">{aiName}</span>{' '}
        (AI pick): <DeltaWord good={costSar != null ? costSar <= 0 : (costUsd ?? 0) <= 0}>{costPhrase}</DeltaWord>,{' '}
        <DeltaWord good={(delDelta ?? 0) <= 0}>{delPhrase}</DeltaWord>, score {selPct} vs {aiPct}.
      </p>

      {/* Headline deltas */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DeltaCard
          label="Cost delta"
          primary={
            costSar != null
              ? `${costSar > 0 ? '+' : ''}${formatCurrency(costSar, 'SAR')}`
              : costUsd != null
                ? `${costUsd > 0 ? '+' : ''}${formatCurrency(costUsd, 'USD')}`
                : '—'
          }
          secondary={costUsd != null ? `${costUsd > 0 ? '+' : ''}${formatCurrency(costUsd, 'USD')}` : undefined}
          good={costSar != null ? costSar <= 0 : (costUsd ?? 0) <= 0}
          hint="vs AI pick"
        />
        <DeltaCard
          label="Delivery delta"
          primary={delDelta == null ? '—' : `${delDelta > 0 ? '+' : ''}${delDelta} days`}
          good={(delDelta ?? 0) <= 0}
          hint={delDelta == null ? undefined : delDelta > 0 ? 'slower' : delDelta < 0 ? 'faster' : 'same'}
        />
        <DeltaCard
          label="Score delta"
          primary={`${selPct - aiPct > 0 ? '+' : ''}${selPct - aiPct}`}
          secondary={`${selPct} vs ${aiPct}/100`}
          good={selPct - aiPct >= 0}
          hint="procurement score"
        />
      </div>

      {/* Per-criterion breakdown */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-semibold">Criterion</th>
              <th className="px-3 py-2 text-center font-semibold">Weight</th>
              <th className="px-3 py-2 text-right font-semibold">{selName}</th>
              <th className="px-3 py-2 text-right font-semibold">{aiName} (AI)</th>
              <th className="px-3 py-2 text-center font-semibold">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CRIT.map(({ key, label }) => {
              const sm = selected.metrics[key];
              const am = ai.metrics[key];
              const na = (m: typeof sm) => m.status === 'no-comparison';
              const s = na(sm) ? null : Math.round(sm.score * 100);
              const a = na(am) ? null : Math.round(am.score * 100);
              const delta = s != null && a != null ? s - a : null;
              return (
                <tr key={key}>
                  <td className="py-2 pr-3 font-medium">{label}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{weightPct(key)}%</td>
                  <td className="px-3 py-2 text-right nums font-semibold">{s == null ? 'n/a' : s}</td>
                  <td className="px-3 py-2 text-right nums text-muted-foreground">{a == null ? 'n/a' : a}</td>
                  <td className="px-3 py-2 text-center">
                    {delta == null || delta === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 font-semibold',
                          delta > 0 ? 'text-success' : 'text-danger',
                        )}
                      >
                        {delta > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {delta > 0 ? '+' : ''}
                        {delta}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Each criterion is scored 0–100 (higher is better) under the fixed system weights; “Δ” is the selected
        supplier minus the AI pick. Selecting a supplier re-anchors the dashboard only — it never changes the
        extracted data or the scores.
      </p>
    </div>
  );
}

function DeltaWord({ good, children }: { good: boolean; children: ReactNode }) {
  return <span className={cn('font-semibold', good ? 'text-success' : 'text-danger')}>{children}</span>;
}

function DeltaCard({
  label,
  primary,
  secondary,
  good,
  hint,
}: {
  label: string;
  primary: string;
  secondary?: string;
  good: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('nums mt-1.5 text-xl font-bold tracking-tight', good ? 'text-success' : 'text-danger')}>
        {primary}
      </div>
      {(secondary || hint) && (
        <div className="mt-0.5 text-xs text-muted-foreground">{secondary ?? ''}{secondary && hint ? ' · ' : ''}{hint ?? ''}</div>
      )}
    </div>
  );
}
