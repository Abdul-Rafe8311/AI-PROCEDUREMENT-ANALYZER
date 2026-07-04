import { NextResponse } from 'next/server';
import { assembleAnalysis } from '@/lib/analysis-engine';
import { extractQuotations } from '@/lib/extraction-server';
import type { ExtractedQuotation } from '@/lib/workspace-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args: unknown[]) => console.error('[api/extract]', ...args);

// Clean user-facing message + logged technical reason; `detail` only in dev.
function fail(status: number, message: string, detail?: string) {
  log(`${status}: ${message}${detail ? ` — ${detail}` : ''}`);
  return NextResponse.json(
    { error: message, ...(isDev && detail ? { detail } : {}) },
    { status },
  );
}

// POST /api/extract  (multipart/form-data, field "files")
// Parses each uploaded document's REAL text, runs LLM structured extraction,
// and returns an AnalysisResult built from the actual document contents.
// Never substitutes sample data — returns a clear, specific error on failure.
export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return fail(400, 'Upload must be multipart/form-data.', `got content-type: "${contentType}"`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return fail(400, 'Could not read the uploaded form data.', (err as Error).message);
  }

  const entries = form.getAll('files');
  if (entries.length === 0) {
    return fail(
      400,
      'No file received.',
      `form fields present: [${[...form.keys()].join(', ') || 'none'}] — expected field "files"`,
    );
  }

  // Accept anything Blob-like (works whether the runtime exposes File or not).
  const files = entries.filter(
    (e): e is File =>
      typeof e === 'object' && e !== null && typeof (e as Blob).arrayBuffer === 'function',
  );
  if (files.length === 0) {
    return fail(
      400,
      'No valid file in the upload.',
      `"files" entries were not file-like: [${entries.map((e) => typeof e).join(', ')}]`,
    );
  }

  try {
    const quotations: ExtractedQuotation[] = [];
    const debug: Record<string, unknown>[] = [];
    const reasons: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = (file as File).name || `upload-${i + 1}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      // One file can yield MULTIPLE suppliers (a side-by-side comparison sheet).
      const { quotations: fileQuotations, textLength, method, error } = await extractQuotations(
        buffer,
        name,
        file.type,
        i,
      );
      if (error) reasons.push(`${name}: ${error}`);
      for (const quotation of fileQuotations) {
        quotations.push(quotation);
        debug.push({
          fileName: fileQuotations.length > 1 ? `${name} (${quotation.supplierName})` : name,
          method,
          textLength,
          supplier: quotation.supplierName,
          currency: quotation.currency,
          currencyConfidence: quotation.currencyConfidence,
          total: quotation.totalCost,
          delivery: [quotation.deliveryRaw, quotation.deliveryTerms].filter(Boolean).join(' · ') || null,
          payment: quotation.paymentTerms,
          warranty: quotation.warranty,
          lineItems: quotation.lineItems.length,
          ...(isDev && error ? { error } : {}),
        });
      }
    }

    const anyReadable = quotations.some((q) => q.totalCost != null || q.lineItems.length > 0);
    if (!anyReadable) {
      // Surface the most specific reason we collected.
      const detail = reasons.join(' | ') || 'extraction produced no usable fields';
      log(`422: extraction yielded no data — ${detail}`);
      return NextResponse.json(
        {
          error:
            reasons[0] ??
            'Could not extract data from the uploaded file(s). Try a text-based PDF or DOCX.',
          debug,
          ...(isDev ? { detail } : {}),
        },
        { status: 422 },
      );
    }

    if (reasons.length) log(`partial extraction warnings: ${reasons.join(' | ')}`);
    const analysis = assembleAnalysis(quotations, false);
    return NextResponse.json({ ...analysis, debug });
  } catch (err) {
    return fail(500, 'Extraction failed unexpectedly.', (err as Error).stack ?? (err as Error).message);
  }
}
