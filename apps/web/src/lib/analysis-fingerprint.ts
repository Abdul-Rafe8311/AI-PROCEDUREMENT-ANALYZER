// A short, stable identifier for "which analysis is this?".
//
// The Technical Approval Form gets signed, so a downloaded workbook that does not
// match the analysis on screen is a serious failure — and a silent one, because
// the file looks perfectly well-formed either way. The Excel export round-trips
// through an API route (ExcelJS needs Node), which means the analysis crosses a
// network boundary that the client-side PDF never does.
//
// The client states which analysis it believes it is exporting; the route derives
// the same value from the body it actually received and refuses to build a
// workbook if they disagree. Cheap, and it turns an invisible mismatch into a
// visible error.
//
// Scope, stated plainly: this proves the workbook was built from the object the
// client SENT. It cannot prove that object was current — stale client state has
// to be prevented where it happens (see the auto-restore guards in
// workspace/page.tsx), not detected here.

import type { AnalysisResult } from './workspace-types';

/**
 * Identity of an analysis: its requisition number and its supplier set. Both are
 * what a reviewer would use to tell two analyses apart on sight, and both change
 * whenever the analysis does.
 */
export function analysisFingerprint(analysis: AnalysisResult | null | undefined): string {
  if (!analysis) return 'none';
  const pr = analysis.purchaseRequisition?.requestNo?.trim() || 'no-pr';
  // Sorted so column order (or an option split) cannot change the identity of the
  // same underlying set.
  const suppliers = (analysis.quotations ?? [])
    .map((q) => q.id)
    .sort()
    .join(',');
  return `${pr}::${suppliers || 'empty'}`;
}
