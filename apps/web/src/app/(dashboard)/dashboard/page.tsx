'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Users,
  PiggyBank,
  Clock,
  ArrowRight,
  Trophy,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Analytics, Paginated, ProcurementRequest } from '@/lib/types';
import { formatMoney, formatDate } from '@/lib/utils';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-store';

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const analytics = useQuery({
    queryKey: ['analytics'],
    queryFn: () => api.get<Analytics>('/analytics/overview'),
  });
  const requests = useQuery({
    queryKey: ['requests', 'recent'],
    queryFn: () => api.get<Paginated<ProcurementRequest>>('/requests?limit=5'),
  });

  const k = analytics.data?.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user?.firstName} 👋</h1>
        <p className="text-muted-foreground">
          Here&apos;s a snapshot of your procurement activity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {analytics.isLoading || !k ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard label="Active Requests" value={k.totalRequests} icon={FileText} hint={`${k.awardedRequests} awarded`} />
            <StatCard label="Suppliers" value={k.totalSuppliers} icon={Users} />
            <StatCard label="Estimated Savings" value={formatMoney(k.estimatedSavings)} icon={PiggyBank} accent="bg-green-100 text-green-700" />
            <StatCard label="Avg. Response" value={`${k.avgQuotationResponseHours}h`} icon={Clock} hint="quotation turnaround" />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Procurement Requests</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/requests">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {requests.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)
            ) : requests.data?.data.length ? (
              requests.data.data.map((r) => (
                <Link
                  key={r.id}
                  href={`/requests/${r.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r._count?.quotations ?? 0} quotations · {formatDate(r.createdAt)}
                    </p>
                  </div>
                  <Badge variant="secondary">{r.status}</Badge>
                </Link>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No requests yet. Create your first procurement request.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" /> Top Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)
            ) : analytics.data?.topSuppliers.length ? (
              analytics.data.topSuppliers.slice(0, 6).map((s, i) => (
                <div key={s.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="text-muted-foreground">{s.quotes} quotes</span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
