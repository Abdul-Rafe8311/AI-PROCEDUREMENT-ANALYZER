'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FileText, ShoppingCart, PiggyBank, Clock, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import type { Analytics } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.get<Analytics>('/analytics/overview'),
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const k = data.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">Procurement performance and spend insights.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Procurement Volume" value={k.totalRequests} icon={FileText} hint="total requests" />
        <StatCard label="Total Quotations" value={k.totalQuotations} icon={ShoppingCart} />
        <StatCard label="Cost Savings" value={formatMoney(k.estimatedSavings)} icon={PiggyBank} accent="bg-green-100 text-green-700" />
        <StatCard label="Avg. Response Time" value={`${k.avgQuotationResponseHours}h`} icon={Clock} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Procurement Spend</CardTitle>
          </CardHeader>
          <CardContent>
            {data.monthlySpend.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.monthlySpend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Bar dataKey="value" fill="hsl(221 83% 45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Procurement Volume Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {data.procurementVolume.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.procurementVolume}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="hsl(221 83% 45%)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" /> Top Suppliers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.topSuppliers.length ? (
            <div className="space-y-3">
              {data.topSuppliers.map((s, i) => {
                const max = Math.max(...data.topSuppliers.map((x) => x.quotes));
                return (
                  <div key={s.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {i + 1}. {s.name}
                      </span>
                      <span className="text-muted-foreground">
                        {s.quotes} quotes · {formatMoney(s.value)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(s.quotes / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
      No data available yet.
    </div>
  );
}
