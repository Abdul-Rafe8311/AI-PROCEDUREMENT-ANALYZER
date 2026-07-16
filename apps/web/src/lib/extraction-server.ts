// Server-only real extraction: parse uploaded file text, detect currency, and
// use an LLM (Groq, OpenAI-compatible) to extract structured quotation data.
// Returns ACTUAL values from the document — no sample/placeholder data here.

import { normalizeDelivery } from './analysis-engine';
import {
  EXTRACTION_MODEL,
  extractJsonFromMedia,
  extractJsonWithClaude,
  isAnthropicConfigured,
  TRANSLATION_MODEL,
  translateWithClaude,
  type ImageMediaType,
  type VisionMedia,
} from './anthropic';
import type {
  DocumentTranslation,
  ExtractedQuotation,
  FieldKey,
  FieldProvenance,
  LineItem,
  LineItemCategory,
  PrItem,
  PurchaseRequisition,
  SourceLanguage,
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

// ── Layout-aware PDF text reconstruction ──
// A PDF's text layer has NO notion of "rows" — it is a stream of positioned glyph
// runs. Many procurement PDFs (and every right-to-left Arabic table) emit a table
// COLUMN-BY-COLUMN, so unpdf's flat `mergePages` text reads "all item codes, then
// all descriptions, then all prices" and the row structure — which code goes with
// which qty and price — is unrecoverable. We instead read each run's (x,y) from
// pdf.js and rebuild the page: cluster runs into rows by their baseline Y, then
// order each row left→right by X. Numbers that flat text glues together
// ("10000قطعة0.0510.36") come back apart because each is its own positioned run.
interface PdfGlyph {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rebuild one page's text from positioned glyph runs (rows by Y, cells by X).
 * Exported for unit testing (pure — takes pdf.js text items, returns text). */
export function reconstructPage(items: unknown[]): string {
  const glyphs: PdfGlyph[] = [];
  for (const raw of items) {
    const it = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof it.str !== 'string' || it.str.length === 0 || it.str === ' ') continue;
    const tr = it.transform as number[] | undefined;
    if (!tr || tr.length < 6) continue;
    glyphs.push({
      str: it.str,
      x: tr[4],
      y: tr[5],
      w: typeof it.width === 'number' ? it.width : 0,
      h: Math.abs(tr[3]) || (typeof it.height === 'number' ? it.height : 10),
    });
  }
  if (!glyphs.length) return '';

  const hs = glyphs.map((g) => g.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = hs[Math.floor(hs.length / 2)] || 10;

  // Row tolerance ≈ half the line spacing, so intra-row baseline jitter groups but
  // adjacent rows stay apart. Derive line spacing from the gaps between baselines.
  const ys = [...new Set(glyphs.map((g) => Math.round(g.y)))].sort((a, b) => b - a);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i]);
  const bigGaps = gaps.filter((g) => g > medianH * 0.9).sort((a, b) => a - b);
  const lineSpacing = bigGaps.length ? bigGaps[Math.floor(bigGaps.length / 2)] : medianH * 1.4;
  const rowTol = Math.max(medianH * 0.7, Math.min(lineSpacing * 0.5, medianH * 1.6));

  // Greedy clustering: attach each run (top→bottom) to the nearest row within tol.
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; sum: number; items: PdfGlyph[] }[] = [];
  for (const g of sorted) {
    let best: (typeof rows)[number] | null = null;
    let bestD = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.y - g.y);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best && bestD <= rowTol) {
      best.items.push(g);
      best.sum += g.y;
      best.y = best.sum / best.items.length;
    } else {
      rows.push({ y: g.y, sum: g.y, items: [g] });
    }
  }
  rows.sort((a, b) => b.y - a.y);

  const thresh = medianH * 0.28; // glyphs of one word sit within this gap
  const bigGap = medianH * 1.6; // a clear column boundary
  const lines = rows.map((r) => {
    const cells = r.items.sort((a, b) => a.x - b.x);
    let line = '';
    let prevEnd: number | null = null;
    for (const c of cells) {
      if (prevEnd != null) {
        const gap = c.x - prevEnd;
        // Space for a real cell gap OR an overlap of two DISTINCT cells; glue only
        // near-contiguous runs (|gap| ≤ thresh) — the glyphs of a single word.
        if (gap > bigGap) line += '   ';
        else if (gap > thresh || gap < -thresh) line += ' ';
      }
      line += c.str;
      prevEnd = c.x + c.w;
    }
    return line.replace(/[ \t]+/g, ' ').trim();
  });
  return lines.filter(Boolean).join('\n');
}

