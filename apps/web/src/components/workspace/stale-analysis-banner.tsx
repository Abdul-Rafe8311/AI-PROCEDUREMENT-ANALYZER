'use client';

// A restored session whose stored results came out of an OLDER extraction
// pipeline. The stored line items are whatever that build produced — if it
// dropped or merged an item, nothing downstream can recover it, so the whole
// comparison (and any Technical Approval Form generated from it) can be wrong in
// ways that look perfectly plausible on screen.
//
// This is deliberately loud and sits ABOVE the results. Rendering stale stored
// shapes as if they were current is exactly how a reviewer ends up trusting a
// "Not Quoted" that was never true.

import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { StaleAnalysis } from '@/lib/workspace-types';

export function StaleAnalysisBanner({
  stale,
  onStartFresh,
}: {
  stale: StaleAnalysis;
  /** clear the restored session so the reviewer can re-upload the documents */
  onStartFresh?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-4xl rounded-lg border border-warning/40 bg-warning/10 px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            These results are out of date — re-run the analysis before relying on them
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This session was saved by an earlier version of the extraction pipeline
            {typeof stale.storedVersion === 'number'
              ? ` (v${stale.storedVersion}; the app now runs v${stale.currentVersion})`
              : ` (before pipeline versioning; the app now runs v${stale.currentVersion})`}
            . {stale.reason}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The stored line items, totals and &ldquo;Not Quoted&rdquo; marks below are exactly what that
            older build produced — they are shown for reference only and cannot be corrected without
            reading the source documents again. Upload the same quotations to get a current analysis.
          </p>
          {onStartFresh && (
            <button
              type="button"
              onClick={onStartFresh}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Start a fresh analysis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
