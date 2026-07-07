// Server-only real extraction: parse uploaded file text, detect currency, and
// use an LLM (Groq, OpenAI-compatible) to extract structured quotation data.
// Returns ACTUAL values from the document — no sample/placeholder data here.

import {
  getUsdRate,
  normalizeDelivery,
  toUsd,
} from './analysis-engine';
import {
  extractJsonFromMedia,
  isAnthropicConfigured,
  type ImageMediaType,
  type VisionMedia,
} from './anthropic';
import type {
  ExtractedQuotation,
  FieldKey,
  FieldProvenance,
  LineItem,
  LineItemCategory,
  PrItem,
  PurchaseRequisition,
  StatedTotal,
} from './workspace-types';

export interface FileExtraction {
  /** one quotation per supplier found in the file (≥1 — a comparison sheet yields many) */
  quotations: ExtractedQuotation[];
  /** raw text length parsed — 0 means the file couldn't be read */
  textLength: number;
  /** how extraction was performed, for the debug panel ('vision' = read from a scan/photo) */
  method: 'llm' | 'heuristic' | 'unreadable' | 'vision';
  /** technical failure reason (null on success) — logged + shown in dev */
  error: string | null;
}

const log = (...args: unknown[]) => console.error('[extract]', ...args);

const SUPPORTED_CURRENCIES = ['SAR', 'AED', 'USD', 'EUR', 'GBP', 'QAR', 'KWD'] as const;

// ── Text extraction per file type ──
export async function extractText(
  buffer: Buffer,
  fileName: string,
  mime: string,
): Promise<{ text: string; error: string | null }> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (ext === 'pdf' || mime === 'application/pdf') {
      const { extractText: extractPdf, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(doc, { mergePages: true });
      const t = text ?? '';
      return {
        text: t,
        error: t.trim() ? null : 'PDF parsed but contained no text (likely a scanned/image PDF — needs OCR).',
      };
    }
    if (
      ext === 'docx' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
      const { value } = await mammoth.extractRawText({ buffer });
      return { text: value ?? '', error: value?.trim() ? null : 'DOCX contained no text.' };
    }
    if (['png', 'jpg', 'jpeg'].includes(ext) || mime.startsWith('image/')) {
      // No text layer in an image — read it downstream with Claude vision.
      return { text: '', error: null };
    }
    return { text: buffer.toString('utf8'), error: null };
  } catch (err) {
    const msg = `Text extraction failed for "${fileName}" (${ext}): ${(err as Error).message}`;
    log(msg);
    return { text: '', error: msg };
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

interface LlmLineItem {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  /** product | freight | shipping | insurance | handling | other */
  category?: string | null;
  /** unit of measure, e.g. SET, PCS, KG, EA */
  uom?: string | null;
}

export interface LlmSupplier {
  supplierName: string | null;
  /** this supplier's quotation / reference number, if stated */
  reference: string | null;
  /** form-level purchase-requisition (PR) number, if stated on the document */
  prNumber?: string | null;
  currency: string | null;
  /** FULL payable grand total (incl. freight & all charges) in `currency` */
  totalAmount: number | null;
  /** every grand total as stated, each with its currency (multi-currency docs) */
  totalsByCurrency: { amount: number | null; currency: string | null }[] | null;
  /** lead time / delivery duration text, e.g. "60 days" */
  deliveryTime: string | null;
  /** incoterms / delivery terms, e.g. "CFR Jeddah", "CIF Jeddah", "EXW" */
  deliveryTerms: string | null;
  paymentTerms: string | null;
  warranty: string | null;
  validUntil: string | null;
  lineItems: LlmLineItem[];
}

/** One document can compare several suppliers side by side → an array. */
interface LlmResult {
  suppliers: LlmSupplier[];
}

// Build the text sent to the extraction LLM. Sends the whole document when it
// fits; for long documents, keeps the head (supplier/currency/totals/terms) AND
// every window that looks like a goods/pricing schedule — wherever it appears —
// so item tables deep in the document (Schedule A/B, Annex, BoQ…) are never lost.
const EXTRACTION_CHAR_BUDGET = 48000; // ~12k tokens — safe for large contexts
const HEAD_CHARS = 16000;
const WINDOW = 2500;
const SCHEDULE_RE =
  /schedule\s+[a-z0-9]|\bannex\b|\bappendix\b|bill of quantit|description of goods|scope of supply|unit price|unit rate|\bqty\b|quantit|line total|\bitem\s*(no|#|description)/gi;

export function buildExtractionInput(text: string): string {
  if (text.length <= EXTRACTION_CHAR_BUDGET) return text;

  const head = text.slice(0, HEAD_CHARS);
  let budget = EXTRACTION_CHAR_BUDGET - HEAD_CHARS;

  // Collect non-overlapping windows around schedule/pricing keywords (past head).
  const ranges: [number, number][] = [];
  SCHEDULE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCHEDULE_RE.exec(text)) && budget > 0) {
    const start = Math.max(HEAD_CHARS, m.index - WINDOW);
    const end = Math.min(text.length, m.index + WINDOW);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end); // merge overlapping
    } else {
      ranges.push([start, end]);
      budget -= end - start;
    }
  }

  const windows = ranges.map(([s, e]) => text.slice(s, e)).join('\n…\n');
  return windows ? `${head}\n…\n${windows}` : head;
}

