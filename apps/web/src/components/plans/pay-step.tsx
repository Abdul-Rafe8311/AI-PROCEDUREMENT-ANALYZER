'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { useEntitlements } from '@/lib/use-entitlements';
import { PAID_PLAN_IDS, type PlanId } from '@/lib/entitlements/plans';
import { PLAN_NAMES } from '@/lib/plan-matrix';
import { PAY_STEPS, copyValue, displayValue, payDisclosures, payHeading, refundPolicy } from '@/lib/pay-step';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { usePayments } from '@/lib/use-payments';
import { underReviewText } from '@/lib/payment-form';
import type { PaidPlanId } from '@/lib/entitlements/plans';
import { ProofForm } from './proof-form';
import { PaymentHistory } from './payment-history';

interface BillingConfig {
  prices: Partial<Record<PlanId, number | null>>;
  supportEmail: string | null;
  bank: Array<{ key: string; label: string; value: string }>;
}

function CopyButton({ label, value, onCopied }: { label: string; value: string; onCopied: (label: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // clipboard unavailable: the value stays selectable text
    }
    setCopied(true);
    onCopied(label);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [value, label, onCopied]);
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      {copied && <span className="sm:hidden">Copied</span>}
    </button>
  );
}

export function PayStep({ planParam }: { planParam: string | null }) {
  const { data, loading, error } = useEntitlements();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const payments = usePayments(1, 10);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/billing/config');
        if (!res.ok) throw new Error('config');
        if (!cancelled) setConfig((await res.json()) as BillingConfig);
      } catch {
        if (!cancelled) setConfigFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const target = (PAID_PLAN_IDS as readonly string[]).includes(planParam ?? '') ? (planParam as PlanId) : null;

  const back = (
    <Link
      href="/plans"
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to plans
    </Link>
  );

  if (!target) {
    return (
      <div className="space-y-4">
        {back}
        <p role="alert" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          Choose a plan first.{' '}
          <Link href="/plans" className="font-medium underline underline-offset-2">
            See plans
          </Link>
        </p>
      </div>
    );
  }

  if (loading || payments.loading || (!config && !configFailed)) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !data || configFailed || !config) {
    return (
      <div className="space-y-4">
        {back}
        <p role="alert" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          We couldn&apos;t load the payment details right now. Please try again in a moment.
        </p>
      </div>
    );
  }

  const price = config.prices[target];
  const support = config.supportEmail;
  if (typeof price !== 'number' || config.bank.length === 0) {
    return (
      <div className="space-y-4">
        {back}
        <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          Payment for {PLAN_NAMES[target]} isn&apos;t available yet.
          {support && (
            <>
              {' '}
              Please email{' '}
              <a className="font-medium underline underline-offset-2" href={`mailto:${support}`}>
                {support}
              </a>
              .
            </>
          )}
        </p>
      </div>
    );
  }

  const current = data.plan as PlanId;
  const chainEnd = data.queued.length ? data.queued[data.queued.length - 1].endsAt : data.expiresAt;
  const disclosures = payDisclosures({ current, target, chainEnd });
  const pendingAt = submittedAt ?? payments.data?.pending?.createdAt ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {back}
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{payHeading(price)}</h2>
        <p className="text-sm text-muted-foreground">{PLAN_NAMES[target]} plan, 30 days.</p>
        <p className="nums text-5xl font-semibold tracking-tight" aria-hidden="true">
          ${price.toFixed(2)}
        </p>
      </header>

      <ol className="space-y-2 text-sm">
        {PAY_STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>

      <section aria-labelledby="bank-heading" className="rounded-xl bg-muted/50 p-4 sm:p-6">
        <h3 id="bank-heading" className="mb-3 text-sm font-semibold">
          Bank details
        </h3>
        <dl className="divide-y divide-border">
          {config.bank.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className="nums break-words text-sm font-medium">{displayValue(r.key, r.value)}</dd>
              </div>
              <CopyButton label={r.label} value={copyValue(r.key, r.value)} onCopied={(l) => setAnnounce(`${l} copied`)} />
            </div>
          ))}
        </dl>
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
      </section>

      <section aria-label="Before you pay" className="space-y-2 text-sm text-muted-foreground">
        {disclosures.map((d) => (
          <p key={d} className="text-foreground">
            {d}
          </p>
        ))}
        <p>{refundPolicy(support)}</p>
      </section>

      {pendingAt ? (
        <div role="status" className="rounded-xl border border-border bg-warning/10 px-4 py-4 text-sm">
          <p className="font-medium">{underReviewText(pendingAt)}</p>
        </div>
      ) : (
        <ProofForm plan={target as PaidPlanId} onSubmitted={(at) => { setSubmittedAt(at); payments.refresh(); }} />
      )}

      <PaymentHistory key={submittedAt ?? 'initial'} />

      <div>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href="/plans">Back to plans</Link>
        </Button>
      </div>
    </div>
  );
}