/** Layout-aware full-document text: reconstruct every page, page-separated. */
async function extractPdfLayout(doc: {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
}): Promise<string> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = reconstructPage(content.items);
    if (pageText.trim()) out.push(pageText);
  }
  return out.join('\n\n');
}

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
      // LAYOUT-AWARE FIRST: reconstruct rows from each glyph's (x,y) so a table
      // whose PDF content stream dumps columns separately (all codes, then all
      // descriptions, then all prices) is put back into ONE line per row. This is
      // what lets the LLM associate code↔qty↔price. Flat text (below) loses that.
      let t = '';
      try {
        t = await extractPdfLayout(doc);
      } catch (err) {
        log(`layout extraction failed for "${fileName}" — falling back to flat text: ${(err as Error).message}`);
      }
      // Fallback: if layout produced nothing usable, use unpdf's flat merged text.
      if (!t.trim()) {
        const { text } = await extractPdf(doc, { mergePages: true });
        t = text ?? '';
      }
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

// ── Language detection + full-document translation (Arabic → English) ──
// Arabic script blocks (base + supplement + extended-A + presentation forms A/B).
// Digits/codes are letter-free, so they don't skew the ratio.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

/**
 * Deterministic source-language detection from parsed text. 'ar' = predominantly
 * Arabic (needs translation), 'bilingual' = substantial text in BOTH scripts (e.g.
 * a bilingual quote whose English side is already readable — no translation), 'en'
 * = English / no Arabic. Pure — no LLM.
 */
export function detectLanguage(text: string): SourceLanguage {
  const arabic = (text.match(ARABIC_RE) ?? []).length;
  if (arabic === 0) return 'en';
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const arRatio = arabic / (arabic + latin || 1);
  if (arRatio >= 0.6) return 'ar'; // mostly Arabic — a fully-Arabic quotation
  if (arRatio <= 0.15) return 'en'; // English with a stray Arabic mark
  return 'bilingual'; // both scripts present in force (already has English)
}

// Inline flags the translator was told to leave for anything it could not safely
// translate ("[untranslated: …]" / "[ambiguous: …]") — surfaced to the reader.
const TRANSLATION_FLAG_RE = /\[(?:untranslated|ambiguous)\s*:\s*[^\]]+\]/gi;
export function extractTranslationNotes(englishText: string): string[] {
  return [...new Set((englishText.match(TRANSLATION_FLAG_RE) ?? []).map((s) => s.trim()))];
}

// One translation call comfortably covers a multi-page quote; cap the input so a
// pathological document can't blow the request/latency budget (flagged as truncated).
const MAX_TRANSLATE_CHARS = 40000;

const TRANSLATION_SYSTEM_PROMPT = [
  'You are a precise commercial/legal translator. Translate the procurement document',
  'below into clear, well-STRUCTURED English for a manager who does not read Arabic.',
  'This translation may inform a document that gets SIGNED, so ACCURACY matters most.',
  '',
  'OUTPUT FORMAT — GitHub-flavoured Markdown, so the reader gets a readable document,',
  'NOT one run-on paragraph and NOT a table mashed into a sentence:',
  '- Header / meta fields (To, From, Date, Reference / Quotation No., Subject) → one',
  '  short line each with a bold label, e.g. "**Date:** 03-06-2026".',
  '- Letter / body prose → normal paragraphs.',
  '- The goods / items / pricing list → a Markdown TABLE (one row per item, one cell',
  '  per column). NEVER fold the table into a sentence and NEVER glue two cells',
  '  together (e.g. "Grade 253 MA" and "10000" and "Piece" are THREE separate cells).',
  '- Trailing terms (Payment Terms, Validity, Delivery, Freight, Total / Grand Total)',
  '  → one bold-labelled line each.',
  '- Use a "##" heading only where the source clearly has a section title.',
  '',
  'THE ITEMS TABLE — build ONE Markdown table with a header row. An Arabic table',
  'reads RIGHT-TO-LEFT; map each source column to an English header by MEANING (never',
  'by position):',
  '  م / ت = No. · الرمز / الكود / رمز الصنف = Code · الوصف / البيان / المواصفات =',
  '  Description · الكمية / العدد = Qty · الوحدة = UOM · الوزن (كجم) = Unit Weight ·',
  '  سعر الوحدة / السعر = Unit Price · الإجمالي / المجموع = Total.',
  '  Keep every value in its OWN column — a quantity must NEVER land in the price or',
  '  weight column. Put the currency in the header ("Unit Price (SAR)", "Total (SAR)"),',
  '  not in each cell. Include EVERY item row, in the SAME order as the source.',
  '  Translate ONLY the Description text; pass codes and all numbers through unchanged.',
  '',
  'RULES:',
  '- Translate MEANING only; do NOT add, infer, omit, summarize, shorten or re-order',
  '  content. Keep items and lines in the SAME order as the source.',
  '- Pass through EXACTLY and UNCHANGED every number, price, quantity, percentage,',
  '  date, currency code/symbol, reference/quotation number, part/item/material code,',
  '  IBAN, VAT number, C.R. number, phone number and email. NEVER change, reformat,',
  '  localize or re-order a single digit or code.',
  '- IDENTIFIERS ARE NOT TRANSLATED — a company / supplier / brand name is an',
  '  identifier, not words to translate. Use the Latin / registered form printed in',
  '  the document and do NOT translate its meaning. When a header shows a Latin name',
  '  beside its Arabic form (e.g. "Alfran Saudi Arabia Co — شركة الفران العربية',
  '  السعودية"), output ONLY the Latin form "Alfran Saudi Arabia Co." — do NOT append',
  '  or substitute a translation such as "Al-Faran Saudi Arabia Company", "Arabian',
  '  Saudi Furn Company" or "Furnaces". If ONLY an Arabic name is given, transliterate',
  '  it phonetically; never translate the words.',
  '- Text already in English: copy it verbatim. Translate only the Arabic parts.',
  '- If a word or phrase is untranslatable or genuinely ambiguous, KEEP the original',
  '  and mark it inline as [untranslated: <original>] — never guess a meaning.',
  '',
  'Output ONLY the translated Markdown document — no preamble, no commentary, and no',
  'code fence wrapping the whole thing.',
].join('\n');

