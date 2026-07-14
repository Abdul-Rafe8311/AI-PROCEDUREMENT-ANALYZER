'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Boxes, Clock, DollarSign } from 'lucide-react';
import { useFxRates } from '@/lib/use-fx-rates';
import { buildMaterialData, type MatMeta, type MatRow } from '@/lib/material-chart-data';
import type {
  ExtractedQuotation,
  PrMatchResult,
  PurchaseRequisition,
  SupplierScore,
} from '@/lib/workspace-types';

const C = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  danger: 'hsl(var(--danger))',
  warning: 'hsl(var(--warning))',
  muted: 'hsl(var(--muted-foreground))',
  grid: 'hsl(var(--border))',
};

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  fontSize: '12px',
  color: 'hsl(var(--foreground))',
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
// Unit prices are small (≈ $0–5) — show 2 decimals so real differences are visible.
const usd2 = (n: number) => `$${n.toFixed(2)}`;
const shortName = (s: string) => (s.length > 16 ? s.slice(0, 15) + '…' : s);

// Categorical colors for the per-supplier bars (up to 5 suppliers per group).
const SERIES = [C.primary, C.success, C.warning, C.danger, C.muted];
const colorFor = (i: number) => SERIES[i % SERIES.length];

// Tooltip: supplier name, their OWN quoted description, qty, unit price SAR + USD.
function renderMaterialTooltip(
  props: { active?: boolean; payload?: { payload?: MatRow }[] },
  suppliers: string[],
) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const present = suppliers
    .map((name, i) => ({ name, i, m: row._meta?.[name] }))
    .filter((x): x is { name: string; i: number; m: MatMeta } => !!x.m);
  if (!present.length) return null;
  return (
    <div style={tooltipStyle} className="min-w-[12rem] px-3 py-2">
      <div className="mb-1.5 font-semibold">{row.fullItem || row.item}</div>
      <div className="space-y-1.5">
        {present.map(({ name, i, m }) => (
          <div key={name} className="leading-tight">
            <span className="font-medium" style={{ color: colorFor(i) }}>
              {shortName(name)}
            </span>
            <div className="text-[11px] text-muted-foreground">{m.desc}</div>
            <div className="text-[11px]">
              qty {m.qty?.toLocaleString('en-US') ?? '—'} · SAR {m.sar != null ? m.sar.toFixed(2) : '—'} / USD{' '}
              {m.usd.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof BarChart3;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

export default function AnalysisCharts({
  quotations,
  scored,
  prMatch = null,
  pr = null,
}: {
  quotations: ExtractedQuotation[];
  scored: SupplierScore[];
  /** PR-item ↔ supplier matching (same as the TA form) — anchors the material chart */
  prMatch?: PrMatchResult | null;
  pr?: PurchaseRequisition | null;
}) {
  const fx = useFxRates();
  const costData = useMemo(() => {
    const rows = quotations
      .map((q) => ({ name: shortName(q.supplierName), value: q.totalCostUsd ?? 0 }))
      .filter((r) => r.value > 0);
    const min = Math.min(...rows.map((r) => r.value));
    const max = Math.max(...rows.map((r) => r.value));
    return rows.map((r) => ({
      ...r,
      fill: r.value === min ? C.success : r.value === max ? C.danger : C.muted,
    }));
  }, [quotations]);

  const scoreData = useMemo(
    () =>
      scored.map((s, i) => ({
        name: shortName(s.quotation.supplierName),
        value: Math.round(s.overall * 100),
        fill: i === 0 ? C.primary : C.muted,
      })),
    [scored],
  );

  const deliveryData = useMemo(() => {
    const rows = quotations
      .map((q) => ({ name: shortName(q.supplierName), value: q.deliveryDays ?? 0 }))
      .filter((r) => r.value > 0);
    const min = Math.min(...rows.map((r) => r.value));
    return rows.map((r) => ({ ...r, fill: r.value === min ? C.success : C.muted }));
  }, [quotations]);

  // Material Price Comparison — UNIT PRICES only, one grouped bar per supplier,
  // anchored to the company's PR items (see buildMaterialData). Freight is excluded
  // and each bar is the supplier's matched unit price in USD at the live rate.
  const { materialData, materialSuppliers } = useMemo(
    () => buildMaterialData(quotations, prMatch, pr, fx),
    [quotations, prMatch, pr, fx],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard icon={DollarSign} title="Total Cost Comparison" hint="USD-normalized · green = lowest, red = highest">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={costData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke={C.grid} />
            <XAxis type="number" tickFormatter={usd} tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={96} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => usd(v)} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
              {costData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard icon={BarChart3} title="Procurement Score Comparison" hint="0–100 · recommended supplier highlighted">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={scoreData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke={C.grid} />
            <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={96} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
              {scoreData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard icon={Clock} title="Delivery Time Comparison" hint="Days · green = fastest">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={deliveryData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke={C.grid} />
            <XAxis type="number" tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={96} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} days`} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
              {deliveryData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard icon={Boxes} title="Material Price Comparison" hint="Unit price (USD) per PR item — freight excluded">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={materialData} margin={{ left: 8, right: 8 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="item" tick={{ fill: C.muted, fontSize: 10 }} interval={0} tickMargin={6} />
            <YAxis
              tickFormatter={usd2}
              tick={{ fill: C.muted, fontSize: 11 }}
              width={52}
              domain={[0, 'auto']}
              allowDecimals
            />
            <Tooltip
              content={(p) => renderMaterialTooltip(p as Parameters<typeof renderMaterialTooltip>[0], materialSuppliers)}
              cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {materialSuppliers.map((name, i) => (
              <Bar key={name} dataKey={name} name={shortName(name)} fill={colorFor(i)} radius={[3, 3, 0, 0]} maxBarSize={26} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
