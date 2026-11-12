'use client';

// Home-page Pricing section. Plan data comes from the same matrix as /plans (planColumns); prices come from
// the server (/api/billing/prices, same source as /api/billing/config) and show a dash if they can't load.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { planColumns, type PlanPrices } from '@/lib/plan-matrix';
import { cn } from '@/lib/utils';

const btn =
  'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2 text-sm', !on && 'text-muted-foreground')}>
      {on ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <span>
        {children}
        <span className="sr-only">{on ? ' (included)' : ' (not included)'}</span>
      </span>
    </li>
  );
}

export function PricingSection() {
  const { user } = useAuth();
  const [prices, setPrices] = useState<PlanPrices | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/prices');
        if (res.ok && !cancelled) setPrices(((await res.json()) as { prices: PlanPrices }).prices);
      } catch {
        /* prices show a dash */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cols = planColumns(prices);

  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 sm:py-24" aria-labelledby="pricing-heading">
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-primary">Pricing</span>
        <h2 id="pricing-heading" className="mt-2 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Simple plans that scale with your volume
        </h2>
        <p className="mt-3 text-pretty text-base text-muted-foreground">
          Start free. Upgrade when you need more PDFs, the chatbox or the tender sheet.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => {
          const paid = c.id !== 'free';
          const href = !user ? '/signup' : paid ? `/plans/pay?plan=${c.id}` : '/workspace';
          const label = !user ? 'Get started' : paid ? 'Choose plan' : 'Open workspace';
          return (
            <div key={c.id} className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">{c.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight tabular-nums">{c.price}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                <Feature on>{c.quota} PDFs per month</Feature>
                <Feature on={c.chat}>Chatbox</Feature>
                <Feature on={c.tender}>Tender sheet</Feature>
                <Feature on>{c.support} support</Feature>
              </ul>
              <Link
                href={href}
                aria-label={`${label}: ${c.name}`}
                className={cn(
                  btn,
                  'mt-8',
                  paid ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90' : 'border border-input bg-background hover:bg-accent',
                )}
              >
                {label}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
