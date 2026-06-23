// Server-only real extraction: parse uploaded file text, detect currency, and
// use an LLM (Groq, OpenAI-compatible) to extract structured quotation data.
// Returns ACTUAL values from the document — no sample/placeholder data here.

import {
  getUsdRate,
  normalizeDelivery,
  toUsd,
} from './analysis-engine';
import type {
  ExtractedQuotation,
  FieldKey,
  FieldProvenance,
  LineItem,
} from './workspace-types';

export interface ExtractionResult {
  quotation: ExtractedQuotation;
  /** raw text length parsed — 0 means the file couldn't be read */
  textLength: number;
  /** how extraction was performed, for the debug panel */
  method: 'llm' | 'heuristic' | 'unreadable';
}

const SUPPORTED_CURRENCIES = ['SAR', 'AED', 'USD', 'EUR', 'GBP', 'QAR', 'KWD'] as const;

// ── Text extraction per file type ──
export async function extractText(
  buffer: Buffer,
  fileName: string,
  mime: string,
): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (ext === 'pdf' || mime === 'application/pdf') {
      const { extractText: extractPdf, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(doc, { mergePages: true });
      return text ?? '';
    }
    if (
      ext === 'docx' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
      const { value } = await mammoth.extractRawText({ buffer });
      return value ?? '';
    }
    // Images (png/jpg) would need OCR — not handled server-side yet.
    if (['png', 'jpg', 'jpeg'].includes(ext) || mime.startsWith('image/')) {
      return '';
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

// ── Currency detection from raw text ──
export function detectCurrency(text: string): { currency: string; confidence: number } {
  const t = text.toLowerCase();
  const checks: { currency: string; re: RegExp; conf: number }[] = [
    { currency: 'SAR', re: /\bsar\b|saudi\s*riyal|﷼|ر\.?س/i, conf: 0.99 },
    { currency: 'AED', re: /\baed\b|dirham|د\.?إ/i, conf: 0.98 },
    { currency: 'QAR', re: /\bqar\b|qatari\s*riyal/i, conf: 0.97 },
    { currency: 'KWD', re: /\bkwd\b|kuwaiti\s*dinar/i, conf: 0.97 },
    { currency: 'GBP', re: /\bgbp\b|pound\s*sterling|£/i, conf: 0.95 },
    { currency: 'EUR', re: /\beur\b|euro|€/i, conf: 0.95 },
    { currency: 'USD', re: /\busd\b|us\$|dollar|\$/i, conf: 0.8 },
  ];
  for (const c of checks) {
    if (c.re.test(t)) return { currency: c.currency, confidence: c.conf };
  }
  return { currency: 'USD', confidence: 0.2 }; // unknown — low confidence, never assumed silently
}

interface LlmQuotation {
  supplierName: string | null;
  currency: string | null;
  totalAmount: number | null;
  deliveryTime: string | null;
  paymentTerms: string | null;
  warranty: string | null;
  validUntil: string | null;
  lineItems: { name: string; quantity: number | null; unitPrice: number | null; totalPrice: number | null }[];
}

// ── LLM structured extraction (Groq preferred, OpenAI fallback) ──
async function llmExtract(text: string): Promise<LlmQuotation | null> {
  const provider = resolveProvider();
  if (!provider) return null;

  const system = [
    'You extract structured data from a single supplier quotation document.',
    'Return ONLY valid JSON matching this TypeScript type, no prose:',
    '{ supplierName: string|null, currency: string|null (ISO code e.g. SAR, USD, AED, EUR, GBP),',
    '  totalAmount: number|null, deliveryTime: string|null, paymentTerms: string|null,',
    '  warranty: string|null, validUntil: string|null (ISO date),',
    '  lineItems: { name: string, quantity: number|null, unitPrice: number|null, totalPrice: number|null }[] }',
    'Rules: use ONLY values present in the document. Detect the currency from the text',
    '(e.g. "SAR", "Saudi Riyal", "﷼"). Never convert currencies. Numbers must be plain',
    '(no thousands separators or symbols). If a field is absent, use null. Extract EVERY',
    'line item you find with its real name, quantity, unit price and line total.',
  ].join('\n');

  try {
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `DOCUMENT TEXT:\n${text.slice(0, 12000)}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as LlmQuotation;
  } catch {
    return null;
  }
}

function resolveProvider() {
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    return {
      apiKey: groq,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    };
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    return {
      apiKey: openai,
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  return null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function fieldProv(snippet: string | null, confidence: number, page = 1): FieldProvenance {
  return snippet ? { snippet, page, confidence } : { snippet: null, confidence: 0 };
}

// ── Map raw text + LLM result to an ExtractedQuotation ──
export async function extractQuotation(
  buffer: Buffer,
  fileName: string,
  mime: string,
  index: number,
): Promise<ExtractionResult> {
  const text = await extractText(buffer, fileName, mime);
  const id = `q_${index}`;

  if (!text.trim()) {
    return { quotation: emptyQuotation(id, fileName), textLength: 0, method: 'unreadable' };
  }

  const detected = detectCurrency(text);
  const llm = await llmExtract(text);
  const method: ExtractionResult['method'] = llm ? 'llm' : 'heuristic';

  // Currency: trust the document text detection; fall back to LLM's guess.
  const currency = (detected.confidence >= 0.9 ? detected.currency : llm?.currency || detected.currency).toUpperCase();
  const usdRate = getUsdRate(currency);

  const totalCost = num(llm?.totalAmount);
  const deliveryRaw = llm?.deliveryTime ?? null;
  const lineItems: LineItem[] = (llm?.lineItems ?? []).map((li) => ({
    name: String(li.name ?? 'Item').trim(),
    quantity: num(li.quantity),
    unitPrice: num(li.unitPrice),
    totalPrice: num(li.totalPrice),
    currency,
  }));

  const fields: Record<FieldKey, FieldProvenance> = {
    supplierName: fieldProv(llm?.supplierName ?? null, llm?.supplierName ? 0.9 : 0),
    totalCost: fieldProv(
      totalCost != null ? `Total: ${totalCost.toLocaleString('en-US')} ${currency}` : null,
      totalCost != null ? 0.9 : 0,
    ),
    deliveryDays: fieldProv(deliveryRaw ? `Delivery: ${deliveryRaw}` : null, deliveryRaw ? 0.8 : 0),
    paymentTerms: fieldProv(llm?.paymentTerms ?? null, llm?.paymentTerms ? 0.85 : 0),
    warranty: fieldProv(llm?.warranty ?? null, llm?.warranty ? 0.8 : 0),
  };

  const quotation: ExtractedQuotation = {
    id,
    fileName,
    supplierName: llm?.supplierName?.trim() || fileNameToSupplier(fileName),
    totalCost,
    currency,
    totalCostUsd: toUsd(totalCost, currency),
    deliveryRaw,
    deliveryDays: normalizeDelivery(deliveryRaw),
    paymentTerms: llm?.paymentTerms ?? null,
    warranty: llm?.warranty ?? null,
    validUntil: llm?.validUntil ?? null,
    currencyConfidence: detected.confidence,
    usdRate,
    lineItems,
    fields,
  };

  return { quotation, textLength: text.length, method };
}

function fileNameToSupplier(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown Supplier';
}

function emptyQuotation(id: string, fileName: string): ExtractedQuotation {
  const empty = (): FieldProvenance => ({ snippet: null, confidence: 0 });
  return {
    id,
    fileName,
    supplierName: fileNameToSupplier(fileName),
    totalCost: null,
    currency: 'USD',
    totalCostUsd: null,
    deliveryRaw: null,
    deliveryDays: null,
    paymentTerms: null,
    warranty: null,
    validUntil: null,
    currencyConfidence: 0,
    usdRate: 1,
    lineItems: [],
    fields: {
      supplierName: empty(),
      totalCost: empty(),
      deliveryDays: empty(),
      paymentTerms: empty(),
      warranty: empty(),
    },
  };
}

export { SUPPORTED_CURRENCIES };
