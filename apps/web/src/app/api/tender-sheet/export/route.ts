import { NextResponse } from 'next/server';
import { tenderWorkbookBuffer } from '@/lib/tender-sheet/excel';
import type { TenderSheet } from '@/lib/tender-sheet/types';

// POST /api/tender-sheet/export
// Renders the CURRENT template+answers to .xlsx and streams it back.
//
// The sheet travels in the request body rather than being read from the database:
// the reviewer downloads what is on their screen, including edits they have not
// saved yet, and the renderer stays a pure function of the JSON. Node runtime —
// ExcelJS needs it.

export const runtime = 'nodejs';
export const maxDuration = 30;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args: unknown[]) => console.error('[api/tender-sheet/export]', ...args);

function fail(status: number, message: string, detail?: string) {
  log(`${status}: ${message}${detail ? ` — ${detail}` : ''}`);
  return NextResponse.json({ error: message, ...(isDev && detail ? { detail } : {}) }, { status });
}

export async function POST(req: Request) {
  let body: { sheet?: TenderSheet; fileName?: string };
  try {
    body = await req.json();
  } catch (err) {
    return fail(400, 'Could not read the request body.', (err as Error).message);
  }

  const sheet = body?.sheet;
  if (!sheet?.template?.sections?.length) {
    return fail(400, 'No tender sheet to export.', 'body.sheet.template.sections was empty or missing');
  }
  if (!sheet.template.suppliers?.length) {
    return fail(400, 'The tender sheet has no supplier columns to compare.');
  }

  try {
    const buffer = await tenderWorkbookBuffer({ ...sheet, answers: sheet.answers ?? {} });
    const safe = (body.fileName || `tender-comparative-${sheet.template.prNumber ?? 'sheet'}`)
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safe || 'tender-sheet'}.xlsx"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return fail(500, 'Could not build the tender sheet.', (err as Error).stack ?? (err as Error).message);
  }
}
