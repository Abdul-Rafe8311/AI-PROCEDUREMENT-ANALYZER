import { NextResponse } from 'next/server';
import { pdf } from '@react-pdf/renderer';
import { applyFxRates } from '@/lib/analysis-engine';
import { ReportDocument } from '@/lib/report-pdf-document';
import type { FxRates } from '@/lib/fx-rates';
import type { AnalysisResult } from '@/lib/workspace-types';

// POST /api/report/export
// Server-side render of the SAME Procurement Analysis Report the browser's
// "Download Report" button produces (see report-pdf.tsx / report-pdf-document.tsx),
// for callers with no browser — e.g. an automated pipeline that receives the
// analysis JSON from /api/extract and needs the PDF back to attach to an email.
//
// No FX lookup is performed here: fx travels in the body (optional), exactly
// like /api/ta-form/export-excel, and a missing rate degrades to "amounts in
// each supplier's own currency" rather than failing. Node runtime — react-pdf
// needs it.

export const runtime = 'nodejs';
export const maxDuration = 30;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args: unknown[]) => console.error('[api/report/export]', ...args);

function fail(status: number, message: string, detail?: string) {
  log(`${status}: ${message}${detail ? ` — ${detail}` : ''}`);
  return NextResponse.json({ error: message, ...(isDev && detail ? { detail } : {}) }, { status });
}

interface Body {
  analysis?: AnalysisResult;
  fx?: FxRates | null;
  fileName?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch (err) {
    return fail(400, 'Could not read the request body.', (err as Error).message);
  }

  const analysis = body?.analysis;
  if (!analysis?.quotations?.length) {
    return fail(400, 'No analysis to export.', 'body.analysis.quotations was empty or missing');
  }

  try {
    const fx = body.fx ?? null;
    const withFx = applyFxRates(analysis, fx);

    const instance = pdf(<ReportDocument analysis={withFx} fx={fx} />);
    // In Node, toBuffer() resolves to a Readable stream (despite the name) —
    // collect it into an actual Buffer before returning.
    const stream = await instance.toBuffer();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const safe = (body.fileName || `procurement-report-${new Date().toISOString().slice(0, 10)}`)
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safe || 'procurement-report'}.pdf"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return fail(500, 'Could not build the report PDF.', (err as Error).stack ?? (err as Error).message);
  }
}