// Accept whatever JSON shape the model returns and coerce to a supplier array:
// `{ suppliers: [...] }`, a bare array, or a single supplier object.
function normalizeSuppliers(parsed: unknown): LlmSupplier[] {
  const asArray = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { suppliers?: unknown }).suppliers)
      ? (parsed as { suppliers: unknown[] }).suppliers
      : parsed && typeof parsed === 'object'
        ? [parsed] // single-supplier object → array of one
        : [];
  return asArray.filter((s): s is LlmSupplier => !!s && typeof s === 'object');
}

// Shared structured-extraction schema + rules. Used by BOTH the text path
// (Groq) and the scanned/image vision path (Claude) so the output shape and
// business rules (freight in total, multi-supplier, currency-per-amount) are
// identical regardless of how the document was read.
const EXTRACTION_SYSTEM_PROMPT = [
  'You extract structured data from a procurement document. It may be a SINGLE',
  'supplier quotation, OR a comparison sheet with MULTIPLE suppliers side by side',
  '(e.g. columns "Supplier 1", "Supplier 2", or separate sections). Return ONLY',
  'valid JSON matching this TypeScript type, no prose:',
  '{ suppliers: {',
  '    supplierName: string|null, reference: string|null, prNumber: string|null,',
  '    currency: string|null (ISO code e.g. SAR, USD, AED, EUR, GBP),',
  '    totalAmount: number|null,   // FULL payable grand total INCLUDING freight & all charges',
  '    totalsByCurrency: { amount: number, currency: string }[]|null,',
  '    deliveryTime: string|null, deliveryTerms: string|null,',
  '    paymentTerms: string|null, warranty: string|null, validUntil: string|null (ISO date),',
  '    lineItems: { name: string, quantity: number|null, unitPrice: number|null,',
  '                 totalPrice: number|null, category: string|null, uom: string|null }[]',
  '  }[] }',
  '',
  'MULTIPLE SUPPLIERS: return ONE object per supplier that has ANY data (a name,',
  'prices, or a total). IGNORE empty supplier columns/slots. If it is a single',
  'quotation, return an array with exactly one supplier. Each supplier keeps its',
  'OWN reference no., line items, freight, totals, currency and terms.',
  '',
  'Rules: use ONLY values present in the document. Never convert currencies or',
  'invent numbers. Numbers must be plain (no thousands separators or symbols). If a',
  'field is absent, use null.',
  '',
  'CURRENCY PER AMOUNT: detect EACH supplier\'s currency from the text ("SAR",',
  '"Saudi Riyal", "﷼", "USD", "$"). If a total is stated in MORE THAN ONE currency',
  '(e.g. a USD row AND a SAR row), set `currency` + `totalAmount` to the primary /',
  'contract currency, and list EVERY stated grand total in `totalsByCurrency` with',
  'its own currency. Do NOT just grab the first number you see.',
  '',
  'ALL COST LINES: lineItems must include EVERY cost line — product/goods lines AND',
  'charge lines: freight, sea/air freight, shipping, insurance, handling, customs.',
  'Set `category` to "product" for goods, or "freight"/"shipping"/"insurance"/',
  '"handling"/"other" for a charge. For a lump-sum charge (e.g. "Sea freight 300"),',
  'put the amount in totalPrice. `totalAmount` MUST include these charges — it is',
  'the final amount the buyer actually pays.',
  '',
  'DELIVERY: deliveryTime = the lead time / duration (e.g. "60 days"). deliveryTerms',
  '= the incoterms exactly as written (e.g. "CFR Jeddah", "CIF Jeddah", "EXW").',
  '',
  'PR NUMBER: prNumber = the purchase-requisition / PR number if the document shows',
  'one (a form-level header field like "PR#", "PR No", "Requisition No", "PR Description"',
  'section). It is shared by all suppliers on the same form — copy it to each. Null if absent.',
  'UOM: for each line item, uom = the unit of measure exactly as written (e.g. "SET",',
  '"PCS", "KG", "EA", "M", "NO") if a units column is present; otherwise null.',
  '',
  'LINE ITEMS — scan the ENTIRE document, not just the top. The goods/pricing',
  'list may appear ANYWHERE and under ANY heading: "Schedule A", "Schedule B",',
  '"Annex", "Appendix", "Bill of Quantities", "Description of Goods", "Scope of',
  'Supply", an items/qty/unit-price table, etc. Extract EVERY item you find.',
  'If quantities and prices are in SEPARATE tables/schedules (e.g. Schedule A has',
  'item + quantity, Schedule B has item + unit price), MATCH them by item',
  'description and MERGE into a single line item carrying both quantity and price.',
  'Preserve each item\'s real description (e.g. "Reinforcement Bars 12mm").',
].join('\n');

