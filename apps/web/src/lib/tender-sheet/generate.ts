'use client';

// Builds a Tender Comparative Sheet end to end: seed the template from the PR,
// then fill each supplier's column from the quotation text captured at extraction
// time (ExtractedQuotation.sourceText) — no re-upload, no PDF re-parse.
//
// Regenerating is SAFE to run repeatedly: mergeAiAnswers keeps every cell a human
// edited and refreshes only the AI ones, so a reviewer's work survives.

import type { AnalysisResult } from '../workspace-types';
import { commercialAnswersFromQuotation } from './extract';
import { seedTenderTemplate } from './seed';
import { mergeAiAnswers, type TenderAnswers, type TenderSheet } from './types';

export interface GenerateProgress {
  supplier: string;
  done: number;
  total: number;
}

/**
 * @param existing a sheet already on screen — its template and any `user` edits
 *                 are preserved; only the AI answers are refreshed.
 */
export async function generateTenderSheet(
  analysisId: string,
  analysis: AnalysisResult,
  existing?: TenderSheet | null,
  onProgress?: (p: GenerateProgress) => void,
): Promise<{ sheet: TenderSheet; filled: number; withoutText: string[] }> {
  const pr = analysis.purchaseRequisition;
  if (!pr?.items.length) throw new Error('A company Purchase Requisition is needed to build the tender sheet.');

  const template = existing?.template ?? seedTenderTemplate(analysisId, pr, analysis.quotations);
  let answers = existing?.answers ?? {};
  const withoutText: string[] = [];
  let filled = 0;

  for (const [i, q] of analysis.quotations.entries()) {
    onProgress?.({ supplier: q.supplierName, done: i, total: analysis.quotations.length });
    // Commercial rows come from fields the pipeline already validated — free.
    answers = mergeAiAnswers(answers, commercialAnswersFromQuotation(template, q));

    const text = q.sourceText ?? '';
    if (!text.trim()) {
      // A scanned quotation read by vision has no text layer. Say so rather than
      // leaving the reviewer wondering why that column is thin.
      withoutText.push(q.supplierName);
      continue;
    }
    try {
      // The Anthropic key is server-side only, so the read happens in a route.
      const res = await fetch('/api/tender-sheet/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, quotation: q }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const { answers: next } = (await res.json()) as { answers: TenderAnswers };
      if (next && Object.keys(next).length) {
        filled += Object.keys(next).length;
        answers = mergeAiAnswers(answers, next);
      }
    } catch (err) {
      // One supplier failing must never lose the others' work.
      // eslint-disable-next-line no-console
      console.error(`[tender-sheet] fill failed for ${q.supplierName}`, err);
      withoutText.push(`${q.supplierName} (read failed)`);
    }
  }
  onProgress?.({ supplier: '', done: analysis.quotations.length, total: analysis.quotations.length });
  return { sheet: { template, answers }, filled, withoutText };
}
