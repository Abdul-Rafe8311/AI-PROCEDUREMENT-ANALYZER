import { NextResponse } from 'next/server';
import { buildAnalysis } from '@/lib/analysis-engine';

export const runtime = 'nodejs';

// POST /api/extract
// Body: { files: string[] }  (file names)
// Returns: AnalysisResult
//
// MVP: produces a deterministic, realistic comparison from the file names.
// Swap in real PDF/DOCX/OCR extraction here (or proxy to the NestJS pipeline)
// without changing the client — the response shape stays the same.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { files?: unknown };
    const files = Array.isArray(body.files)
      ? body.files.filter((f): f is string => typeof f === 'string')
      : [];

    const analysis = buildAnalysis(files);
    return NextResponse.json(analysis);
  } catch {
    return NextResponse.json({ error: 'Failed to analyze quotations.' }, { status: 500 });
  }
}
