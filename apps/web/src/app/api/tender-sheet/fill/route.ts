import { NextResponse } from 'next/server';
import { answersFromExtraction, extractTenderAnswersForSupplier } from '@/lib/tender-sheet/extract';
import type { TenderTemplate } from '@/lib/tender-sheet/types';
import type { ExtractedQuotation } from '@/lib/workspace-types';

// POST /api/tender-sheet/fill
// Reads ONE supplier's column from the quotation text captured at extraction time
// and returns the answers for it. Per-supplier rather than per-sheet so a slow or
// failing supplier cannot take the whole run down, and so the UI can show
// progress across a nine-column sheet.
//
// The Anthropic key is server-side only, which is why this is a route and not a
// direct call from the client.

export const runtime = 'nodejs';
export const maxDuration = 60;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args: unknown[]) => console.error('[api/tender-sheet/fill]', ...args);

function fail(status: number, message: string, detail?: string) {
  log(`${status}: ${message}${detail ? ` — ${detail}` : ''}`);
  return NextResponse.json({ error: message, ...(isDev && detail ? { detail } : {}) }, { status });
}

export async function POST(req: Request) {
  let body: { template?: TenderTemplate; quotation?: ExtractedQuotation };
  try {
    body = await req.json();
  } catch (err) {
    return fail(400, 'Could not read the request body.', (err as Error).message);
  }
  const { template, quotation } = body;
  if (!template?.sections?.length) return fail(400, 'No tender template supplied.');
  if (!quotation?.id) return fail(400, 'No supplier quotation supplied.');

  const text = quotation.sourceText ?? '';
  if (!text.trim()) {
    // Honest, not an error: a scanned quotation read by vision has no text layer,
    // so there is nothing to read the technical detail out of.
    return NextResponse.json({ answers: {}, reason: 'no-text' });
  }

  try {
    const result = await extractTenderAnswersForSupplier(template, quotation, text);
    if (!result) return NextResponse.json({ answers: {}, reason: 'no-result' });
    return NextResponse.json({ answers: answersFromExtraction(template, quotation.id, result) });
  } catch (err) {
    return fail(500, `Could not read ${quotation.supplierName}'s quotation.`, (err as Error).message);
  }
}
