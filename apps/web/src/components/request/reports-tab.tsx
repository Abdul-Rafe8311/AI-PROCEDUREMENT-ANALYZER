'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FilePlus2, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Report {
  id: string;
  title: string;
  createdAt: string;
  downloadUrl?: string;
}

export function ReportsTab({ requestId }: { requestId: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['reports', requestId],
    queryFn: () => api.get<Report[]>(`/requests/${requestId}/reports`),
  });

  const generate = useMutation({
    mutationFn: () => api.post<Report>(`/requests/${requestId}/reports`),
    onSuccess: (report) => {
      toast.success('Report generated');
      qc.invalidateQueries({ queryKey: ['reports', requestId] });
      if (report.downloadUrl) window.open(report.downloadUrl, '_blank');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function download(id: string) {
    try {
      const { url } = await api.get<{ url: string }>(`/reports/${id}/download`);
      window.open(url, '_blank');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileDown className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Procurement Report</p>
              <p className="text-sm text-muted-foreground">
                Generate a PDF with the comparison, cost & risk analysis, and recommendation.
              </p>
            </div>
          </div>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            Generate PDF
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : data?.length ? (
          data.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => download(r.id)}>
                  <Download className="h-4 w-4" /> Download
                </Button>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No reports generated yet.</p>
        )}
      </div>
    </div>
  );
}
