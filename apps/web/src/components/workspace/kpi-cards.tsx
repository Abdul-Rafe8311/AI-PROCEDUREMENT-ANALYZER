'use client';

import { type LucideIcon, ShieldAlert, Trophy, TrendingDown, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/workspace-types';

export interface KpiData {
  totalSuppliers: number;
  potentialSavings: number;
  savingsPct: number;
  recommendedSupplier: string;
  recommendedScore: number;
  risksFound: number;
}

export function KpiCards({ data }: { data: KpiData }) {
  const cards: {
    label: string;
    value: string;
    sub?: string;
    icon: LucideIcon;
    tone: string;
  }[] = [
    {
      label: 'Total Suppliers',
      value: String(data.totalSuppliers),
      sub: 'quotations analyzed',
      icon: Users,
      tone: 'text-primary bg-primary/10',
    },
    {
      label: 'Potential Savings',
      value: formatCurrency(data.potentialSavings, 'USD'),
      sub: `${data.savingsPct}% vs highest quote`,
      icon: TrendingDown,
      tone: 'text-success bg-success/10',
    },
    {
      label: 'Recommended Supplier',
      value: data.recommendedSupplier,
      sub: `score ${data.recommendedScore}/100`,
      icon: Trophy,
      tone: 'text-primary bg-primary/10',
    },
    {
      label: 'Risks Found',
      value: String(data.risksFound),
      sub: data.risksFound ? 'review before award' : 'none detected',
      icon: ShieldAlert,
      tone: data.risksFound ? 'text-warning bg-warning/10' : 'text-success bg-success/10',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {c.label}
            </span>
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', c.tone)}>
              <c.icon className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 truncate text-2xl font-bold tracking-tight" title={c.value}>
            {c.value}
          </div>
          {c.sub && <div className="mt-1 text-xs text-muted-foreground">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
