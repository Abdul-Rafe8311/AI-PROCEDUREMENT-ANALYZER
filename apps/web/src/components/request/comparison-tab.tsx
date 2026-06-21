'use client';

import { useMemo, useState } from 'react';
import {
  Sparkles,
  TrendingDown,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Trophy,
  ArrowUpDown,
} from 'lucide-react';
import type { Comparison, ComparisonRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type SortKey = 'totalPrice' | 'deliveryDays' | 'reliabilityScore' | 'riskScore';

const RISK_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'destructive',
};

export function ComparisonTab({
  data,
  isLoading,
}: {
  requestId: string;
  data?: Comparison;
  isLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('totalPrice');
  const [asc, setAsc] = useState(true);
  const [onlyRisky, setOnlyRisky] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = [...data.rows];
    if (onlyRisky) r = r.filter((x) => x.warnings.length > 0);
    r.sort((a, b) => {
      const av = (a[sortKey] ?? Infinity) as number;
      const bv = (b[sortKey] ?? Infinity) as number;
      return asc ? av - bv : bv - av;
    });
    return r;
  }, [data, sortKey, asc, onlyRisky]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  if (isLoading) return <Skeleton className="h-80" />;
  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No quotations yet. Upload quotations in the Quotations tab to generate a comparison.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI recommendation */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" /> AI Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed">{data.recommendation.summary}</p>
          <ul className="space-y-1">
            {data.recommendation.highlights.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Trophy className="mt-0.5 h-3.5 w-3.5 text-amber-500" /> {b}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Mini icon={TrendingDown} label="Lowest cost" value={formatMoney(data.summary.lowestCost)} />
        <Mini icon={Zap} label="Fastest delivery" value={data.summary.fastestDeliveryDays ? `${data.summary.fastestDeliveryDays} days` : '—'} />
        <Mini icon={ShieldCheck} label="Quotations" value={String(data.summary.quotationCount)} />
        <Mini icon={AlertTriangle} label="High risk" value={String(data.summary.highRiskCount)} accent={data.summary.highRiskCount > 0 ? 'text-destructive' : undefined} />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOnlyRisky(!onlyRisky)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            onlyRisky ? 'border-destructive bg-destructive/10 text-destructive' : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          {onlyRisky ? 'Showing flagged only' : 'Show flagged only'}
        </button>
      </div>

      {/* Comparison table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <SortableHead label="Total Cost" active={sortKey === 'totalPrice'} asc={asc} onClick={() => toggleSort('totalPrice')} />
                <SortableHead label="Delivery" active={sortKey === 'deliveryDays'} asc={asc} onClick={() => toggleSort('deliveryDays')} />
                <SortableHead label="Reliability" active={sortKey === 'reliabilityScore'} asc={asc} onClick={() => toggleSort('reliabilityScore')} />
                <TableHead>Payment Terms</TableHead>
                <SortableHead label="Risk" active={sortKey === 'riskScore'} asc={asc} onClick={() => toggleSort('riskScore')} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <CompRow key={row.quotationId} row={row} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CompRow({ row }: { row: ComparisonRow }) {
  return (
    <TableRow className={row.isRecommended ? 'bg-green-50/60' : undefined}>
      <TableCell>
        <div className="flex items-center gap-2 font-medium">
          {row.supplierName}
          {row.isRecommended && (
            <Badge variant="success" className="text-[10px]">
              <Trophy className="mr-1 h-3 w-3" /> Recommended
            </Badge>
          )}
        </div>
        {row.warnings.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {row.warnings.map((w, i) => (
              <li key={i} className="flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3 w-3" /> {w}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className={row.isLowestCost ? 'font-semibold text-green-700' : ''}>
        {formatMoney(row.totalPrice, row.currency ?? 'USD')}
        {row.isLowestCost && <span className="ml-1 text-[10px]">▼ lowest</span>}
      </TableCell>
      <TableCell className={row.isFastest ? 'font-semibold text-green-700' : ''}>
        {row.deliveryDays ? `${row.deliveryDays} days` : row.deliveryTime ?? '—'}
        {row.isFastest && <span className="ml-1 text-[10px]">⚡ fastest</span>}
      </TableCell>
      <TableCell>
        <span className={row.isMostReliable ? 'font-semibold text-green-700' : ''}>
          {row.reliabilityScore}/100
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{row.paymentTerms ?? '—'}</TableCell>
      <TableCell>
        {row.riskLevel ? (
          <Badge variant={RISK_VARIANT[row.riskLevel]}>{row.riskLevel}</Badge>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  );
}

function SortableHead({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <TableHead>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'text-primary' : 'opacity-50'}`} />
        {active && <span className="text-[10px]">{asc ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className={`mt-1 text-xl font-bold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
