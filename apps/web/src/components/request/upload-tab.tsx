'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, FileText, RefreshCw, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Quotation } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'warning' | 'destructive'> = {
  UPLOADED: 'secondary',
  PROCESSING: 'warning',
  EXTRACTED: 'success',
  AWARDED: 'success',
  FAILED: 'destructive',
};

export function UploadTab({
  requestId,
  quotations,
}: {
  requestId: string;
  quotations: Quotation[];
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      return api.upload(`/requests/${requestId}/quotations`, fd);
    },
    onSuccess: () => {
      toast.success('Uploaded — AI extraction is running…');
      // Refresh after a short delay to capture extraction results
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['request', requestId] });
        qc.invalidateQueries({ queryKey: ['comparison', requestId] });
      }, 2500);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quotations/${id}/reprocess`),
    onSuccess: () => {
      toast.success('Re-processing…');
      qc.invalidateQueries({ queryKey: ['request', requestId] });
      qc.invalidateQueries({ queryKey: ['comparison', requestId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function download(id: string) {
    try {
      const { url } = await api.get<{ url: string }>(`/quotations/${id}/download`);
      window.open(url, '_blank');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) uploadMutation.mutate(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
        }`}
      >
        {uploadMutation.isPending ? (
          <Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" />
        ) : (
          <UploadCloud className="mb-2 h-8 w-8 text-muted-foreground" />
        )}
        <p className="font-medium">Drop quotations here or click to upload</p>
        <p className="text-sm text-muted-foreground">PDF, DOCX, JPG or PNG · up to 15MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => e.target.files && uploadMutation.mutate(e.target.files)}
        />
      </div>

      <div className="space-y-3">
        {quotations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No quotations uploaded yet.
          </p>
        ) : (
          quotations.map((q) => (
            <Card key={q.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{q.supplierName ?? q.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.items?.length ?? 0} items ·{' '}
                      {q.deliveryDays ? `${q.deliveryDays} days` : q.deliveryTime ?? 'delivery N/A'} ·{' '}
                      {q.paymentTerms ?? 'terms N/A'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatMoney(q.totalPrice, q.currency ?? 'USD')}</span>
                  <Badge variant={STATUS_VARIANT[q.status] ?? 'secondary'}>{q.status}</Badge>
                  <Button variant="ghost" size="icon" title="Download" onClick={() => download(q.id)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Re-run AI extraction"
                    onClick={() => reprocessMutation.mutate(q.id)}
                    disabled={reprocessMutation.isPending}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
