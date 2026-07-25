'use client';

// The Technical Approval Form the app hands to the buyer: the react-pdf LAYOUT
// with editable AcroForm FIELDS on top.
//
//   approval-form-pdf.tsx      renders the buyer's reference layout (react-pdf)
//   approval-form-overlay.ts   loads those bytes and lays editable widgets over
//                              the measured value cells (pdf-lib)
//   approval-form-layout.ts    the page geometry both of them share
//
// The layout is produced once, by react-pdf, and is never rebuilt with pdf-lib
// drawing primitives. If the overlay step fails for any reason the plain rendered
// form is still returned — a non-editable correct form beats no form at all.

import { generateApprovalFormPdf as renderLayout, type ApprovalFormOptions } from './approval-form-pdf';
import { overlayEditableFields } from './approval-form-overlay';
import type { AnalysisResult } from './workspace-types';

export type { ApprovalFormOptions };

/** Build the Technical Approval Form: reference layout + editable fields. */
export async function generateApprovalFormPdf(
  analysis: AnalysisResult,
  options?: ApprovalFormOptions,
): Promise<Blob> {
  const rendered = await renderLayout(analysis, options);
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  try {
    const withFields = await overlayEditableFields(bytes);
    // Copy into a fresh ArrayBuffer-backed view so the Blob part type is unambiguous.
    const out = new Uint8Array(withFields.byteLength);
    out.set(withFields);
    return new Blob([out], { type: 'application/pdf' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ta-form] field overlay failed; returning the rendered layout', err);
    return rendered;
  }
}
