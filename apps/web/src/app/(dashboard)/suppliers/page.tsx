'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Star, Globe, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Paginated, Supplier } from '@/lib/types';
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

function reliabilityVariant(score: number) {
  if (score >= 80) return 'success' as const;
  if (score >= 60) return 'warning' as const;
  return 'destructive' as const;
}

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    companyName: '',
    contactPerson: '',
    email: '',
    phone: '',
    country: '',
    reliabilityScore: 50,
    notes: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () =>
      api.get<Paginated<Supplier>>(`/suppliers?limit=50&search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => api.post<Supplier>('/suppliers', body),
    onSuccess: () => {
      toast.success('Supplier created');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setOpen(false);
      setForm({ companyName: '', contactPerson: '', email: '', phone: '', country: '', reliabilityScore: 50, notes: '' });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-muted-foreground">Manage your supplier directory and reliability.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Add Supplier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Supplier</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(form);
              }}
              className="space-y-3"
            >
              <div className="space-y-2">
                <Label>Company name *</Label>
                <Input
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Contact person</Label>
                  <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reliability score: {form.reliabilityScore}</Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={form.reliabilityScore}
                  onChange={(e) => setForm({ ...form, reliabilityScore: Number(e.target.value) })}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Create supplier'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search suppliers…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)
        ) : data?.data.length ? (
          data.data.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{s.companyName}</h3>
                    {s.contactPerson && (
                      <p className="text-sm text-muted-foreground">{s.contactPerson}</p>
                    )}
                  </div>
                  <Badge variant={reliabilityVariant(s.reliabilityScore)}>
                    <Star className="mr-1 h-3 w-3" /> {s.reliabilityScore}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {s.country && (
                    <p className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5" /> {s.country}
                    </p>
                  )}
                  {s.email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5" /> {s.email}
                    </p>
                  )}
                </div>
                {s.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{s.notes}</p>}
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            No suppliers found.
          </p>
        )}
      </div>
    </div>
  );
}