// Extra guidance for scanned/photographed documents read via vision.
const SCAN_NOTE = [
  'This document is a SCANNED or PHOTOGRAPHED page (or several pages) — there is no',
  'digital text layer, so read the values directly from the page image(s). Read',
  'tables, stamps and handwriting where legible, and transcribe numbers EXACTLY.',
  'If a value is genuinely illegible, use null rather than guessing. A single',
  'scanned form may still compare MULTIPLE suppliers side by side — capture each one.',
  'ALWAYS capture each supplier\'s real COMPANY / SUPPLIER NAME (from the column',
  'header, letterhead, stamp, signature block, or an "M/s <name>" line) into',
  'supplierName. Do NOT use the file name. Only leave supplierName null if no',
  'company name appears anywhere for that supplier.',
].join('\n');

// ── Raw structured-extraction call (Groq preferred, OpenAI fallback) ──
// Sends a system prompt + user content and returns the model's raw JSON text.
// Shared by supplier-quotation and purchase-requisition extraction so both use
// the same provider, JSON-mode, and error handling.
async function callExtractionLlm(
  system: string,
  userContent: string,
): Promise<{ content: string | null; error: string | null }> {
  const provider = resolveProvider();
  if (!provider) {
    const error = 'No LLM provider configured — set GROQ_API_KEY (or OPENAI_API_KEY).';
    log(error);
    return { content: null, error };
  }
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
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const error = `LLM HTTP ${res.status} (model "${provider.model}"): ${body.slice(0, 300)}`;
      log(error);
      return { content: null, error };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const error = 'LLM returned an empty response.';
      log(error);
      return { content: null, error };
    }
    return { content, error: null };
  } catch (err) {
    const error = `LLM request failed: ${(err as Error).message}`;
    log(error);
    return { content: null, error };
  }
}

