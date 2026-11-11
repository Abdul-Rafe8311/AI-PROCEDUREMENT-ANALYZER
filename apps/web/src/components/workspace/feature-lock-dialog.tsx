'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FeatureId } from '@/lib/entitlements/plans';
import { featureLockCopy } from '@/lib/feature-lock';
import { onFeatureLock } from '@/lib/feature-lock-store';

/** Explains a locked feature. Radix handles the focus trap, focus restore and Esc. Never opens by itself. */
export function FeatureLockDialog({
  feature,
  open,
  onOpenChange,
}: {
  feature: FeatureId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const c = featureLockCopy(feature);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{c.name}</DialogTitle>
          <DialogDescription>
            Available on the {c.planName} plan and higher. {c.benefit}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="min-h-[44px] min-w-[120px]">
            <Link href="/plans">See plans</Link>
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="min-h-[44px] min-w-[120px]">
              Close
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once on the workspace; opens the dialog when code elsewhere hits a 403 PLAN_REQUIRED. */
export function FeatureLockHost() {
  const [feature, setFeature] = useState<FeatureId | null>(null);
  useEffect(() => onFeatureLock((f) => setFeature(f)), []);
  if (!feature) return null;
  return <FeatureLockDialog feature={feature} open onOpenChange={(o) => !o && setFeature(null)} />;
}

/** Muted, clickable control with a Lock icon and an outline badge naming the plan. Never hidden, never red. */
export function LockedFeatureButton({
  feature,
  label,
  onOpen,
}: {
  feature: FeatureId;
  label: string;
  onOpen: () => void;
}) {
  const c = featureLockCopy(feature);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Lock className="h-4 w-4" aria-hidden="true" />
      {label}
      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-foreground">
        {c.planName}
      </span>
      <span className="sr-only">: requires the {c.planName} plan</span>
    </button>
  );
}
