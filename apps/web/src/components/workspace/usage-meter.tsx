'use client';

import Link from 'next/link';
import { useEntitlements } from '@/lib/use-entitlements';
import { meterModel } from '@/lib/usage-meter';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const FILL = { ok: 'bg-primary', warning: 'bg-warning', danger: 'bg-danger' } as const;

function Meter({ strip }: { strip?: boolean }) {
  const { data, loading, error } = useEntitlements();
  if (loading) return <Skeleton className={cn('h-8', strip ? 'w-full' : 'w-44')} aria-hidden />;
  // Never show "0 / 0": with no real figures, render nothing.
  if (error || !data || data.quota <= 0) return null;
  const m = meterModel(data);
  return (
    <Link
      href="/plans"
      className={cn(
        'group flex min-h-[44px] flex-col justify-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition hover:text-foreground',
        strip && 'w-full',
      )}
    >
      <span className="nums whitespace-nowrap">{m.text}</span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={m.max}
        aria-valuenow={m.now}
        aria-label={m.text}
        className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <span className={cn('block h-full rounded-full', FILL[m.tone])} style={{ width: `${m.pct}%` }} />
      </span>
    </Link>
  );
}

/** Header usage meter. Inline from md up; below md a full-width strip under the header row, never hidden. */
export function UsageMeter() {
  return (
    <div className="hidden md:block">
      <Meter />
    </div>
  );
}

export function UsageMeterStrip() {
  return (
    <div className="border-t border-border/70 px-6 py-1 md:hidden">
      <Meter strip />
    </div>
  );
}