// ── LLM structured extraction (supplier quotations) ──
async function llmExtract(
  text: string,
): Promise<{ data: LlmResult | null; error: string | null }> {
  const { content, error } = await callExtractionLlm(
    EXTRACTION_SYSTEM_PROMPT,
    `DOCUMENT TEXT:\n${buildExtractionInput(text)}`,
  );
  if (!content) return { data: null, error };
  try {
    const suppliers = normalizeSuppliers(JSON.parse(content));
    if (!suppliers.length) {
      const e = 'LLM returned no supplier data.';
      log(e);
      return { data: null, error: e };
    }
    return { data: { suppliers }, error: null };
  } catch {
    const e = `LLM returned non-JSON content: ${String(content).slice(0, 200)}`;
    log(e);
    return { data: null, error: e };
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

const CATEGORY_SET = new Set<LineItemCategory>([
  'product',
  'freight',
  'shipping',
  'insurance',
  'handling',
  'other',
]);
function normCategory(c: string | null | undefined): LineItemCategory {
  const v = (c ?? '').toLowerCase().trim();
  return (CATEGORY_SET.has(v as LineItemCategory) ? v : 'product') as LineItemCategory;
}

// ── Map ONE LLM supplier object to an ExtractedQuotation ──
function mapSupplier(
  s: LlmSupplier,
  opts: {
    id: string;
    fileName: string;
    detected: { currency: string; confidence: number };
    index: number;
    count: number;
    /** cap every field/currency confidence at this value (scanned/vision source) */
    confCap?: number;
  },
): ExtractedQuotation {
  const { id, fileName, detected, index, count, confCap } = opts;
  // Scanned/vision extractions are inherently less certain than digital text —
  // cap confidence to medium so the UI never shows full/high confidence on a scan.
  const cap = (c: number) => (confCap != null ? Math.min(c, confCap) : c);

  // Per-supplier currency. For a single-supplier file trust a high-confidence
  // document detection; otherwise (incl. mixed-currency comparison sheets) trust
  // THIS supplier's stated currency, falling back to detection.
  let currency: string;
  let currencyConfidence: number;
  if (count === 1 && detected.confidence >= 0.9) {
    currency = detected.currency;
    currencyConfidence = detected.confidence;
  } else if (s.currency) {
    currency = s.currency;
    currencyConfidence = 0.85;
  } else {
    currency = detected.currency;
    currencyConfidence = detected.confidence;
  }
  currency = currency.toUpperCase();
  currencyConfidence = cap(currencyConfidence);
  const usdRate = getUsdRate(currency);

  // Line items incl. charge lines (freight/shipping/insurance/handling). A
  // lump-sum charge with no unit price is shown with its amount as the unit price
  // and qty 1 so it stays visible and comparable.
  const lineItems: LineItem[] = (s.lineItems ?? []).map((li) => {
    const category = normCategory(li.category);
    let unitPrice = num(li.unitPrice);
    let totalPrice = num(li.totalPrice);
    let quantity = num(li.quantity);
    if (category !== 'product') {
      const amount = totalPrice ?? unitPrice;
      totalPrice = totalPrice ?? amount;
      unitPrice = unitPrice ?? amount;
      quantity = quantity ?? 1;
    }
    const uom = li.uom?.trim() || null;
    return { name: String(li.name ?? 'Item').trim(), quantity, unitPrice, totalPrice, currency, category, uom };
  });

  // Stated grand totals with their own currencies (multi-currency docs).
  const statedTotals: StatedTotal[] = [];
  if (Array.isArray(s.totalsByCurrency)) {
    for (const t of s.totalsByCurrency) {
      const amount = num(t?.amount);
      if (amount != null) statedTotals.push({ amount, currency: (t?.currency || currency).toUpperCase() });
    }
  }
  const primaryStated = num(s.totalAmount);
  if (primaryStated != null && !statedTotals.some((t) => t.currency === currency)) {
    statedTotals.push({ amount: primaryStated, currency });
  }

  // BUG A: the compared total must be the FULL payable amount incl. freight & all
  // charges. Take the larger of (a) the stated grand total in this supplier's
  // currency and (b) the sum of every captured line (products + charges) — so a
  // stated total that omitted freight can't drop it from the comparison.
  const statedInCurrency =
    statedTotals.find((t) => t.currency === currency)?.amount ?? primaryStated ?? null;
  const lineSum = lineItems.reduce((sum, li) => {
    const line = li.totalPrice ?? (li.unitPrice != null && li.quantity != null ? li.unitPrice * li.quantity : 0);
    return sum + (line ?? 0);
  }, 0);
  const hasLines = lineItems.length > 0;
  const totalCost =
    statedInCurrency != null
      ? hasLines
        ? Math.max(statedInCurrency, Math.round(lineSum))
        : statedInCurrency
      : hasLines && lineSum > 0
        ? Math.round(lineSum)
        : null;

  const deliveryRaw = s.deliveryTime ?? null;
  const deliveryTerms = s.deliveryTerms?.trim() || null;
  const reference = s.reference?.trim() || null;
  const prNumber = s.prNumber?.trim() || null;
  // Never fall back to the uploaded filename as a supplier name — use the
  // extracted company name, else a neutral placeholder. (A screenshot named
  // "Screenshot 2026-…png" must never appear as the supplier.)
  const supplierName =
    s.supplierName?.trim() || (count > 1 ? `Supplier ${index + 1}` : 'Unknown Supplier');

  // Fold deliveryTerms / reference / alternate-currency totals into provenance
  // snippets so they stay auditable without new UI popover fields.
  const altTotals = statedTotals.filter((t) => t.currency !== currency);
  const totalSnippet =
    totalCost != null
      ? `Total (incl. freight & charges): ${totalCost.toLocaleString('en-US')} ${currency}` +
        (altTotals.length
          ? ` · also stated ${altTotals.map((t) => `${t.amount.toLocaleString('en-US')} ${t.currency}`).join(', ')}`
          : '')
      : null;
  const deliverySnippet =
    deliveryRaw || deliveryTerms
      ? `Delivery: ${[deliveryRaw, deliveryTerms].filter(Boolean).join(' · ')}`
      : null;

  const fields: Record<FieldKey, FieldProvenance> = {
    supplierName: fieldProv(
      s.supplierName ? `${supplierName}${reference ? ` · Ref ${reference}` : ''}` : null,
      s.supplierName ? cap(0.9) : 0,
    ),
    totalCost: fieldProv(totalSnippet, totalCost != null ? cap(0.9) : 0),
    deliveryDays: fieldProv(deliverySnippet, deliveryRaw ? cap(0.8) : 0),
    paymentTerms: fieldProv(s.paymentTerms ?? null, s.paymentTerms ? cap(0.85) : 0),
    warranty: fieldProv(s.warranty ?? null, s.warranty ? cap(0.8) : 0),
  };

  return {
    id,
    fileName,
    supplierName,
    totalCost,
    currency,
    totalCostUsd: toUsd(totalCost, currency),
    deliveryRaw,
    deliveryDays: normalizeDelivery(deliveryRaw),
    paymentTerms: s.paymentTerms ?? null,
    warranty: s.warranty ?? null,
    validUntil: s.validUntil ?? null,
    reference,
    prNumber,
    deliveryTerms,
    statedTotals,
    currencyConfidence,
    usdRate,
    lineItems,
    fields,
  };
}

// Pure mapping seam (no IO) — maps parsed LLM suppliers to quotations. Exposed
// so the freight-in-total and multi-supplier behavior is unit-testable without
// calling an LLM.
export function quotationsFromLlmSuppliers(
  suppliers: LlmSupplier[],
  fileName: string,
  detected: { currency: string; confidence: number },
  opts?: { scanned?: boolean },
): ExtractedQuotation[] {
  const confCap = opts?.scanned ? SCAN_CONF : undefined;
  return suppliers.map((s, i) =>
    mapSupplier(s, { id: `q_0_${i}`, fileName, detected, index: i, count: suppliers.length, confCap }),
  );
}

// ── Vision extraction for scanned PDFs and image uploads (Claude) ──
const SCAN_CONF = 0.7; // cap scanned/vision field confidence at "medium"
const MAX_SCAN_PAGES = 20; // cap scanned-PDF pages (vision cost/time)
const MAX_PDF_BYTES = 30 * 1024 * 1024; // Anthropic request limit is 32MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic per-image limit ~5MB

function unreadable(baseIndex: number, fileName: string, error: string): FileExtraction {
  return {
    quotations: [emptyQuotation(`q_${baseIndex}`, fileName)],
    textLength: 0,
    method: 'unreadable',
    error,
  };
}

// Parse JSON from a vision response that may be wrapped in prose / markdown fences.
function looseJsonParse(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        /* fall through to null */
      }
    }
    return null;
  }
}

