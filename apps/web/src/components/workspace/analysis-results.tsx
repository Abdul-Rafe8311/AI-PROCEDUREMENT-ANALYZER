'use client';

import { Fragment, type ReactNode, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  ShieldAlert,
  Sparkles,
  Table2,
  TrendingDown,
  Trophy,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildExecutiveSummary,
  type RiskLevel,
  riskLevelFor,
  scoreSuppliers,
  warrantyMonths,
} from '@/lib/analysis-engine';
import {
  type AnalysisResult,
  DEFAULT_WEIGHTS,
  type ExtractedQuotation,
  type FieldKey,
  type FieldProvenance,
  formatCurrency,
  formatDelivery,
  type RiskFlag,
  type RiskSeverity,
  type ScoreWeights,
  type SupplierScore,
} from '@/lib/workspace-types';
import { ComparisonMatrix } from './comparison-matrix';
import { KpiCards } from './kpi-cards';
import { CurrencyToggle, MoneyDual, useCurrencyMode } from './currency-mode';

// Lazy-load charts (recharts is heavy) — keeps initial JS lean for Lighthouse.
const AnalysisCharts = dynamic(() => import('./analysis-charts'), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-72 animate-pulse rounded-2xl border border-border bg-muted/40" />
      ))}
    </div>
  ),
});

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

