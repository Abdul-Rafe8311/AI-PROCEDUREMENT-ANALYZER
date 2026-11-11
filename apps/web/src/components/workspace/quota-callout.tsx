'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { quotaCalloutMessage, type QuotaBlock } from '@/lib/quota-callout';

// Inline, non-modal explanation of a blocked upload. Announced via role="alert"; the text carries
// the meaning (no color-only cue). Shown only after a blocked attempt, dismissible for the session.
export function QuotaCallout({ block, onDismiss }: { block: QuotaBlock; onDismiss: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="text-foreground">{quotaCalloutMessage(block)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild className="min-h-[44px] min-w-[120px]">
          <Link href="/plans">See plans</Link>
        </Button>
        <Button type="button" variant="outline" onClick={onDismiss} className="min-h-[44px] min-w-[120px]">
          Not now
        </Button>
      </div>
    </div>
  );
}