async function pdfPageCount(buffer: Buffer): Promise<number | null> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    return typeof doc.numPages === 'number' ? doc.numPages : null;
  } catch {
    return null;
  }
}

function imageMediaType(ext: string, mime: string): ImageMediaType {
  if (ext === 'png' || mime === 'image/png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg' || mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  if (ext === 'webp' || mime === 'image/webp') return 'image/webp';
  if (ext === 'gif' || mime === 'image/gif') return 'image/gif';
  return 'image/png';
}

// Read a scanned PDF or an image with Claude vision → structured quotations.
// Returns a FileExtraction (method 'vision' on success, 'unreadable' when a hard
// size/page limit is hit), or null when vision produced nothing usable (the
// caller then emits a clear "couldn't read" error).
export async function visionExtractQuotations(
  buffer: Buffer,
  fileName: string,
  mime: string,
  baseIndex: number,
): Promise<FileExtraction | null> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isPdf = ext === 'pdf' || mime === 'application/pdf';

  let media: VisionMedia;
  if (isPdf) {
    if (buffer.length > MAX_PDF_BYTES) {
      return unreadable(
        baseIndex,
        fileName,
        `Scanned PDF is too large (${(buffer.length / 1048576).toFixed(1)} MB); the vision limit is 30 MB. Please split or compress it.`,
      );
    }
    const pages = await pdfPageCount(buffer);
    if (pages != null && pages > MAX_SCAN_PAGES) {
      return unreadable(
        baseIndex,
        fileName,
        `Scanned PDF has ${pages} pages; automatic scan reading is capped at ${MAX_SCAN_PAGES} pages. Please split it into smaller files.`,
      );
    }
    media = { kind: 'pdf', base64: buffer.toString('base64') };
  } else {
    if (buffer.length > MAX_IMAGE_BYTES) {
      return unreadable(
        baseIndex,
        fileName,
        `Image is too large (${(buffer.length / 1048576).toFixed(1)} MB); the vision limit is 5 MB. Please downscale it.`,
      );
    }
    media = { kind: 'image', base64: buffer.toString('base64'), mediaType: imageMediaType(ext, mime) };
  }

  try {
    const content = await extractJsonFromMedia({
      system: `${EXTRACTION_SYSTEM_PROMPT}\n\n${SCAN_NOTE}`,
      instruction:
        `Extract the structured quotation data from the attached ${isPdf ? 'scanned PDF' : 'image'}. ` +
        'Return ONLY the JSON object described above — no prose, no markdown fences.',
      media,
    });
    const suppliers = normalizeSuppliers(looseJsonParse(content));
    if (!suppliers.length) {
      log(`vision extraction returned no suppliers for "${fileName}"`);
      return null;
    }
    // Per-supplier currency comes from the vision read (no text to detect from).
    const detected = { currency: 'USD', confidence: 0.2 };
    const count = suppliers.length;
    const quotations = suppliers.map((s, i) =>
      mapSupplier(s, { id: `q_${baseIndex}_${i}`, fileName, detected, index: i, count, confCap: SCAN_CONF }),
    );
    return { quotations, textLength: 0, method: 'vision', error: null };
  } catch (err) {
    log(`vision extraction failed for "${fileName}": ${(err as Error).message}`);
    return null;
  }
}

