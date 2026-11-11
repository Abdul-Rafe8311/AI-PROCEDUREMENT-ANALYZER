'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, ChevronDown, Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PLAN_NAMES } from '@/lib/plan-matrix';
import { dateLabel, pageCount, statusBadge } from '@/lib/payment-form';
import { usePayments } from '@/lib/use-payments';
import type { PaymentDto } from '@/lib/payments-types';

const ICONS = { clock: Clock, check: CheckCircle2, x: XCircle } as const;

function Row({ p }: { p: PaymentDto }) {
  const [open, setOpen] = useState(false);
  const b = statusBadge(p.status);
  const Icon = ICONS[b.icon];
  const rejected = p.status === 'rejected';
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-sm">
          <span className="nums w-28">{dateLabel(p.createdAt)}</span>
          <span className="w-14 font-medium">{PLAN_NAMES[p.plan]}</span>
          <span className="nums">${p.amountUsd.toFixed(2)} USD</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.className}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {b.label}
          </span>
          {rejected && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? 'Hide reason' : 'Show reason'}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md hover:bg-muted"
            >
              <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {rejected && open && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
          <p>
            <span className="text-muted-foreground">Reason: </span>
            {p.rejectReason ?? 'No reason was recorded.'}
          </p>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/plans">Submit a new request</Link>
          </Button>
        </div>
      )}
    </li>
  );
}

export function PaymentHistory() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = usePayments(page, 10);
  if (loading && !data) return <Skeleton className="h-24 w-full" />;
  if (error && !data) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        We couldn&apos;t load your payment history right now.
      </p>
    );
  }
  if (!data || data.total === 0) return null;
  const pages = pageCount(data.total, data.pageSize);
  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <h2 id="history-heading" className="text-base font-semibold">
        Payment history
      </h2>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4">
        {data.requests.map((p) => (
          <Row key={p.id} p={p} />
        ))}
      </ul>
      {pages > 1 && (
        <nav aria-label="Payment history pages" className="flex items-center justify-between text-sm">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            Previous
          </Button>
          <span className="nums text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
            Next
          </Button>
        </nav>
      )}
    </section>
  );
}
