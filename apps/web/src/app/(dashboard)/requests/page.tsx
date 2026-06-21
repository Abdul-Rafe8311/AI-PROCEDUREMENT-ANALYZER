'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Paginated, ProcurementRequest } from '@/lib/types';
import { formatMoney, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning'> = {
  OPEN: 'secondary',
  COMPARING: 'warning',
  AWARDED: 'success',
  CLOSED: 'default',
};

export default function RequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    requiredItems: '',
    quantity: '',
    budget: '',
    currency: 'USD',
    requiredDeliveryDate: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['requests'],
    queryFn: () => api.get<Paginated<ProcurementRequest>>('/requests?limit=50'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<ProcurementRequest>('/requests', {
        title: form.title,
        description: form.description || undefined,
        requiredItems: form.requiredItems || undefined,
        quantity: form.quantity ? Number(form.quantity) : undefined,
        budget: form.budget ? Number(form.budget) : undefined,
        currency: form.currency,
        requiredDeliveryDate: form.requiredDeliveryDate
          ? new Date(form.requiredDeliveryDate).toISOString()
          : undefined,
      }),
    onSuccess: (r) => {
      toast.success('Request created');
      qc.invalidateQueries({ queryKey: ['requests'] });
      setOpen(false);
      router.push(`/requests/${r.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Procurement Requests</h1>
          <p className="text-muted-foreground">Create requests and compare supplier quotations.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> New Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Procurement Request</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="space-y-3"
            >
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Required items (one per line)</Label>
                <Textarea value={form.requiredItems} onChange={(e) => setForm({ ...form, requiredItems: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Budget</Label>
                  <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Required delivery date</Label>
                <Input type="date" value={form.requiredDeliveryDate} onChange={(e) => setForm({ ...form, requiredDeliveryDate: e.target.value })} />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create request'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : data?.data.length ? (
          data.data.map((r) => (
            <Link key={r.id} href={`/requests/${r.id}`}>
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{r.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {r._count?.quotations ?? 0} quotations · Budget {formatMoney(r.budget, r.currency)} · {formatDate(r.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{r.status}</Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No procurement requests yet.
          </p>
        )}
      </div>
    </div>
  );
}
