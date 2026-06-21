'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Comparison, ProcurementRequest, Quotation } from '@/lib/types';
import { formatMoney, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComparisonTab } from '@/components/request/comparison-tab';
import { UploadTab } from '@/components/request/upload-tab';
import { ChatTab } from '@/components/request/chat-tab';
import { ReportsTab } from '@/components/request/reports-tab';

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const request = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.get<ProcurementRequest & { quotations: Quotation[] }>(`/requests/${id}`),
  });

  const comparison = useQuery({
    queryKey: ['comparison', id],
    queryFn: () => api.get<Comparison>(`/requests/${id}/comparison`),
  });

  if (request.isLoading) {
    return <Skeleton className="h-96" />;
  }
  if (request.isError || !request.data) {
    return <p className="text-sm text-destructive">Failed to load request.</p>;
  }

  const r = request.data;

  return (
    <div className="space-y-6">
      <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{r.title}</h1>
          {r.description && <p className="max-w-2xl text-muted-foreground">{r.description}</p>}
        </div>
        <Badge variant="secondary" className="text-sm">{r.status}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Meta label="Budget" value={formatMoney(r.budget, r.currency)} />
        <Meta label="Quantity" value={r.quantity?.toLocaleString() ?? '—'} />
        <Meta label="Required by" value={formatDate(r.requiredDeliveryDate)} />
        <Meta label="Quotations" value={String(r.quotations?.length ?? 0)} />
      </div>

      <Tabs defaultValue="comparison">
        <TabsList>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
          <TabsTrigger value="quotations">Quotations</TabsTrigger>
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="comparison">
          <ComparisonTab
            requestId={id}
            data={comparison.data}
            isLoading={comparison.isLoading}
          />
        </TabsContent>
        <TabsContent value="quotations">
          <UploadTab requestId={id} quotations={r.quotations ?? []} />
        </TabsContent>
        <TabsContent value="chat">
          <ChatTab requestId={id} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab requestId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