// ── Extract ALL suppliers from one file (one document can compare several) ──
export async function extractQuotations(
  buffer: Buffer,
  fileName: string,
  mime: string,
  baseIndex: number,
): Promise<FileExtraction> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isPdf = ext === 'pdf' || mime === 'application/pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) || mime.startsWith('image/');
  const { text, error: textError } = await extractText(buffer, fileName, mime);

  if (!text.trim()) {
    // Scanned PDF or image upload → read it with Claude vision.
    if (isPdf || isImage) {
      if (!isAnthropicConfigured()) {
        return unreadable(
          baseIndex,
          fileName,
          `${isPdf ? 'Scanned/image PDF' : 'Image file'} needs AI vision to read, but it is not configured (set ANTHROPIC_API_KEY).`,
        );
      }
      const vision = await visionExtractQuotations(buffer, fileName, mime, baseIndex);
      if (vision) return vision;
      return unreadable(
        baseIndex,
        fileName,
        `${isPdf ? 'Scanned PDF' : 'Image'} could not be read by AI vision — no quotation data was found. Please upload a clearer scan/photo or a text-based file.`,
      );
    }
    return unreadable(baseIndex, fileName, textError ?? 'No text could be extracted from this file.');
  }

  const detected = detectCurrency(text);
  const { data: llm, error: llmError } = await llmExtract(text);

  if (!llm || !llm.suppliers.length) {
    // No structured result — return one empty quotation carrying the reason.
    return {
      quotations: [emptyQuotation(`q_${baseIndex}`, fileName)],
      textLength: text.length,
      method: 'heuristic',
      error: llmError,
    };
  }

  const count = llm.suppliers.length;
  const quotations = llm.suppliers.map((s, i) =>
    mapSupplier(s, { id: `q_${baseIndex}_${i}`, fileName, detected, index: i, count }),
  );

  return { quotations, textLength: text.length, method: 'llm', error: llmError };
}