/**
 * Full-document Arabic→English translation via Claude (temperature 0). Preserves
 * structure and passes numbers/codes through unchanged; flags anything it could not
 * translate. Logs token usage. Returns null on failure (extraction, whose fields are
 * already English, is unaffected — the manager just won't get the whole-doc render).
 */
export async function translateDocument(
  text: string,
  language: SourceLanguage,
  fileName: string,
): Promise<DocumentTranslation | null> {
  const truncated = text.length > MAX_TRANSLATE_CHARS;
  const input = truncated ? text.slice(0, MAX_TRANSLATE_CHARS) : text;
  try {
    const { content, usage } = await translateWithClaude({
      system: TRANSLATION_SYSTEM_PROMPT,
      user: input,
      maxTokens: 8192,
    });
    const englishText = content.trim();
    if (!englishText) {
      log(`translation produced no text for "${fileName}"`);
      return null;
    }
    const notes = extractTranslationNotes(englishText);
    if (truncated) {
      notes.push('[truncated: the document was long; only the first part was translated — see the original for the remainder]');
    }
    log(
      `[tokens] translation (${language}->en) via ${TRANSLATION_MODEL}: input=${usage.inputTokens} output=${usage.outputTokens} (total=${usage.inputTokens + usage.outputTokens})`,
    );
    log(
      `translated "${fileName}" (${language}->en): ${text.length} chars -> ${englishText.length} chars${truncated ? ' (truncated)' : ''}${notes.length ? `, ${notes.length} flag(s)` : ''}`,
    );
    return { language, originalText: text, englishText, model: TRANSLATION_MODEL, notes, truncated };
  } catch (err) {
    log(`translation failed for "${fileName}": ${(err as Error).message}`);
    return null;
  }
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
  /** per-line stock/lead-time column ("Available in Days") when the doc has one —
   * a DELIVERY signal, never the offer validity */
  availableInDays?: number | null;
}

export interface LlmSupplier {
  supplierName: string | null;
  /** this supplier's quotation / reference number, if stated */
  reference: string | null;
  /** form-level purchase-requisition (PR) number, if stated on the document */
  prNumber?: string | null;
  currency: string | null;
  /** FULL payable grand total (incl. freight & all charges) in `currency`. If the
   * doc shows a VAT-inclusive final AND a separate VAT line, this is the inclusive
   * final; comparison derives the without-VAT figure from it and `vatAmount`. */
  totalAmount: number | null;
  /** the VAT / tax amount if shown as a SEPARATE line — never a goods/freight line */
  vatAmount?: number | null;
  /** the total price WITHOUT VAT if the document states it explicitly */
  totalWithoutVat?: number | null;
  /** every grand total as stated, each with its currency (multi-currency docs) */
  totalsByCurrency: { amount: number | null; currency: string | null }[] | null;
  /** lead time / delivery duration text, e.g. "60 days" — NEVER the offer validity */
  deliveryTime: string | null;
  /** incoterms / delivery terms, e.g. "CFR Jeddah", "CIF Jeddah", "EXW" */
  deliveryTerms: string | null;
  /** country of origin / manufacture / supply as STATED on the quote, else null */
  countryOfOrigin?: string | null;
  /** the country where THIS SUPPLIER is registered/located, from its own address,
   * letterhead, C.R. or VAT number — used to infer origin when none is stated */
  supplierCountry?: string | null;
  paymentTerms: string | null;
  warranty: string | null;
  validUntil: string | null;
  lineItems: LlmLineItem[];
}

/** One document can compare several suppliers side by side → an array. */
interface LlmResult {
  suppliers: LlmSupplier[];
}

