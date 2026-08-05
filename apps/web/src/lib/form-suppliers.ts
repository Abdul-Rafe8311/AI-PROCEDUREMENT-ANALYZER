// Which supplier columns the Technical Approval Form prints, and what number each
// one carries.
//
// Both are reviewer choices made in the Customize dialog:
//
//   • HIDE — a column the reviewer does not want on this printout. A display
//     filter, never a delete: the supplier stays in the analysis and can be
//     brought back. A hidden column must also stop competing, so the "lowest
//     price" highlight is decided among the columns that are actually shown.
//     That falls out for free, because `lowestUsd` is computed over whatever
//     cells exist — hiding happens BEFORE the comparison model is built.
//
//   • NUMBERING — with a column hidden, "SUPPLIER #2" is ambiguous. Renumbering
//     closes the gap (#1 #2 #3), which reads correctly on a document that gets
//     signed; keeping the original numbers (#1 #3 #4) preserves cross-reference
//     with a printout someone is already holding. Neither is right in general,
//     so it is the reviewer's call. Default: renumber.
//
// Applied by BOTH renderers through this one function, so the PDF and the .xlsx
// can never disagree about which columns exist or what they are called.
//
// Pure and offline: no LLM, no network.

import type { AnalysisResult, PrMatchResult } from './workspace-types';

/** How supplier columns are numbered once some are hidden. */
export type SupplierNumbering = 'renumber' | 'original';

export interface FormSuppliers {
  /** the analysis with hidden suppliers removed, ready for buildComparisonModel */
  analysis: AnalysisResult;
  /** printed column number, keyed by quotation id (1-based) */
  displayNo: Record<string, number>;
  /** true when the reviewer's selection was ignored because it hid everything */
  allHidden: boolean;
}

/**
 * Resolve the visible supplier set and its printed numbering.
 *
 * A selection that hides EVERY supplier is not honoured: a form with no price
 * columns is not a form, and silently emitting one would be worse than ignoring
 * the request. The dialog disables the download in that state, so this is a
 * backstop for anything that reaches a renderer another way.
 */
export function formSuppliers(
  analysis: AnalysisResult,
  opts?: { hiddenSuppliers?: string[] | null; supplierNumbering?: SupplierNumbering | null },
): FormSuppliers {
  const all = analysis.quotations ?? [];
  // Original positions are captured BEFORE filtering — that is what "keep the
  // original numbers" means.
  const originalNo: Record<string, number> = {};
  all.forEach((q, i) => {
    originalNo[q.id] = i + 1;
  });

  const hidden = new Set(opts?.hiddenSuppliers ?? []);
  const kept = hidden.size ? all.filter((q) => !hidden.has(q.id)) : all;
  const allHidden = kept.length === 0 && all.length > 0;
  const visible = allHidden ? all : kept;

  const displayNo: Record<string, number> = {};
  const numbering = opts?.supplierNumbering ?? 'renumber';
  visible.forEach((q, i) => {
    displayNo[q.id] = numbering === 'original' ? originalNo[q.id] : i + 1;
  });

  if (visible.length === all.length) {
    return { analysis, displayNo, allHidden };
  }

  // The PR match is keyed per supplier, so it is filtered in step — a stale entry
  // for a hidden column would leave the grid and the matching disagreeing about
  // which suppliers exist.
  const visibleIds = new Set(visible.map((q) => q.id));
  const prMatch: PrMatchResult | null = analysis.prMatch
    ? { ...analysis.prMatch, bySupplier: analysis.prMatch.bySupplier.filter((s) => visibleIds.has(s.quotationId)) }
    : (analysis.prMatch ?? null);

  return {
    analysis: { ...analysis, quotations: visible, prMatch },
    displayNo,
    allHidden,
  };
}