function emptyQuotation(id: string, fileName: string): ExtractedQuotation {
  const empty = (): FieldProvenance => ({ snippet: null, confidence: 0 });
  return {
    id,
    fileName,
    supplierName: 'Unknown Supplier',
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

// ════════════════════════════════════════════════════════════════════════
// Purchase Requisition (PR) extraction
// ────────────────────────────────────────────────────────────────────────
// The company's OWN internal requisition (an "Approved Requisition Report"),
// uploaded alongside supplier quotations. It carries a Request No. and a list
// of requisitioned items (item code, description in English + Arabic, qty,
// unit). Its cost / consumption-history columns are NOT quotation prices and
// are intentionally ignored — only what's needed to match against supplier
// line items (Phase 2) is captured.
// ════════════════════════════════════════════════════════════════════════

interface LlmPrItem {
  itemCode: string | null;
  description: string | null;
  descriptionArabic?: string | null;
  quantity: number | null;
  unit: string | null;
}

interface LlmPr {
  requestNo: string | null;
  date: string | null;
  departmentCode: string | null;
  requesterName: string | null;
  approvedBy: string | null;
  items: LlmPrItem[];
}

// Shared schema + rules for reading a PR, used by BOTH the text path (Groq) and
// the scanned/image vision path (Claude) so the output shape is identical.
const PR_EXTRACTION_SYSTEM_PROMPT = [
  'You extract structured data from a COMPANY-INTERNAL PURCHASE REQUISITION (PR),',
  'also called an "Approved Requisition Report". This is NOT a supplier quotation —',
  'it is the buyer\'s own internal request listing the materials they need. It has',
  'NO prices to compare. Return ONLY valid JSON matching this TypeScript type, no prose:',
  '{',
  '  requestNo: string|null,       // "Request No.", "PR No", "Requisition No", "PR#"',
  '  date: string|null,            // requisition date exactly as written',
  '  departmentCode: string|null,  // department / cost-centre code',
  '  requesterName: string|null,   // person who raised the request',
  '  approvedBy: string|null,      // person who approved it',
  '  items: {',
  '    itemCode: string|null,          // the company item / material / stock code',
  '    description: string,            // item description in ENGLISH, exactly as written',
  '    descriptionArabic: string|null, // Arabic description if the same row has one',
  '    quantity: number|null,          // requested quantity',
  '    unit: string|null               // unit of measure (SET, PCS, NO, EA, KG, M ...)',
  '  }[]',
  '}',
  '',
  'Rules: use ONLY values present in the document — never invent. Numbers must be',
  'plain (no thousands separators or symbols). If a field is absent, use null.',
  '',
  'ITEMS: capture EVERY requisition line, scanning the ENTIRE document. Keep each',
  'item\'s FULL description text (it may be long and include grade/spec, e.g.',
  '"Anchor, Corrugated, Type Tws.10(60)-200(140)-40-253, Material Grade 253 Ma,',
  'with Plastic Caps"). If a row shows the description in both English and Arabic,',
  'put the English in `description` and the Arabic in `descriptionArabic`. IGNORE',
  'the cost, price, consumption-history, average-consumption and stock columns —',
  'they are not needed. Do NOT treat any number in those columns as an item price.',
].join('\n');

const PR_SCAN_NOTE = [
  'This purchase requisition is a SCANNED or PHOTOGRAPHED page (or several pages) —',
  'there is no digital text layer, so read the values directly from the page',
  'image(s). Read tables, stamps and handwriting where legible, and transcribe',
  'item codes and quantities EXACTLY. Arabic text may appear right-to-left — keep',
  'it as `descriptionArabic`. If a value is genuinely illegible, use null rather',
  'than guessing.',
].join('\n');

// Accept the PR object directly, or wrapped as { purchaseRequisition: {...} } /
// { pr: {...} }, and coerce to LlmPr (null when there's nothing usable).
function normalizePr(parsed: unknown): LlmPr | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const outer = parsed as Record<string, unknown>;
  const inner =
    (outer.purchaseRequisition as Record<string, unknown> | undefined) ??
    (outer.pr as Record<string, unknown> | undefined) ??
    outer;
  const itemsRaw = Array.isArray(inner.items)
    ? inner.items
    : Array.isArray(outer.items)
      ? outer.items
      : [];
  const str = (v: unknown): string | null =>
    v == null ? null : String(v).trim() || null;
  return {
    requestNo: str(inner.requestNo ?? inner.requestNumber ?? inner.prNumber),
    date: str(inner.date),
    departmentCode: str(inner.departmentCode ?? inner.department),
    requesterName: str(inner.requesterName ?? inner.requester),
    approvedBy: str(inner.approvedBy ?? inner.approver),
    items: (itemsRaw as unknown[])
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it) => ({
        itemCode: str(it.itemCode ?? it.code ?? it.materialCode),
        description: str(it.description ?? it.itemDescription) ?? '',
        descriptionArabic: str(it.descriptionArabic ?? it.arabicDescription),
        quantity: num(it.quantity ?? it.qty),
        unit: str(it.unit ?? it.uom),
      })),
  };
}

function mapPr(
  data: LlmPr,
  fileName: string,
  method: 'llm' | 'vision',
): PurchaseRequisition {
  const items: PrItem[] = (data.items ?? [])
    .map((it) => ({
      itemCode: it.itemCode?.trim() || null,
      description: (it.description ?? '').trim(),
      descriptionArabic: it.descriptionArabic?.trim() || null,
      quantity: num(it.quantity),
      unit: it.unit?.trim() || null,
    }))
    // Keep any row that identifies an item (a description or a code).
    .filter((it) => it.description || it.itemCode);
  return {
    fileName,
    requestNo: data.requestNo?.trim() || null,
    date: data.date?.trim() || null,
    departmentCode: data.departmentCode?.trim() || null,
    requesterName: data.requesterName?.trim() || null,
    approvedBy: data.approvedBy?.trim() || null,
    method,
    items,
  };
}

async function llmExtractPr(
  text: string,
): Promise<{ data: LlmPr | null; error: string | null }> {
  const { content, error } = await callExtractionLlm(
    PR_EXTRACTION_SYSTEM_PROMPT,
    `PURCHASE REQUISITION TEXT:\n${buildExtractionInput(text)}`,
  );
  if (!content) return { data: null, error };
  const data = normalizePr(looseJsonParse(content));
  if (!data) {
    const e = `PR extraction returned non-JSON content: ${String(content).slice(0, 200)}`;
    log(e);
    return { data: null, error: e };
  }
  return { data, error: null };
}

