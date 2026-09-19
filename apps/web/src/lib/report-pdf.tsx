'use client';

// Client-only, on-demand PDF report generator (browser download button). The
// actual document definition lives in report-pdf-document.tsx, which has no
// 'use client' directive so the SAME document can also be rendered server-side
// (see /api/report/export) for the automated email-delivery pipeline.

import { pdf } from '@react-pdf/renderer';
import { applyFxRates } from './analysis-engine';
import { getFxRates } from './fx-rates';
import { ReportDocument } from './report-pdf-document';
import type { AnalysisResult } from './workspace-types';

/** Build the report PDF as a Blob from the real analysis data. */
export async function generateReportPdf(analysis: AnalysisResult): Promise<Blob> {
  // Same single live FX source as the TA form / comparison view (cached fallback,
  // never a hardcoded rate), so every USD figure agrees across all outputs.
  const fx = await getFxRates();
  const withFx = applyFxRates(analysis, fx);
  return pdf(<ReportDocument analysis={withFx} fx={fx} />).toBlob();
}
