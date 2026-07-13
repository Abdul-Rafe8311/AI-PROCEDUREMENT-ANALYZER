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
import { toUsd } from '@/lib/fx-rates';
import { useFxRates } from '@/lib/use-fx-rates';
import type { ExtractedQuotation, SupplierScore } from '@/lib/workspace-types';

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
const shortName = (s: string) => (s.length > 16 ? s.slice(0, 15) + '…' : s);

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
}: {
  quotations: ExtractedQuotation[];
  scored: SupplierScore[];
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

  const { materialData, supplierKeys } = useMemo(() => {
    const keys = quotations.map((q) => shortName(q.supplierName));
    const norm = (s: string) =>
      s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    // Union of items across suppliers (arbitrary per document), capped for readability.
    const seen = new Map<string, string>();
    for (const q of quotations) {
      for (const li of q.lineItems) {
        const k = norm(li.name);
        if (k && !seen.has(k)) seen.set(k, li.name);
      }
    }
    const items = [...seen.entries()].slice(0, 8);
    const data = items.map(([key, label]) => {
      const row: Record<string, string | number> = {
        item: label.replace(/\s*\(.*\)/, '').split(' ').slice(0, 2).join(' '),
      };
      quotations.forEach((q) => {
        const li = q.lineItems.find((l) => norm(l.name) === key);
        row[shortName(q.supplierName)] = li?.unitPrice != null && fx ? toUsd(li.unitPrice, li.currency, fx) ?? 0 : 0;
      });
      return row;
    });
    return { materialData: data, supplierKeys: keys };
  }, [quotations, fx]);

  const palette = [C.primary, C.success, C.warning, C.danger, C.muted];

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

      <ChartCard icon={Boxes} title="Material Price Comparison" hint="Unit price (USD) per item across suppliers">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={materialData} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="item" tick={{ fill: C.muted, fontSize: 10 }} interval={0} />
            <YAxis tickFormatter={usd} tick={{ fill: C.muted, fontSize: 11 }} width={48} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => usd(v)} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {supplierKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={palette[i % palette.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