/**
 * Normalize a stated country of origin to a canonical name for the common cases
 * (Saudi Arabia / Germany / France), else return the stated value as-is. Strips a
 * leading label ("Country of Origin:", "Made in") and returns null when nothing is
 * stated — never guesses a country.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .replace(/^(country\s+of\s+origin|origin|made\s+in|manufactured\s+in|country)\s*[:\-–]?\s*/i, '')
    .trim();
  if (!s) return null;
  const u = s.toLowerCase().replace(/[.\-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(^|\s)(ksa|saudi|saudia|kingdom of saudi arabia)(\s|$)/.test(u)) return 'Saudi Arabia';
  if (/germany|deutschland|f r of germany/.test(u)) return 'Germany';
  if (/france|french/.test(u)) return 'France';
  return s;
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
  '    vatAmount: number|null,     // the VAT/tax amount, if shown as a SEPARATE line',
  '    totalWithoutVat: number|null, // total price WITHOUT VAT, if the doc states it',
  '    totalsByCurrency: { amount: number, currency: string }[]|null,',
  '    deliveryTime: string|null, deliveryTerms: string|null,',
  '    countryOfOrigin: string|null, // country of origin/manufacture/supply if STATED (e.g. "Country of Origin: France", "F.R. OF GERMANY"); else null — NEVER guess',
  '    supplierCountry: string|null, // the country where THIS SUPPLIER is registered/located, read from its OWN address, letterhead, Commercial Registration (C.R.) or VAT number (a 15-digit Saudi VAT number ⇒ Saudi Arabia). This is the supplier\'s country, NOT necessarily the goods\' origin. null only if the document shows no supplier address/registration at all.',
  '    paymentTerms: string|null, warranty: string|null, validUntil: string|null (ISO date),',
  '    lineItems: { name: string, quantity: number|null, unitPrice: number|null,',
  '                 totalPrice: number|null, category: string|null, uom: string|null,',
  '                 availableInDays: number|null }[]',
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
  'VERBATIM ONLY — never elaborate. Copy text fields (deliveryTerms, paymentTerms,',
  'warranty, item names) EXACTLY and terse as written. Do NOT expand abbreviations,',
  "add an Incoterm's standard meaning, a port, packing, duty or any detail that is",
  'not literally printed. If deliveryTerms is just "FOB", return "FOB" — never',
  '"FOB <port>, duty unpaid, seaworthy packing". Terse in the source → terse output.',
  '',
  'LANGUAGE — every DESCRIPTIVE TEXT field must be in English. If a value is written',
  'in Arabic, translate its MEANING to CONCISE English (do not transliterate the',
  'words); if it is already in English, copy it verbatim. Stay terse either way —',
  'translating is not a licence to expand or explain. This covers item DESCRIPTIONS,',
  'deliveryTerms, paymentTerms, warranty. NEVER translate, localize or alter numbers,',
  'prices, quantities, dates, currency codes, reference numbers or part/item codes.',
  '',
  'IDENTIFIERS ARE NEVER TRANSLATED — a company / supplier / brand name, a part or',
  'item code, a reference / quotation / PR number, a drawing number, an IBAN, a VAT or',
  'C.R. number, an email or a URL passes through EXACTLY, in any language. For a',
  'supplierName written in Arabic, do NOT translate its meaning into English words:',
  '  1) prefer a Latin/English form of the name printed ANYWHERE in the document',
  '     (letterhead, logo, stamp, email domain, IBAN account name, website), else',
  '  2) TRANSLITERATE it phonetically.',
  'Treat the ENTIRE supplier name as ONE identifier: do NOT translate ANY part of it',
  '— not "شركة" (company), not "العربية السعودية" (Arabian/Saudi). Either output the',
  'exact Latin/registered name the document prints (e.g. a letterhead "Alfran Saudi',
  'Arabia Co."), or transliterate the whole Arabic name phonetically. Example: a',
  'supplier shown as "الفران" / "شركة الفران العربية السعودية" is the brand "Alfran"',
  '— output "Alfran Saudi Arabia Co." (its printed Latin name), NEVER "Furnaces" and',
  'NEVER "…Arabian Saudi Company" (that translates the words). The same company MUST',
  'get the same name from its Arabic and its English quote, or it looks like two',
  'different suppliers and cross-quote matching breaks. A brand inside an item',
  'description is likewise kept — translate only the surrounding descriptive words.',
  '',
  'EXTRACT EACH FIELD INDEPENDENTLY. Cells may be garbled, overlapping or truncated',
  'in the source. If ONE cell for a supplier is unreadable, still capture every',
  'OTHER field for that SAME supplier (total, delivery, payment, terms) — set only',
  'the genuinely unreadable field to null. Never drop a supplier\'s delivery/payment/',
  'total just because a nearby cell (e.g. its item description) is hard to read.',
  '',
  "EACH SUPPLIER'S OWN COLUMN: in a side-by-side sheet, read every value for a",
  "supplier from THAT supplier's own column/row only. Do NOT borrow a total, price",
  "or term from an adjacent supplier's column, a neighbouring row, or a different",
  "line. Take the grand total from that supplier's OWN total row, not a nearby number.",
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
  'DELIVERY: deliveryTime = the lead time / duration with its UNIT exactly as',
  'written — copy the number AND the unit ("88 Days", "08 - Weeks", "3 Months"). Do',
  'NOT convert units or drop the unit (never turn "8 weeks" into "8"). deliveryTerms',
  '= the incoterms exactly as written (e.g. "CFR Jeddah", "CIF Jeddah", "EXW", "FOB"),',
  'with NO added explanation.',
  'DELIVERY != VALIDITY: NEVER use an offer "Validity"/"Valid for"/"Offer valid"',
  'field as deliveryTime — that is how long the PRICE holds, not the lead time. Put',
  'validity in validUntil only. deliveryTime must come from an explicit delivery /',
  'lead-time / "Available in Days" field. If the goods table has a per-line',
  '"Available in Days" (or "Lead Time (days)") COLUMN, copy that number into that',
  'line\'s availableInDays. If there is NO delivery/lead-time field at all, set',
  'deliveryTime to null (do NOT fall back to validity, do NOT invent a number).',
  '',
  'VAT / TAX: comparison is on the price WITHOUT VAT. If the document shows a',
  'VAT-inclusive "Final Amount"/"Grand Total" AND a separate VAT/tax line, put the',
  'inclusive final in totalAmount and the VAT figure in vatAmount (and the pre-VAT',
  'subtotal in totalWithoutVat if it is printed). Do NOT add the VAT/tax as a',
  'lineItem — it is not a goods or freight charge.',
  '',
  'UNIT PRICE PRECISION: copy unitPrice EXACTLY as printed, keeping decimals',
  '(15.50, 10.36, 2.42) — never round a unit price to a whole number.',
  '',
  'PR NUMBER: prNumber = the purchase-requisition / PR number if the document shows',
  'one (a form-level header field like "PR#", "PR No", "Requisition No", "PR Description"',
  'section). It is shared by all suppliers on the same form — copy it to each. Null if absent.',
  'UOM: for each line item, uom = the unit of measure exactly as written (e.g. "SET",',
  '"PCS", "KG", "EA", "M", "NO") if a units column is present; otherwise null.',
  '',
  'ARABIC & RIGHT-TO-LEFT TABLES: an Arabic goods table reads right-to-left and has',
  'Arabic column headers — map each header to its field by MEANING, NEVER by position,',
  'and read EACH row as one product line item:',
  '  م / ت / رقم = serial no. (ignore) · الرمز / رمز الصنف / كود / الكود = item code',
  '  · الوصف / البيان / المواصفات / الصنف = description (→ name) · الكمية / العدد =',
  '  quantity · الوحدة / وحدة = uom · الوزن / الوزن (كجم) = weight (ignore) · سعر',
  '  الوحدة / السعر / سعر القطعة = unitPrice · الإجمالي / المجموع / القيمة / الإجمالي',
  '  الفرعي = totalPrice.',
  'Keep every number in its OWN column: الكمية (quantity) must NEVER land in unitPrice',
  'or totalPrice, and سعر الوحدة (unit price) must NEVER be read as the quantity. Do',
  'NOT swap columns because the layout is right-to-left. Extract ALL product rows —',
  'not only the freight (شحن / نقل / الشحن) and total (الإجمالي / المجموع الكلي) rows.',
  'When the table has an item-code column (الرمز), include that code in the line-item',
  'name (e.g. "404602703004 — Corrugated anchor TWS.10(60)-200(140)-40-253 Grade 253',
  'MA") so it is not lost.',
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
  'Keep every value in its OWN column: overlapping or truncated text in one cell',
  'must not make you skip other cells or pull a number from the wrong column. Read',
  'the grand total from each supplier\'s own total row. Transcribe ONLY what is',
  'printed — do not add detail, expand Incoterms, or infer values that are not shown.',
  'ALWAYS capture each supplier\'s real COMPANY / SUPPLIER NAME (from the column',
  'header, letterhead, stamp, signature block, or an "M/s <name>" line) into',
  'supplierName. Do NOT use the file name. Only leave supplierName null if no',
  'company name appears anywhere for that supplier.',
].join('\n');

