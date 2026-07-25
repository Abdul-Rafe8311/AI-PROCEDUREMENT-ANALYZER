'use client';

// The Technical Approval Form the app hands to the buyer.
//
//   approval-form-pdf.tsx      renders the buyer's reference layout (react-pdf)
//   approval-form-layout.ts    the page geometry the renderer and overlay share
//   approval-form-overlay.ts   OPTIONAL — lays editable AcroForm widgets over the
//                              measured value cells (pdf-lib), behind `fillable`
//
// The form is FLAT by default: plain printed text, no form fields, no widgets, no
// clickable regions. All reviewer editing happens in the "Customize form" modal
// BEFORE the PDF is produced — the reviewer's edited description / quantity / unit
// price, technical comments, warranty and country of origin are folded into the
// render (see item-review.ts), so the printed values are already the ones they
// signed off. The PDF is the final, printable output.
//
// The fillable path is kept and still tested, so a fillable build is one option
// away if it is ever wanted again.

import { generateApprovalFormPdf as renderLayout, type ApprovalFormOptions } from './approval-form-pdf';
import type { AnalysisResult } from './workspace-types';

export type { ApprovalFormOptions };

/**
 * Build the Technical Approval Form.
 *
 * Flat by default. Pass `fillable: true` to overlay editable AcroForm fields on
 * the same layout — the code path is intact but unused by the app.
 */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const rendered = await renderLayout(analysis, options);
  if (!options?.fillable) return rendered;

  // ── opt-in: the same layout with editable fields laid over its value cells ──
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  try {
    const { overlayEditableFields } = await import('./approval-form-overlay');
    const withFields = await overlayEditableFields(bytes);
    // Copy into a fresh ArrayBuffer-backed view so the Blob part type is unambiguous.
    const out = new Uint8Array(withFields.byteLength);
    out.set(withFields);
    return new Blob([out], { type: 'application/pdf' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ta-form] field overlay failed; returning the flat layout', err);
    return rendered;
  }
}
