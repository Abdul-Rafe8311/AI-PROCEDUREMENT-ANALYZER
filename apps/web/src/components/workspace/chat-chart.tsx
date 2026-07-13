'use client';

// Renders ONE chart inside a chat message, chosen by the model's data-free
// directive (metric). All values come from the real analysis data — never from
// the model — so charts can't show invented numbers. Reuses recharts + the
// dashboard theme; the dashboard's own charts (analysis-charts.tsx) are untouched.

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
import { scoreSuppliers } from '@/lib/analysis-engine';
import { toUsd } from '@/lib/fx-rates';
import { useFxRates } from '@/lib/use-fx-rates';
import {
  type AnalysisResult,
  type ChartDirective,
  DEFAULT_WEIGHTS,
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
const shortName = (s: string) => (s.length > 16 ? s.slice(0, 15) + '…' : s);

const DEFAULT_TITLES: Record<ChartDirective['metric'], string> = {
  cost: 'Total Cost (USD)',
  score: 'Procurement Score',
  delivery: 'Delivery Time',
  material: 'Material Unit Prices',
};

export function ChatChart({
  analysis,
  directive,
}: {
  analysis: AnalysisResult;
  directive: ChartDirective;
}) {
  const { quotations, risks } = analysis;
  const fx = useFxRates();
  const scored = useMemo(
    () => scoreSuppliers(quotations, risks, DEFAULT_WEIGHTS),
    [quotations, risks],
  );

  const body = useMemo(() => {
    if (directive.metric === 'cost') {
      const rows = quotations
        .map((q) => ({ name: shortName(q.supplierName), value: q.totalCostUsd ?? 0 }))
        .filter((r) => r.value > 0);
      if (rows.length < 1) return null;
      const min = Math.min(...rows.map((r) => r.value));
      const max = Math.max(...rows.map((r) => r.value));
      const data = rows.map((r) => ({
        ...r,
        fill: r.value === min ? C.success : r.value === max ? C.danger : C.muted,
      }));
      return (
        <SingleBar data={data} axisType="number" fmt={usd} tipFmt={(v) => usd(v)} />
      );
    }

    if (directive.metric === 'score') {
      const data = scored.map((sc, i) => ({
        name: shortName(sc.quotation.supplierName),
        value: Math.round(sc.overall * 100),
        fill: i === 0 ? C.primary : C.muted,
      }));
      if (!data.length) return null;
      return <SingleBar data={data} axisType="number" domain={[0, 100]} tipFmt={(v) => String(v)} />;
    }

    if (directive.metric === 'delivery') {
      const rows = quotations
        .map((q) => ({ name: shortName(q.supplierName), value: q.deliveryDays ?? 0 }))
        .filter((r) => r.value > 0);
      if (rows.length < 1) return null;
      const min = Math.min(...rows.map((r) => r.value));
      const data = rows.map((r) => ({ ...r, fill: r.value === min ? C.success : C.muted }));
      return <SingleBar data={data} axisType="number" tipFmt={(v) => `${v} days`} />;
    }

    // material — grouped bar of per-item unit prices across suppliers
    const norm = (s: string) =>
      s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const seen = new Map<string, string>();
    for (const q of quotations) {
      for (const li of q.lineItems) {
        const k = norm(li.name);
        if (k && !seen.has(k)) seen.set(k, li.name);
      }
    }
    const items = [...seen.entries()].slice(0, 8);
    if (!items.length) return null;
    const keys = quotations.map((q) => shortName(q.supplierName));
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
    const palette = [C.primary, C.success, C.warning, C.danger, C.muted];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="item" tick={{ fill: C.muted, fontSize: 10 }} interval={0} />
          <YAxis tickFormatter={usd} tick={{ fill: C.muted, fontSize: 11 }} width={48} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => usd(v)} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={palette[i % palette.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }, [directive.metric, quotations, scored, fx]);

  if (!body) return null;

  return (
    <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 text-xs font-semibold text-foreground">
        {directive.title?.trim() || DEFAULT_TITLES[directive.metric]}
      </div>
      <div className="h-52 w-full">{body}</div>
    </div>
  );
}

// Shared horizontal single-series bar (cost / score / delivery).
function SingleBar({
  data,
  axisType,
  domain,
  fmt,
  tipFmt,
}: {
  data: { name: string; value: number; fill: string }[];
  axisType: 'number';
  domain?: [number, number];
  fmt?: (n: number) => string;
  tipFmt?: (n: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type={axisType} domain={domain} tickFormatter={fmt} tick={{ fill: C.muted, fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={92} tick={{ fill: C.muted, fontSize: 11 }} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number) => (tipFmt ? tipFmt(v) : String(v))}
          cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
