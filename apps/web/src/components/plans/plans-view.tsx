'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/lib/auth-context';
import { useEntitlements } from '@/lib/use-entitlements';
import { formatQuotaDate } from '@/lib/entitlements/quota-window';
import { comparisonRows, planColumns, PLAN_NAMES, type Cell, type PlanPrices } from '@/lib/plan-matrix';
import { planNotice } from '@/lib/plan-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { PlanId } from '@/lib/entitlements/plans';

interface BillingConfig {
  prices: PlanPrices;
  supportEmail: string | null;
}

const seenKey = (userId: string) => `plan-ended-told:${userId}`;

function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-4 w-4 text-success" aria-hidden />
      <span>{label}</span>
      <span className="sr-only">included</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Lock className="h-4 w-4" aria-hidden />
      <span>{label}</span>
      <span className="sr-only">not included</span>
    </span>
  );
}

function CellView({ value }: { value: Cell }) {
  if (typeof value === 'boolean') return <Flag on={value} label={value ? 'Included' : 'Locked'} />;
  return <span className="nums">{value}</span>;
}

export function PlansView() {
  const { user } = useAuth();
  const { data, loading, error } = useEntitlements();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const userId = user?.id ?? 'anon';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/billing/config');
        if (res.ok && !cancelled) setConfig((await res.json()) as BillingConfig);
      } catch {
        /* prices show a dash; the rest of the page still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      setTold(window.localStorage.getItem(seenKey(userId)));
    } catch {
      setTold(null);
    }
  }, [userId]);

  const notice = data ? planNotice(data, new Date(), told) : null;
  // Remember a shown "ended" notice so it appears once (best effort; storage may be unavailable).
  useEffect(() => {
    if (notice?.kind !== 'ended') return;
    try {
      window.localStorage.setItem(seenKey(userId), notice.key);
    } catch {
      /* ignore */
    }
  }, [notice?.kind, notice?.key, userId]);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p role="alert" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        We couldn't load your plan right now. Please try again in a moment.
      </p>
    );
  }

  const cols = planColumns(config?.prices ?? null);
  const rows = comparisonRows(config?.prices ?? null);
  const current = data.plan as PlanId;

  return (
    <div className="space-y-8">
      <section aria-labelledby="current-plan-heading" className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 id="current-plan-heading" className="text-sm font-medium text-muted-foreground">
          Your plan
        </h2>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{PLAN_NAMES[current] ?? data.plan}</p>
        <dl className="mt-3 space-y-1 text-sm">
          {current !== 'free' && data.expiresAt && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Active until</dt>
              <dd className="nums">{formatQuotaDate(data.expiresAt)}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-muted-foreground">PDFs used</dt>
            <dd className="nums">
              {data.used} of {data.quota} PDFs used
            </dd>
          </div>
          {data.resetAt && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Resets on</dt>
              <dd className="nums">{formatQuotaDate(data.resetAt)}</dd>
            </div>
          )}
        </dl>
      </section>

      {notice && (
        <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          {notice.text}
          {notice.kind === 'ending' && current !== 'free' && (
            <>
              {' '}
              <Link href={`/plans/pay?plan=${current}`} className="font-medium underline underline-offset-2">
                Renew {PLAN_NAMES[current]}
              </Link>
            </>
          )}
        </p>
      )}

      <section aria-label="Plans" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => {
          const isCurrent = c.id === current;
          return (
            <Card key={c.id} className={cn(isCurrent && 'border-2 border-primary')}>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{c.name}</h3>
                  {isCurrent && <Badge>Current plan</Badge>}
                </div>
                <p>
                  <span className="nums text-3xl font-semibold tracking-tight">{c.price}</span>
                  <span className="text-sm text-muted-foreground"> / month</span>
                </p>
                <p className="nums text-sm">{c.quota} PDFs per month</p>
                <ul className="space-y-2 text-sm">
                  <li>
                    <Flag on={c.chat} label="Chatbox" />
                  </li>
                  <li>
                    <Flag on={c.tender} label="Tender sheet" />
                  </li>
                </ul>
                {isCurrent ? (
                  <Button type="button" variant="outline" disabled className="min-h-[44px] w-full">
                    Current plan
                  </Button>
                ) : c.id !== 'free' ? (
                  <Button asChild variant="outline" className="min-h-[44px] w-full">
                    <Link href={`/plans/pay?plan=${c.id}`}>Choose {c.name}</Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="compare-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="compare-heading" className="text-base font-semibold">
            Compare plans
          </h2>
          <button
            type="button"
            onClick={() => setCompareOpen((o) => !o)}
            aria-expanded={compareOpen}
            className="min-h-[44px] rounded-md px-3 text-sm font-medium text-primary hover:underline md:hidden"
          >
            {compareOpen ? 'Hide comparison' : 'Compare plans'}
          </button>
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {cols.map((c) => (
                  <TableHead key={c.id}>{c.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  {cols.map((c) => (
                    <TableCell key={c.id}>
                      <CellView value={r.values[c.id]} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {compareOpen && (
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <Card key={r.label}>
                <CardContent className="space-y-2 p-4">
                  <h3 className="text-sm font-semibold">{r.label}</h3>
                  <ul className="space-y-1 text-sm">
                    {cols.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{c.name}</span>
                        <CellView value={r.values[c.id]} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="text-sm text-muted-foreground">
        <p>Max plan emails get a reply within 12 hours; everyone else within 48 hours.</p>
        {config?.supportEmail && (
          <p className="mt-1">
            Questions or help:{' '}
            <a className="font-medium text-foreground underline underline-offset-2" href={`mailto:${config.supportEmail}`}>
              {config.supportEmail}
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
