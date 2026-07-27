// Fills a Tender Comparative Sheet from the supplier quotations already parsed
// for this PR. ADDITIVE: it reads, and never touches, the extraction/scoring
// pipeline or the TA form.
//
// ── Where the text comes from ────────────────────────────────────────────────
// The sheet asks for things the structured quotation does NOT carry: chemical
// analysis tables, bulk density, refractoriness, thermal conductivity. Those live
// in the document body, and `ExtractedQuotation` keeps only the commercial fields
// and line items. So this module is a PURE function of (template, quotation,
// documentText) -> answers, and the CALLER supplies the text it already holds for
// that document. Nothing here re-uploads or re-parses a PDF, and the seam is what
// makes the pass testable without a network call.
//
// Everything it produces is `source: 'ai'`, so mergeAiAnswers folds it in without
// disturbing a reviewer's edits.

import { isAnthropicConfigured } from '../anthropic';
import { callLLM, isGroqConfigured } from '../llm-provider';
import type { ExtractedQuotation } from '../workspace-types';
import type { TenderAnswers, TenderTemplate } from './types';
import { answerKey } from './types';

/** What we ask the model for, per supplier. Missing values must come back null. */
export interface TenderExtractionResult {
  items: {
    itemNo: number;
    productName: string | null;
    description: string | null;
    chemical: { name: string; value: string | null }[];
    physical: { name: string; value: string | null }[];
    thermal: { name: string; value: string | null }[];
  }[];
  commercial: Record<string, string | null>;
}

