import { NextResponse } from 'next/server';
import { taFormWorkbookBuffer } from '@/lib/ta-form-excel';
import type { ApprovalFormOptions } from '@/lib/approval-form-pdf';
import type { FxRates } from '@/lib/fx-rates';
import type { AnalysisResult } from '@/lib/workspace-types';

// POST /api/ta-form/export-excel
// Renders the CURRENT Technical Approval Form state to .xlsx and streams it back.
//
// Same pattern as /api/tender-sheet/export: the analysis + Customize options
// travel in the request body rather than being looked up by id, so the
// download always matches what is on the reviewer's screen — including
// Customize edits (comments, warranty, origin, item review) not yet saved
// anywhere, and the SAME fx rate the on-screen table was built with. Node
// runtime — ExcelJS needs it.

export const runtime = 'nodejs';
export const maxDuration = 30;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args: unknown[]) => console.error('[api/ta-form/export-excel]', ...args);

function fail(status: number, message: string, detail?: string) {
  log(`${status}: ${message}${detail ? ` — ${detail}` : ''}`);
  return NextResponse.json({ error: message, ...(isDev && detail ? { detail } : {}) }, { status });
}

interface Body {
  analysis?: AnalysisResult;
  options?: ApprovalFormOptions;
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
    const buffer = await taFormWorkbookBuffer(analysis, { ...(body.options ?? {}), fx: body.fx ?? null });
    const safe = (body.fileName || `technical-approval-form-${new Date().toISOString().slice(0, 10)}`)
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safe || 'ta-form'}.xlsx"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return fail(500, 'Could not build the TA form workbook.', (err as Error).stack ?? (err as Error).message);
  }
}
