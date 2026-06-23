import { NextResponse } from 'next/server';
import { assembleAnalysis } from '@/lib/analysis-engine';
import { extractQuotation } from '@/lib/extraction-server';
import type { ExtractedQuotation } from '@/lib/workspace-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/extract  (multipart/form-data, field "files")
// Parses each uploaded document's REAL text, runs LLM structured extraction,
// and returns an AnalysisResult built from the actual document contents.
// On failure it returns a clear error — it never substitutes sample data.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form-data with files.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: 'No files were uploaded.' }, { status: 400 });
  }

  try {
    const quotations: ExtractedQuotation[] = [];
    const debug: {
      fileName: string;
      method: string;
      textLength: number;
      supplier: string;
      currency: string;
      currencyConfidence: number;
      total: number | null;
      delivery: string | null;
      payment: string | null;
      warranty: string | null;
      lineItems: number;
    }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const { quotation, textLength, method } = await extractQuotation(
        buffer,
        file.name,
        file.type,
        i,
      );
      quotations.push(quotation);
      debug.push({
        fileName: file.name,
        method,
        textLength,
        supplier: quotation.supplierName,
        currency: quotation.currency,
        currencyConfidence: quotation.currencyConfidence,
        total: quotation.totalCost,
        delivery: quotation.deliveryRaw,
        payment: quotation.paymentTerms,
        warranty: quotation.warranty,
        lineItems: quotation.lineItems.length,
      });
    }

    // If nothing readable was extracted from any file, surface a clear error.
    const anyReadable = quotations.some(
      (q) => q.totalCost != null || q.lineItems.length > 0,
    );
    if (!anyReadable) {
      return NextResponse.json(
        {
          error:
            'Could not extract data from the uploaded file(s). They may be scanned images or empty PDFs. Try a text-based PDF or DOCX.',
          debug,
        },
        { status: 422 },
      );
    }

    const analysis = assembleAnalysis(quotations, false);
    return NextResponse.json({ ...analysis, debug });
  } catch (err) {
    return NextResponse.json(
      { error: `Extraction failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