/** Parse a JSON body, tolerating the ```json fences a model sometimes adds. */
function looseJson<T>(content: string): T | null {
  const raw = String(content ?? '').trim();
  const body = /```/.test(raw) ? raw.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/```[\s\S]*$/, '') : raw;
  const start = body.search(/[{[]/);
  if (start < 0) return null;
  try {
    return JSON.parse(body.slice(start)) as T;
  } catch {
    return null;
  }
}

const SYSTEM = [
  'You read ONE supplier quotation for a refractory tender and return the values a',
  "buyer's comparative sheet asks for. Return ONLY valid JSON, no prose.",
  '',
  '{ "items": [ { "itemNo": number,',
  '              "productName": string|null,   // the supplier\'s own product/brand name for this PR item',
  '              "description": string|null,   // ONE short line describing it, in the supplier\'s words',
  '              "chemical":  [{ "name": string, "value": string|null }],',
  '              "physical":  [{ "name": string, "value": string|null }],',
  '              "thermal":   [{ "name": string, "value": string|null }] } ],',
  '  "commercial": { "<criterion>": string|null } }',
  '',
  'RULES',
  '- Use ONLY what the document states. If a value is not in the document, return',
  '  null for it. NEVER estimate, infer from a similar product, or carry a value',
  '  across from another item. A wrong number here goes straight onto a sheet a',
  '  buyer signs.',
  '- Return the value with its unit exactly as written ("95% min", "2.85 g/cm3",',
  '  "1750 C"). Do not convert units and do not reformat numbers.',
  '- Answer for EVERY itemNo you are given, in that order, even when the whole item',
  '  is absent from this quotation — then every value is null.',
  '- Return exactly the chemical/physical/thermal parameter NAMES you are given for',
  '  each item, in the same order. Do not add, drop or rename them.',
  '- For "commercial", answer each criterion name given. Free text, as stated.',
].join('\n');

/** The per-item question set, straight from the template. */
function itemQuestions(template: TenderTemplate) {
  const sec = (id: string) => template.sections.find((s) => s.id === id);
  const chem = sec('chemical');
  const phys = sec('physical');
  const therm = sec('thermal');
  const specs = sec('specs');
  const itemNos = (specs?.items ?? chem?.items ?? []).map((i) => i.itemNo);
  return itemNos.map((itemNo) => ({
    itemNo,
    requiredSpec: specs?.items?.find((i) => i.itemNo === itemNo)?.requiredSpec ?? null,
    chemical: chem?.items?.find((i) => i.itemNo === itemNo)?.parameters.map((p) => p.name) ?? [],
    physical: phys?.items?.find((i) => i.itemNo === itemNo)?.parameters.map((p) => p.name) ?? [],
    thermal: therm?.items?.find((i) => i.itemNo === itemNo)?.parameters.map((p) => p.name) ?? [],
  }));
}

const commercialCriteria = (t: TenderTemplate) =>
  t.sections.filter((s) => s.type === 'single_row').map((s) => s.title);

/** Ask the model for one supplier's column. Returns null when nothing usable came back. */
export async function extractTenderAnswersForSupplier(
  template: TenderTemplate,
  quotation: ExtractedQuotation,
  documentText: string,
): Promise<TenderExtractionResult | null> {
  // Either provider can serve this; bail only when neither is configured.
  if ((!isAnthropicConfigured() && !isGroqConfigured()) || !documentText.trim()) return null;
  const questions = itemQuestions(template);
  const instruction = [
    `Supplier: ${quotation.supplierName}`,
    '',
    'Answer for these PR items (match them to the supplier\'s own products by description):',
    ...questions.map(
      (q) =>
        `  item ${q.itemNo}: ${q.requiredSpec ?? '(no spec given)'}\n` +
        `     chemical: ${q.chemical.join(', ') || '(none)'}\n` +
        `     physical: ${q.physical.join(', ') || '(none)'}\n` +
        `     thermal:  ${q.thermal.join(', ') || '(none)'}`,
    ),
    '',
    `Commercial criteria: ${commercialCriteria(template).join(' | ')}`,
    '',
    'QUOTATION DOCUMENT:',
    documentText,
  ].join('\n');

  // The provider was decided ONCE for this document at upload (document-router)
  // and travels on the quotation, so the sheet reads it the same way the TA form
  // extraction did. A quotation extracted BEFORE routing existed carries no route
  // — such a document must default to Claude, never silently land on Groq.
  const provider = quotation.route?.provider ?? 'claude';
  const usable = provider === 'groq' && isGroqConfigured() ? 'groq' : 'claude';
  const { content } = await callLLM({ system: SYSTEM, user: instruction }, usable);
  const parsed = looseJson<TenderExtractionResult>(content);
  return parsed && Array.isArray(parsed.items) ? parsed : null;
}

/** Fold one supplier's extraction into sheet answers, all marked `ai`. */
export function answersFromExtraction(
  template: TenderTemplate,
  supplierId: string,
  result: TenderExtractionResult,
): TenderAnswers {
  const out: TenderAnswers = {};
  const put = (sectionId: string, itemNo: number | null, param: string | null, value: string | null) => {
    const v = (value ?? '').trim();
    if (!v) return; // a null stays an EMPTY cell — never a fabricated one
    out[answerKey(sectionId, itemNo, param, supplierId)] = { value: v, source: 'ai', aiValue: v };
  };
  const pairs = (list: { name: string; value: string | null }[]) =>
    list.map((p) => `${p.name} → ${p.value?.trim() || 'N/A'}`).join('\n');

  const has = (id: string) => template.sections.some((s) => s.id === id);
  for (const item of result.items ?? []) {
    if (has('specs')) {
      const name = (item.productName ?? '').trim();
      const desc = (item.description ?? '').trim();
      put('specs', item.itemNo, null, [name, desc].filter(Boolean).join('\n'));
    }
    // A pairs cell is only worth printing when the supplier actually stated
    // something; an all-null block would be a column of "N/A" pretending to be data.
    if (has('chemical') && (item.chemical ?? []).some((p) => p.value?.trim())) {
      put('chemical', item.itemNo, null, pairs(item.chemical));
    }
    for (const [sectionId, list] of [['physical', item.physical], ['thermal', item.thermal]] as const) {
      if (!has(sectionId)) continue;
      for (const p of list ?? []) put(sectionId, item.itemNo, p.name, p.value);
    }
  }
  for (const s of template.sections) {
    if (s.type !== 'single_row') continue;
    put(s.id, null, null, result.commercial?.[s.title] ?? null);
  }
  return out;
}

/**
 * Commercial answers we already hold in the parsed quotation — free, no LLM, and
 * they are the fields the extraction pipeline has already validated. Used as a
 * floor so those rows are populated even when the AI pass is unavailable.
 */
export function commercialAnswersFromQuotation(
  template: TenderTemplate,
  q: ExtractedQuotation,
): TenderAnswers {
  const known: Record<string, string | null | undefined> = {
    'Delivery Time': q.deliveryRaw ?? q.deliveryTerms,
    Warranty: q.warranty,
    'Country of Origin': q.countryOfOrigin,
  };
  const out: TenderAnswers = {};
  for (const s of template.sections) {
    if (s.type !== 'single_row') continue;
    const v = (known[s.title] ?? '').toString().trim();
    if (v) out[answerKey(s.id, null, null, q.id)] = { value: v, source: 'ai', aiValue: v };
  }
  return out;
}