// ── Raw structured-extraction call (Claude primary; Groq/OpenAI fallback) ──
// Sends a system prompt + document text and returns the model's raw JSON text.
// Shared by supplier-quotation and purchase-requisition text extraction. Claude
// (claude-sonnet-4-6) is the PRIMARY model — it reads clean text layers far more
// accurately than Groq's llama-3.3-70b (grades, VAT, week/day units, quantities).
// Groq/OpenAI stay as a fallback ONLY when ANTHROPIC_API_KEY is absent. Token
// usage is logged per call so real cost can be measured.
async function callExtractionLlm(
  system: string,
  userContent: string,
): Promise<{ content: string | null; error: string | null }> {
  if (isAnthropicConfigured()) {
    try {
      const { content, usage } = await extractJsonWithClaude({ system, user: userContent });
      log(
        `[tokens] text extraction via ${EXTRACTION_MODEL}: input=${usage.inputTokens} output=${usage.outputTokens} (total=${usage.inputTokens + usage.outputTokens})`,
      );
      if (!content) return { content: null, error: 'Claude returned an empty extraction response.' };
      return { content, error: null };
    } catch (err) {
      const error = `Claude extraction failed: ${(err as Error).message}`;
      log(error);
      return { content: null, error };
    }
  }

  // Fallback: Groq (preferred) → OpenAI, only when no Anthropic key is set.
  const provider = resolveProvider();
  if (!provider) {
    const error = 'No LLM provider configured — set ANTHROPIC_API_KEY (or GROQ_API_KEY / OPENAI_API_KEY).';
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
  fileName = 'document',
): Promise<{ data: LlmResult | null; error: string | null }> {
  const input = buildExtractionInput(text);
  const { content, error } = await callExtractionLlm(
    EXTRACTION_SYSTEM_PROMPT,
    `DOCUMENT TEXT:\n${input}`,
  );
  // DEBUG: with EXTRACTION_DEBUG set, dump the exact text the model received AND
  // its raw response, so we can tell whether item rows are missing from the input
  // (a PDF-parsing / RTL problem) or being dropped by the model. Otherwise log a
  // compact size line so the deployed logs still show the shape of each call.
  if (process.env.EXTRACTION_DEBUG) {
    log(`RAW INPUT for "${fileName}" (${text.length} chars, sent ${input.length}):\n${input}`);
    log(`RAW LLM RESPONSE for "${fileName}":\n${content ?? '(empty)'}`);
  } else {
    log(`extract "${fileName}": input ${text.length} chars (sent ${input.length}) -> response ${content?.length ?? 0} chars`);
  }
  if (!content) return { data: null, error };
  // Lenient parse: Claude may wrap JSON in prose / markdown fences (same handling
  // as the vision path). looseJsonParse returns null instead of throwing.
  const parsed = looseJsonParse(content);
  if (parsed == null) {
    const e = `LLM returned non-JSON content: ${String(content).slice(0, 200)}`;
    log(e);
    return { data: null, error: e };
  }
  const suppliers = normalizeSuppliers(parsed);
  if (!suppliers.length) {
    const e = 'LLM returned no supplier data.';
    log(e);
    return { data: null, error: e };
  }
  return { data: { suppliers }, error: null };
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
  // USD figures are derived at render from the single live FX source (applyFxRates),
  // never a stale rate baked in here.
  const usdRate = 1;

  // Line items incl. charge lines (freight/shipping/insurance/handling). A
  // lump-sum charge with no unit price is shown with its amount as the unit price
  // and qty 1 so it stays visible and comparable. Unit prices are kept EXACTLY as
  // extracted (never rounded — a 15.50 rate must not become 16). A VAT/tax line is
  // NOT a goods/freight charge: it is pulled out here and handled as VAT below.
  const isVatLine = (name: string, category: LineItemCategory): boolean =>
    category !== 'product' && /\bvat\b|value[-\s]?added|\btax\b|\bgst\b/i.test(name);
  let vatFromLines = 0;
  const lineItems: LineItem[] = (s.lineItems ?? [])
    .map((li) => {
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
    })
    .filter((li) => {
      if (isVatLine(li.name, li.category ?? 'product')) {
        vatFromLines += li.totalPrice ?? li.unitPrice ?? 0;
        return false; // VAT never lives in lineItems, never in the goods sum
      }
      return true;
    });

  // ── VAT basis: comparison + scoring use the price WITHOUT VAT. Prefer an
  // explicit without-VAT figure; else derive final − VAT; else use the stated
  // total as-is (no VAT stated → it already is the comparison total). The
  // VAT-inclusive final is kept for reference only, NEVER compared or scored. ──
  const primaryStated = num(s.totalAmount); // may be VAT-inclusive
  const vatStated = num(s.vatAmount) ?? (vatFromLines > 0 ? vatFromLines : null);
  const exVatStated = num(s.totalWithoutVat);
  const primaryWithoutVat =
    exVatStated != null
      ? exVatStated
      : primaryStated != null && vatStated != null
        ? primaryStated - vatStated
        : primaryStated;
  const totalCostInclVat =
    primaryStated != null && primaryWithoutVat != null && primaryStated !== primaryWithoutVat
      ? primaryStated
      : null;

  // Stated grand totals with their own currencies (multi-currency docs). For the
  // PRIMARY currency store the WITHOUT-VAT figure so every "Total without VAT"
  // surface (report, TA form) agrees with the compared/scored number.
  const statedTotals: StatedTotal[] = [];
  if (Array.isArray(s.totalsByCurrency)) {
    for (const t of s.totalsByCurrency) {
      const amount = num(t?.amount);
      const c = (t?.currency || currency).toUpperCase();
      if (amount != null && c !== currency) statedTotals.push({ amount, currency: c });
    }
  }
  if (primaryWithoutVat != null) statedTotals.push({ amount: primaryWithoutVat, currency });

  // The compared total must be the FULL payable amount (WITHOUT VAT) incl. freight
  // & all charges. Start from the document's own stated without-VAT total. If that
  // total OMITTED charge lines (freight etc.), let the line-sum lift it — but cap
  // that lift at stated + charges, so a MISREAD or duplicated PRODUCT line can't
  // inflate the payable above the stated total (BUG 1: one supplier read ~15% high
  // from an over-summed product column).
  const statedInCurrency = primaryWithoutVat;
  const lineAmount = (li: LineItem): number =>
    li.totalPrice ?? (li.unitPrice != null && li.quantity != null ? li.unitPrice * li.quantity : 0);
  const lineSum = lineItems.reduce((sum, li) => sum + lineAmount(li), 0);
  const chargeSum = lineItems.reduce(
    (sum, li) => ((li.category ?? 'product') !== 'product' ? sum + lineAmount(li) : sum),
    0,
  );
  const hasLines = lineItems.length > 0;
  const totalCost =
    statedInCurrency != null
      ? hasLines
        ? Math.max(statedInCurrency, Math.min(Math.round(lineSum), statedInCurrency + Math.round(chargeSum)))
        : statedInCurrency
      : hasLines && lineSum > 0
        ? Math.round(lineSum)
        : null;

  // ── Delivery: prefer an explicit per-line "Available in Days" column (an
  // unambiguous lead-time signal) — take the longest so the buyer sees when ALL
  // items arrive; else the stated delivery/lead-time text; else MISSING. An offer
  // "Validity" is NEVER used as delivery (that is validUntil). ──
  const availDays = (s.lineItems ?? [])
    .map((li) => num(li.availableInDays))
    .filter((v): v is number => v != null && v > 0);
  const deliveryRaw = availDays.length
    ? `${Math.max(...availDays)} days`
    : s.deliveryTime?.trim() || null;
  const deliveryTerms = s.deliveryTerms?.trim() || null;
  // Origin = the STATED country of origin; if the quote doesn't state one, fall
  // back to the country where the supplier itself is registered (its address/CR/
  // VAT). This is document-supported — a Saudi-registered supplier resolves to
  // "Saudi Arabia" (and thus LOCAL for VAT), never a guessed country. Stays null
  // only when the document carries no country information at all.
  const countryOfOrigin =
    normalizeCountry(s.countryOfOrigin) ?? normalizeCountry(s.supplierCountry);
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
      ? `Total without VAT (incl. freight & charges): ${totalCost.toLocaleString('en-US')} ${currency}` +
        (totalCostInclVat != null
          ? ` · incl. VAT ${totalCostInclVat.toLocaleString('en-US')} ${currency}`
          : '') +
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
    totalCostInclVat,
    totalCostUsd: null, // filled at render from live FX (applyFxRates)
    deliveryRaw,
    deliveryDays: normalizeDelivery(deliveryRaw),
    paymentTerms: s.paymentTerms ?? null,
    warranty: s.warranty ?? null,
    validUntil: s.validUntil ?? null,
    reference,
    prNumber,
    deliveryTerms,
    countryOfOrigin,
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
  // Detect language and, for a predominantly-Arabic quote, translate the WHOLE
  // document to English — in parallel with extraction (both read the SAME Arabic
  // source, so structured fields are extracted from the original, not the
  // translation). Bilingual docs already carry English → no translation needed.
  const language = detectLanguage(text);
  const wantTranslation = language === 'ar' && isAnthropicConfigured();
  const [{ data: llm, error: llmError }, translation] = await Promise.all([
    llmExtract(text, fileName),
    wantTranslation ? translateDocument(text, language, fileName) : Promise.resolve(null),
  ]);

  if (!llm || !llm.suppliers.length) {
    // No structured result — return one empty quotation carrying the reason (and
    // the translation, if any, so the manager can still read the document).
    const empty = emptyQuotation(`q_${baseIndex}`, fileName);
    if (translation) empty.translation = translation;
    return {
      quotations: [empty],
      textLength: text.length,
      method: 'heuristic',
      error: llmError,
    };
  }

  const count = llm.suppliers.length;
  const quotations = llm.suppliers.map((s, i) =>
    mapSupplier(s, { id: `q_${baseIndex}_${i}`, fileName, detected, index: i, count }),
  );

  // Arabic RTL rescue: a right-to-left goods table often survives PDF text
  // extraction as jumbled, mis-ordered text, so the row structure is lost and only
  // scattered singletons (total, freight) come through — the model gets ZERO
  // product line items even though the document clearly has items. When that
  // happens on an Arabic PDF, re-read the RENDERED page with Claude vision, which
  // reads the RTL table layout (and the Latin letterhead name) natively.
  const productCount = countProducts(quotations);
  const arabicTableDropped =
    isPdf &&
    language !== 'en' &&
    isAnthropicConfigured() &&
    productCount === 0 &&
    quotations.some((q) => q.totalCost != null || q.lineItems.length > 0);
  if (arabicTableDropped) {
    log(
      `"${fileName}": Arabic PDF text path yielded 0 product line items — retrying with vision (RTL table likely jumbled in the text layer).`,
    );
    const vision = await visionExtractQuotations(buffer, fileName, mime, baseIndex);
    if (vision && countProducts(vision.quotations) > 0) {
      if (translation) for (const q of vision.quotations) q.translation = translation;
      log(`"${fileName}": vision rescue recovered ${countProducts(vision.quotations)} product line item(s).`);
      return vision;
    }
    log(`"${fileName}": vision rescue found no additional line items — keeping the text-path result.`);
  }

  // The translation is per-DOCUMENT — attach it to every supplier read from this file.
  if (translation) for (const q of quotations) q.translation = translation;

  return { quotations, textLength: text.length, method: 'llm', error: llmError };
}

/** Total PRODUCT (non-charge) line items across a set of quotations. */
function countProducts(quotations: ExtractedQuotation[]): number {
  return quotations.reduce(
    (n, q) => n + q.lineItems.filter((li) => (li.category ?? 'product') === 'product').length,
    0,
  );
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
  description: string | null;
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
  '  description: string|null,     // SHORT overall subject of the whole requisition',
  '                                //   (e.g. "Anchors for production department") taken',
  '                                //   from a header "Description"/"Subject"/"Purpose"/',
  '                                //   "PR Description"/"Required for" field, OR an unlabeled',
  '                                //   purpose/title line near the top (e.g. a "... for ...',
  '                                //   department" phrase). NOT a line item. null only if truly absent.',
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
  'ITEMS: capture EVERY requisition line, scanning the ENTIRE document (all pages).',
  'This is often an "Approved Requisition Report" with a DENSE multi-column table —',
  'columns typically include a line/serial number, Item/Material/Stock Code, a long',
  'Description, UOM, and Quantity (plus consumption-history / average-consumption /',
  'stock columns to IGNORE). Return EVERY material row as its own item, even if the',
  'table spans many rows or pages — do NOT stop early, do NOT merge multiple rows',
  'into one, and do NOT collapse the table into a single summary item. A row is an',
  'item if it has a material code OR a description, even when some cells are blank.',
  'Keep each item\'s FULL description text (it may be long and include grade/spec,',
  'e.g. "Anchor, Corrugated, Type Tws.10(60)-200(140)-40-253, Material Grade 253 Ma,',
  'with Plastic Caps"). If a row shows the description in both English and Arabic,',
  'put the English in `description` and the Arabic in `descriptionArabic`. IGNORE',
  'the cost, price, consumption-history, average-consumption and stock columns —',
  'they are not needed. Do NOT treat any number in those columns as an item price.',
  'The `items` array MUST NOT be empty when the document lists any materials.',
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
    description: str(
      inner.description ??
        inner.subject ??
        inner.purpose ??
        inner.prDescription ??
        inner.title,
    ),
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

// Clean a requisition item description: collapse whitespace and drop a trailing
// ORPHAN short number leaked from an ADJACENT code/ref/qty cell during table
// reconstruction — e.g. "… And 8 Control Modules 97." where "97" is a fragment of
// the ref "125007 97". Requires a ≥3-letter word before the stray number so genuine
// trailing model/size numbers are far less likely to be touched.
function cleanPrItemDescription(desc: string): string {
  return desc
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([A-Za-z]{3,})\s+\d{1,4}\.?$/, '$1')
    .trim();
}

function mapPr(
  data: LlmPr,
  fileName: string,
  method: 'llm' | 'vision',
): PurchaseRequisition {
  const mapped: PrItem[] = (data.items ?? [])
    .map((it) => ({
      itemCode: it.itemCode?.trim() || null,
      description: cleanPrItemDescription(it.description ?? ''),
      descriptionArabic: it.descriptionArabic?.trim() || null,
      quantity: num(it.quantity),
      unit: it.unit?.trim() || null,
    }))
    // Keep any row that identifies an item (a description or a code).
    .filter((it) => it.description || it.itemCode);

  // De-duplicate repeated requisition rows so a quantity is NEVER doubled — e.g.
  // the same line echoed as a bilingual pair, or repeated in a summary block. Key
  // on the item code when present, else the normalized English description. Keep
  // the FIRST occurrence VERBATIM (quantities are taken as written, never summed).
  const seen = new Set<string>();
  const items: PrItem[] = mapped.filter((it) => {
    const key =
      (it.itemCode ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
      it.description.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) return true; // nothing to key on → keep (can't confidently dedupe)
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    fileName,
    description: data.description?.trim() || null,
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