// Pure parse seam (no IO): accept whatever JSON the model returned and build a
// PurchaseRequisition. Exposed so PR normalization (bilingual rows, ignored cost
// columns, key aliases) is unit-testable without calling an LLM. Returns null
// when nothing usable was found.
export function purchaseRequisitionFromLlm(
  raw: unknown,
  fileName: string,
  method: 'llm' | 'vision' = 'llm',
): PurchaseRequisition | null {
  const data = normalizePr(raw);
  if (!data) return null;
  const pr = mapPr(data, fileName, method);
  return pr.items.length ? pr : null;
}

export interface PrExtraction {
  /** the extracted requisition, or null when nothing usable was read */
  pr: PurchaseRequisition | null;
  /** raw text length parsed — 0 for a scan/image read via vision */
  textLength: number;
  /** how it was read */
  method: 'llm' | 'vision' | 'unreadable';
  /** technical failure reason (null on success) */
  error: string | null;
}

// Read the company's Purchase Requisition from an uploaded file. Digital text
// (PDF/DOCX) goes through Groq; a scanned PDF or image is read with Claude
// vision — mirroring supplier-quotation extraction. Never invents data.
export async function extractPurchaseRequisition(
  buffer: Buffer,
  fileName: string,
  mime: string,
): Promise<PrExtraction> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const isPdf = ext === 'pdf' || mime === 'application/pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) || mime.startsWith('image/');
  const { text, error: textError } = await extractText(buffer, fileName, mime);

  if (!text.trim()) {
    // Scanned PDF or image upload → read it with Claude vision.
    if (isPdf || isImage) {
      if (!isAnthropicConfigured()) {
        return {
          pr: null,
          textLength: 0,
          method: 'unreadable',
          error: `${isPdf ? 'Scanned/image PDF' : 'Image'} PR needs AI vision to read, but it is not configured (set ANTHROPIC_API_KEY).`,
        };
      }
      let media: VisionMedia;
      if (isPdf) {
        if (buffer.length > MAX_PDF_BYTES) {
          return {
            pr: null,
            textLength: 0,
            method: 'unreadable',
            error: `Scanned PR PDF is too large (${(buffer.length / 1048576).toFixed(1)} MB); the vision limit is 30 MB.`,
          };
        }
        const pages = await pdfPageCount(buffer);
        if (pages != null && pages > MAX_SCAN_PAGES) {
          return {
            pr: null,
            textLength: 0,
            method: 'unreadable',
            error: `Scanned PR PDF has ${pages} pages; automatic scan reading is capped at ${MAX_SCAN_PAGES} pages.`,
          };
        }
        media = { kind: 'pdf', base64: buffer.toString('base64') };
      } else {
        if (buffer.length > MAX_IMAGE_BYTES) {
          return {
            pr: null,
            textLength: 0,
            method: 'unreadable',
            error: `PR image is too large (${(buffer.length / 1048576).toFixed(1)} MB); the vision limit is 5 MB.`,
          };
        }
        media = { kind: 'image', base64: buffer.toString('base64'), mediaType: imageMediaType(ext, mime) };
      }
      try {
        const content = await extractJsonFromMedia({
          system: `${PR_EXTRACTION_SYSTEM_PROMPT}\n\n${PR_SCAN_NOTE}`,
          instruction:
            `Extract the structured purchase-requisition data from the attached ${isPdf ? 'scanned PDF' : 'image'}. ` +
            'Return ONLY the JSON object described above — no prose, no markdown fences.',
          media,
        });
        const data = normalizePr(looseJsonParse(content));
        if (!data || !data.items.length) {
          log(`vision PR extraction returned no items for "${fileName}"`);
          return {
            pr: null,
            textLength: 0,
            method: 'unreadable',
            error: 'The purchase requisition could not be read — no requisition items were found. Please upload a clearer scan or a text-based file.',
          };
        }
        return { pr: mapPr(data, fileName, 'vision'), textLength: 0, method: 'vision', error: null };
      } catch (err) {
        const error = `PR vision extraction failed for "${fileName}": ${(err as Error).message}`;
        log(error);
        return { pr: null, textLength: 0, method: 'unreadable', error };
      }
    }
    return {
      pr: null,
      textLength: 0,
      method: 'unreadable',
      error: textError ?? 'No text could be extracted from the purchase-requisition file.',
    };
  }

  const { data, error } = await llmExtractPr(text);
  if (!data || !data.items.length) {
    return {
      pr: null,
      textLength: text.length,
      method: 'unreadable',
      error: error ?? 'No requisition items could be extracted from the purchase-requisition file.',
    };
  }
  return { pr: mapPr(data, fileName, 'llm'), textLength: text.length, method: 'llm', error: null };
}

export { SUPPORTED_CURRENCIES };