// Directional best/worst marker — conveys meaning by shape (arrow direction)
// in addition to color, so it doesn't rely on color alone.
function ColumnFlag({ tone, lowerIsBetter }: { tone: Extreme; lowerIsBetter: boolean }) {
  if (tone === 'none') return null;
  const isBest = tone === 'best';
  const pointsDown = lowerIsBetter ? isBest : !isBest;
  const Icon = pointsDown ? ArrowDown : ArrowUp;
  return (
    <Icon
      className="h-3 w-3 shrink-0 opacity-80"
      aria-label={isBest ? 'Best value in this column' : 'Worst value in this column'}
    />
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 85 ? 'bg-success/15 text-success' : score >= 70 ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning';
  return (
    <span className={cn('nums inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold', tone)}>
      {score}
    </span>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, string> = {
    Low: 'bg-success/15 text-success',
    Medium: 'bg-warning/15 text-warning',
    High: 'bg-danger/15 text-danger',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', map[level])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', level === 'Low' ? 'bg-success' : level === 'Medium' ? 'bg-warning' : 'bg-danger')} />
      {level}
    </span>
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

  // Fixed, auditable scoring — weights are system-defined, not user-editable.
  const scored = useMemo(
    () => scoreSuppliers(quotations, risks, DEFAULT_WEIGHTS),
    [quotations, risks],
  );
  const best = scored[0]?.quotation.supplierName;
  const bestScorePct = scored[0] ? Math.round(scored[0].overall * 100) : null;

  // Procurement score (0-100) + risk level per supplier, keyed by name.
  const scoreOf = useMemo(() => {
    const m = new Map<string, number>();
    scored.forEach((s) => m.set(s.quotation.supplierName, Math.round(s.overall * 100)));
    return m;
  }, [scored]);
  const execSummary = useMemo(
    () => buildExecutiveSummary(scored, risks),
    [scored, risks],
  );
  // Confidence reflects how decisively the top supplier leads the runner-up.
  const confidence = useMemo(() => {
    if (scored.length < 2) return scored.length ? 90 : 0;
    const margin = scored[0].overall - scored[1].overall;
    return Math.round(Math.min(0.98, 0.6 + margin * 2.5) * 100);
  }, [scored]);

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

  const kpi = useMemo(
    () => ({
      totalSuppliers: quotations.length,
      potentialSavings: savings?.amount ?? 0,
      savingsPct: savings?.pct ?? 0,
      recommendedSupplier: best ?? '—',
      recommendedScore: bestScorePct ?? 0,
      risksFound: risks.length,
    }),
    [quotations.length, savings, best, bestScorePct, risks.length],
  );

  // Currency display mode (session-persisted) — applies to table + matrix.
  const [currencyMode, setCurrencyMode] = useCurrencyMode();

  // Which field's source snippet is currently expanded.
  const [open, setOpen] = useState<{ id: string; field: FieldKey } | null>(null);
  const toggleSource = (id: string, field: FieldKey) =>
    setOpen((prev) => (prev?.id === id && prev.field === field ? null : { id, field }));

  return (
    <div className="space-y-6">
      <KpiCards data={kpi} />

      {/* Comparison table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Table2 className="h-4 w-4 text-primary" />
            Quotation Comparison
          </span>
          <div className="flex items-center gap-2">
            {analysis.simulated && (
              <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                Sample analysis
              </span>
            )}
            <CurrencyToggle mode={currencyMode} onChange={setCurrencyMode} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Supplier</th>
                <th className="px-5 py-3 text-right font-semibold">Total Cost</th>
                <th className="px-5 py-3 text-right font-semibold">Delivery</th>
                <th className="px-5 py-3 text-left font-semibold">Payment Terms</th>
                <th className="px-5 py-3 text-right font-semibold">Warranty</th>
                <th className="px-5 py-3 text-right font-semibold">Score</th>
                <th className="px-5 py-3 text-center font-semibold">Risk</th>
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
                      <td className={cn('px-5 py-4 text-right font-semibold nums', cellText(costTone, false))}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <ColumnFlag tone={costTone} lowerIsBetter />
                          <FieldButton q={q} field="totalCost" onToggle={toggleSource}
                            active={isOpen('totalCost')}
                            display={
                              q.totalCost == null && q.totalCostUsd == null ? null : (
                                <MoneyDual
                                  amount={q.totalCost}
                                  currency={q.currency}
                                  usd={q.totalCostUsd}
                                  mode={currencyMode}
                                />
                              )
                            } />
                        </span>
                      </td>
                      <td className={cn('px-5 py-4 text-right nums', cellText(delTone, true))}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <ColumnFlag tone={delTone} lowerIsBetter />
                          <FieldButton q={q} field="deliveryDays" onToggle={toggleSource}
                            active={isOpen('deliveryDays')}
                            display={q.deliveryDays == null ? null : formatDelivery(q.deliveryDays)} />
                        </span>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        <FieldButton q={q} field="paymentTerms" display={q.paymentTerms}
                          active={isOpen('paymentTerms')} onToggle={toggleSource} />
                      </td>
                      <td className={cn('px-5 py-4 text-right', cellText(warrTone, true))}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <ColumnFlag tone={warrTone} lowerIsBetter={false} />
                          <FieldButton q={q} field="warranty" display={q.warranty}
                            active={isOpen('warranty')} onToggle={toggleSource} />
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <ScoreBadge score={scoreOf.get(q.supplierName) ?? 0} />
                      </td>
                      <td className="px-5 py-4 text-center">
                        <RiskBadge level={riskLevelFor(q.supplierName, risks)} />
                      </td>
                    </tr>
                    {openMeta && open && (
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-5 pb-4 pt-0">
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Confidence</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />High
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />Medium
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />Low
          </span>
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <ArrowDown className="h-3 w-3 text-success" />Best in column
          </span>
          <span className="ml-auto hidden text-muted-foreground/80 sm:inline">
            Click any value to view its source
          </span>
        </div>
      </div>

      <ComparisonMatrix quotations={quotations} mode={currencyMode} />

      <AnalysisCharts quotations={quotations} scored={scored} />

      <ScoreBreakdown scored={scored} />

      {execSummary && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Executive Summary
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground">{execSummary}</p>
        </div>
      )}

      <SavingsPanel quotations={quotations} bestSupplier={best} />

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
              <RecRow icon={Trophy} tone="primary" title="Recommended Supplier" highlight
                supplier={best}
                detail={`Highest procurement score (${bestScorePct}/100) on the system methodology.`} />
            )}
            {best && savings && (
              <li className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm font-medium text-success">
                <TrendingDown className="h-4 w-4 shrink-0" />
                {best} saves {formatCurrency(savings.amount, 'USD')} ({savings.pct}%) vs the
                highest quote.
              </li>
            )}
          </ul>
          {best && (
            <div className="mt-4 flex items-center justify-between border-t border-primary/20 pt-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Confidence score
              </span>
              <span className="nums text-lg font-bold text-primary">{confidence}%</span>
            </div>
          )}
        </div>

        {/* Risk detection */}
        <RiskPanel risks={risks} />
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

// ── Read-only scoring methodology + auditable per-criterion breakdown ──
const CRITERIA: { key: keyof typeof DEFAULT_WEIGHTS; label: string; dim: keyof SupplierScore }[] = [
  { key: 'price', label: 'Price', dim: 'price' },
  { key: 'delivery', label: 'Delivery', dim: 'delivery' },
  { key: 'payment', label: 'Payment Terms', dim: 'payment' },
  { key: 'warranty', label: 'Warranty', dim: 'warranty' },
  { key: 'risk', label: 'Risk', dim: 'risk' },
];

function ScoreBreakdown({ scored }: { scored: SupplierScore[] }) {
  if (!scored.length) return null;
  // Points = weight% applied to the 0..1 dimension score (so Price caps at 40).
  const pts = (s: SupplierScore, key: keyof typeof DEFAULT_WEIGHTS, dim: keyof SupplierScore) =>
    Math.round(DEFAULT_WEIGHTS[key] * (s[dim] as number) * 100);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          Procurement Scoring Methodology
        </span>
        <span
          className="cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
          title="Each supplier is scored 0-100. Every criterion is normalized across suppliers (0-1, higher is better) then multiplied by its fixed weight. Weights are system-defined and cannot be edited, so rankings are data-driven and auditable."
        >
          How is this calculated?
        </span>
      </div>

      {/* Fixed weights (read-only) */}
      <div className="flex flex-wrap gap-2 border-b border-border bg-muted/30 px-5 py-3 text-xs">
        {CRITERIA.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 font-medium shadow-sm">
            {c.label}
            <span className="nums text-primary">{Math.round(DEFAULT_WEIGHTS[c.key] * 100)}%</span>
          </span>
        ))}
      </div>

      {/* Auditable breakdown */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Criteria</th>
              <th className="px-5 py-3 text-right font-semibold">Weight</th>
              {scored.map((s) => (
                <th key={s.quotation.id} className="px-5 py-3 text-right font-semibold">
                  {s.quotation.supplierName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CRITERIA.map((c) => {
              const vals = scored.map((s) => pts(s, c.key, c.dim));
              const max = Math.max(...vals);
              return (
                <tr key={c.key} className="transition hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium">{c.label}</td>
                  <td className="nums px-5 py-3 text-right text-muted-foreground">
                    {Math.round(DEFAULT_WEIGHTS[c.key] * 100)}%
                  </td>
                  {vals.map((v, i) => (
                    <td
                      key={scored[i].quotation.id}
                      className={cn('nums px-5 py-3 text-right', v === max ? 'font-semibold text-success' : 'text-muted-foreground')}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-5 py-3" colSpan={2}>Total Procurement Score</td>
              {scored.map((s) => {
                const total = Math.round(s.overall * 100);
                const isTop = s.quotation.supplierName === scored[0].quotation.supplierName;
                return (
                  <td key={s.quotation.id} className={cn('nums px-5 py-3 text-right', isTop && 'text-primary')}>
                    {total}{isTop && ' ★'}
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

// ── Cost-savings panel ──
function SavingsPanel({
  quotations,
  bestSupplier,
}: {
  quotations: ExtractedQuotation[];
  bestSupplier?: string;
}) {
  const withCost = quotations.filter((q) => q.totalCostUsd != null);
  if (withCost.length < 2) return null;
  const best = withCost.find((q) => q.supplierName === bestSupplier) ?? withCost[0];
  const bestCost = Math.min(...withCost.map((q) => q.totalCostUsd!));
  const highCost = Math.max(...withCost.map((q) => q.totalCostUsd!));
  const recCost = best.totalCostUsd!;
  const savings = highCost - recCost;
  const pct = highCost > 0 ? Math.round((savings / highCost) * 1000) / 10 : 0;

  const cells: { label: string; value: string; tone?: string }[] = [
    { label: 'Recommended supplier cost', value: formatCurrency(recCost, 'USD') },
    { label: 'Lowest supplier cost', value: formatCurrency(bestCost, 'USD'), tone: 'text-success' },
    { label: 'Highest supplier cost', value: formatCurrency(highCost, 'USD'), tone: 'text-danger' },
    { label: 'Potential savings', value: `${formatCurrency(savings, 'USD')} (${pct}%)`, tone: 'text-success' },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <TrendingDown className="h-4 w-4 text-success" />
        Cost Savings Analysis
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className={cn('nums mt-1.5 text-xl font-bold tracking-tight', c.tone)}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Risk panel (severity-grouped warning cards) ──
const SEVERITY_META: Record<
  RiskSeverity,
  { label: string; card: string; badge: string; order: number }
> = {
  high: { label: 'High', card: 'border-danger/30 bg-danger/5', badge: 'bg-danger/15 text-danger', order: 0 },
  medium: { label: 'Medium', card: 'border-warning/30 bg-warning/5', badge: 'bg-warning/15 text-warning', order: 1 },
  low: { label: 'Low', card: 'border-border bg-muted/20', badge: 'bg-muted text-muted-foreground', order: 2 },
};

function RiskPanel({ risks }: { risks: RiskFlag[] }) {
  const sorted = [...risks].sort(
    (a, b) => SEVERITY_META[a.severity].order - SEVERITY_META[b.severity].order,
  );
  const counts = risks.reduce(
    (acc, r) => ((acc[r.severity] = (acc[r.severity] ?? 0) + 1), acc),
    {} as Record<RiskSeverity, number>,
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-warning" />
          Risk Detection
        </span>
        <div className="flex gap-1.5">
          {(['high', 'medium', 'low'] as RiskSeverity[])
            .filter((s) => counts[s])
            .map((s) => (
              <span
                key={s}
                className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SEVERITY_META[s].badge)}
              >
                {counts[s]} {SEVERITY_META[s].label}
              </span>
            ))}
        </div>
      </div>

      {sorted.length ? (
        <ul className="mt-4 space-y-2.5">
          {sorted.map((r, i) => {
            const m = SEVERITY_META[r.severity];
            return (
              <li key={i} className={cn('flex items-start gap-3 rounded-xl border p-3', m.card)}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-foreground">{r.message}</span>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', m.badge)}>
                  {m.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          No material risks detected across these quotations.
        </div>
      )}
    </div>
  );
}
