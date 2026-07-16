// Shared types for the anonymous Procurement Workspace.

export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'png', 'jpg', 'jpeg'] as const;
export const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
] as const;

export type FieldKey =
  | 'supplierName'
  | 'totalCost'
  | 'deliveryDays'
  | 'paymentTerms'
  | 'warranty';

export interface FieldProvenance {
  /** source text snippet the value was extracted from (null when not found) */
  snippet: string | null;
  /** page number in the source document, if known */
  page?: number;
  /** 0..1 extraction confidence; 0 means the field was not found */
  confidence: number;
}

/**
 * Products vs charge lines. Charge lines (freight/shipping/insurance/handling)
 * are still counted in the payable total but shown distinctly so the buyer can
 * see they were included.
 */
export type LineItemCategory =
  | 'product'
  | 'freight'
  | 'shipping'
  | 'insurance'
  | 'handling'
  | 'other';

export interface LineItem {
  name: string;
  quantity: number | null;
  /** unit price in `currency` */
  unitPrice: number | null;
  /** line total in `currency` */
  totalPrice: number | null;
  currency: string;
  /** product (default) or a charge line — see LineItemCategory */
  category?: LineItemCategory;
  /** unit of measure as stated (e.g. "SET", "PCS", "KG") — null when not stated */
  uom?: string | null;
}

/** A grand total exactly as stated in the document, with its own currency. */
export interface StatedTotal {
  amount: number;
  currency: string;
}

export interface ExtractedQuotation {
  id: string;
  fileName: string;
  supplierName: string;
  /** original amount in `currency` — the comparison/scoring total, WITHOUT VAT */
  totalCost: number | null;
  currency: string;
  /** VAT-INCLUSIVE final amount in `currency`, when the doc states one separately
   * from VAT — kept for reference/display only, NEVER used for ranking or scoring */
  totalCostInclVat?: number | null;
  /** normalized to USD (single base currency) — used for sorting/scoring */
  totalCostUsd: number | null;
  /** raw delivery text as written ("2 weeks", "ASAP", a date) */
  deliveryRaw: string | null;
  /** normalized integer days — used for sorting/scoring */
  deliveryDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  /** quotation validity expiry (ISO date) — null when not stated */
  validUntil: string | null;
  /** supplier's own quotation / reference number, when the document states one */
  reference?: string | null;
  /** purchase-requisition / PR number if the document states one (form-level, shared across suppliers) */
  prNumber?: string | null;
  /** incoterms / delivery terms as written, e.g. "CFR Jeddah", "CIF Jeddah", "EXW" */
  deliveryTerms?: string | null;
  /** country of origin/manufacture as stated on the quote (normalized), else null —
   * never guessed. Drives local (Saudi Arabia) vs international VAT display. */
  countryOfOrigin?: string | null;
  /** every grand total as stated, each with its own currency (multi-currency docs) */
  statedTotals?: StatedTotal[];
  /** detected-currency confidence 0..1 (1 = explicit currency in document) */
  currencyConfidence: number;
  /** FX rate used to normalize `currency` -> USD (1 when already USD) */
  usdRate: number;
  /** extracted line items — arbitrary per document, not a fixed catalog */
  lineItems: LineItem[];
  /** per-field source snippet + confidence for traceability */
  fields: Record<FieldKey, FieldProvenance>;
  /** full-document English translation when the source wasn't English (else null).
   * The extracted fields above are already English; this is the whole-document
   * translation the manager reads, with the binding Arabic original kept alongside. */
  translation?: DocumentTranslation | null;
}

/** Language of the source document as detected during extraction. */
export type SourceLanguage = 'en' | 'ar' | 'bilingual';

/**
 * A full-document translation to English. Produced once (cached in the persisted
 * analysis), shown by default while the ORIGINAL text stays accessible — the
 * original is the binding text; the English is a convenience.
 */
export interface DocumentTranslation {
  /** detected source language ('ar' or 'bilingual' — English docs carry no translation) */
  language: SourceLanguage;
  /** the ORIGINAL document text exactly as parsed (the binding text) */
  originalText: string;
  /** full English translation — numbers/prices/dates/codes pass through unchanged */
  englishText: string;
  /** the Claude model that produced it, for the "machine translation" label */
  model: string;
  /** flags for anything untranslatable/ambiguous the model marked, never guessed */
  notes: string[];
  /** true when the source was too long and the translation was truncated */
  truncated?: boolean;
}

/**
 * A single requisitioned line on the company's internal Purchase Requisition
 * (PR). Only the fields needed for line-item matching against supplier
 * quotations are captured — the PR's cost / consumption-history columns are
 * intentionally ignored.
 */
export interface PrItem {
  /** the company's own item / material code (e.g. "1000123") — null when absent */
  itemCode: string | null;
  /** item description in English, exactly as written on the PR */
  description: string;
  /** Arabic description when the PR row is bilingual — null otherwise */
  descriptionArabic?: string | null;
  /** requested quantity — null when not stated */
  quantity: number | null;
  /** unit of measure as written (e.g. "SET", "PCS", "NO") — null when absent */
  unit: string | null;
}

/**
 * The company's internal Purchase Requisition / Approved Requisition Report,
 * uploaded alongside supplier quotations. Its line items are matched against
 * each supplier's quoted items (Phase 2) to drive Technical Approval.
 */
export interface PurchaseRequisition {
  /** the file it was extracted from */
  fileName: string;
  /** short header-level subject of the whole requisition (e.g. "Anchors for
   * production department"), from a "Description"/"Subject"/"Purpose" field —
   * NOT a line item. null when the header has no such summary. */
  description?: string | null;
  /** Request No. / PR# from the document header — null when not stated */
  requestNo: string | null;
  /** requisition date as written — null when absent */
  date?: string | null;
  /** department code from the header — null when absent */
  departmentCode?: string | null;
  /** requester name from the header — null when absent */
  requesterName?: string | null;
  /** approver name from the header — null when absent */
  approvedBy?: string | null;
  /** how it was read ('vision' = from a scan/photo) — surfaced as a UI note */
  method?: 'llm' | 'vision';
  /** every requisitioned line item */
  items: PrItem[];
}

/**
 * Per-(PR item × supplier) technical-approval state — three NON-OVERLAPPING
 * states so each PR item is counted exactly once (no "mismatch" AND "not quoted"
 * double count):
 *   - quoted_match     : a quoted line maps to it and the description/spec is consistent.
 *   - quoted_spec_diff : a quoted line maps to it (by description OR by exact quantity)
 *                        but the spec/description differs (e.g. grade "SS 310" vs
 *                        PR "253 MA"). This is "quoted, spec differs" — NOT "not quoted".
 *   - not_quoted       : no quoted line maps to this PR item at all.
 */
export type PrItemMatchState = 'quoted_match' | 'quoted_spec_diff' | 'not_quoted';

/** How ONE company PR item was covered by ONE supplier's quotation. */
export interface PrItemMatch {
  /** index into PurchaseRequisition.items */
  prIndex: number;
  state: PrItemMatchState;
  /** the supplier's own quoted line mapped here — null iff not_quoted */
  supplierItem: LineItem | null;
  /** 0..1 description similarity of the mapped line (0 when not_quoted) */
  score: number;
  /** how the line was mapped: by description/spec; by embedded DIMENSION code
   *  (part-number quotes like "REVA-W.10-200" → the 200(140) PR row); by QUANTITY
   *  (a free line whose qty uniquely matches the PR row — for free-text lines with
   *  no dimension code); or by line ORDER as a last resort. */
  mappedBy: 'description' | 'dimension' | 'quantity' | 'order' | null;
  /** short human note on WHAT differs, when state is 'quoted_spec_diff' (e.g.
   *  "grade 253 MA vs PR 253 C", "size/drawing described differently"); else null. */
  note?: string | null;
}

/** One supplier's full technical-approval picture against the PR (PR-item-centric). */
export interface SupplierMatch {
  supplier: string;
  quotationId: string;
  /** one entry per PR item, in PR order — states never overlap */
  prItems: PrItemMatch[];
  /** quoted PRODUCT lines that mapped to NO PR item (extra / unrequested items) */
  extraLines: LineItem[];
  /** counts over PR items — matchCount + specDiffCount + notQuotedCount === pr.items.length */
  matchCount: number;
  specDiffCount: number;
  notQuotedCount: number;
  /** true only when EVERY PR item is a clean quoted_match */
  allMatched: boolean;
}

/** Matching of every supplier's line items against the company PR. */
export interface PrMatchResult {
  bySupplier: SupplierMatch[];
  /** similarity threshold used (0..1) — surfaced for transparency */
  threshold: number;
}

/**
 * A Technical Comments value for the Approval Form. `aiSuggested` = the text is
 * an UNREVIEWED AI suggestion (rendered visually distinct, with an
 * "AI suggested — review" marker) and flips to false once a human edits it, so a
 * machine hint is never mistaken for a human technical verdict.
 */
export interface TechnicalComment {
  text: string;
  aiSuggested: boolean;
}

/**
 * A per-supplier, individually toggleable Approval Form field (Warranty, Country
 * of Origin). Mirrors {@link TechnicalComment} but adds an `enabled` switch: the AI
 * pre-fills `text` (aiSuggested=true, indigo/italic), the human may edit or clear
 * it (flips aiSuggested=false), and `enabled=false` HIDES the field for that
 * supplier on the generated form WITHOUT deleting the underlying extracted value
 * (so Country of Origin still drives the VAT local/international rule when hidden).
 */
export interface ApprovalFieldValue {
  enabled: boolean;
  text: string;
  aiSuggested: boolean;
}

export type RiskType =
  | 'missing_delivery'
  | 'missing_warranty'
  | 'unusual_pricing'
  | 'unusually_low_price'
  | 'long_lead_time'
  | 'risky_payment_terms'
  | 'expired_validity'
  | 'short_validity'
  | 'incomplete_quotation'
  | 'technical_mismatch'
  | 'missing_pr_item';

export type RiskSeverity = 'high' | 'medium' | 'low';

export interface RiskFlag {
  supplier: string;
  type: RiskType;
  severity: RiskSeverity;
  /** short one-line label shown in the risk list */
  message: string;
  /**
   * Plain-language explanation of WHY this was flagged, including the exact
   * triggering value and the threshold — shown in the hover/tap tooltip.
   */
  explanation: string;
}

export interface RecommendationItem {
  supplier: string;
  detail: string;
}

export interface Recommendation {
  lowestCost?: RecommendationItem;
  fastestDelivery?: RecommendationItem;
  bestOverall?: RecommendationItem;
}

export interface ScoreWeights {
  price: number;
  delivery: number;
  payment: number;
  warranty: number;
  risk: number;
}

/** Default weighting (sums to 1): Price 40 / Delivery 25 / Payment 15 / Warranty 10 / Risk 10. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  price: 0.4,
  delivery: 0.25,
  payment: 0.15,
  warranty: 0.1,
  risk: 0.1,
};

/**
 * How a single criterion was scored for one supplier:
 *  - `ranked`        — normalized against the other suppliers (min-max)
 *  - `proportional`  — scored as a ratio to the BEST value in the field (Price &
 *                      Delivery): best = full marks, others scale by best÷theirs,
 *                      so a finite gap never scores a flat 0
 *  - `benchmark`     — no peer comparison possible (single supplier or all tied),
 *                      so scored against an absolute benchmark instead
 *  - `missing`       — the value was not found in the document → scores 0
 *  - `no-comparison` — cannot be judged in isolation (e.g. price with a single
 *                      supplier); excluded from the weighted total, never full marks
 */
export type MetricStatus = 'ranked' | 'proportional' | 'benchmark' | 'missing' | 'no-comparison';

export interface MetricScore {
  /** 0..1, higher = better; always 0 for a missing value */
  score: number;
  status: MetricStatus;
  /** short auditable note, e.g. "Warranty: missing — 0" ('' for a plain ranked value) */
  note: string;
}

export interface SupplierScore {
  quotation: ExtractedQuotation;
  /** each normalized to 0..1 where higher = better (mirror of metrics[x].score) */
  price: number;
  delivery: number;
  payment: number;
  warranty: number;
  risk: number;
  /** per-criterion score + status (missing / benchmark / no-comparison) for auditability */
  metrics: Record<keyof ScoreWeights, MetricScore>;
  /** true when only one supplier was analyzed → no peer comparison is possible */
  singleSupplier: boolean;
  overall: number;
}

export interface ExtractionDebug {
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
}

export interface AnalysisResult {
  quotations: ExtractedQuotation[];
  recommendation: Recommendation;
  risks: RiskFlag[];
  /** true when results are the built-in sample (explicit "Load sample" only) */
  simulated: boolean;
  /**
   * The company's internal Purchase Requisition, when one was uploaded with the
   * quotations. Its items feed line-item matching / Technical Approval (Phase 2).
   */
  purchaseRequisition?: PurchaseRequisition | null;
  /**
   * Per-supplier matching of quoted line items against the PR items. Present
   * only when both a PR and quotations were provided.
   */
  prMatch?: PrMatchResult | null;
  /** per-file extraction diagnostics (real uploads only) */
  debug?: ExtractionDebug[];
}

// Charts the chat can render. The LLM only chooses the metric (a data-free
// directive) — the app draws the chart from the real analysis data, so values
// are never invented.
export const CHART_METRICS = ['cost', 'score', 'delivery', 'material'] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

export interface ChartDirective {
  metric: ChartMetric;
  /** optional short chart title suggested by the model */
  title?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** when present, render this chart (from real analysis data) under the message */
  chart?: ChartDirective;
}

// Always shows the ISO code prefix (e.g. "SAR 308,994", "USD 120,000") so the
// original document currency is unambiguous — never silently rendered as $.
export const formatCurrency = (value: number | null, currency = 'USD', digits = 0) => {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    // Unknown/non-ISO currency code — fall back to a plain prefixed number.
    return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
};

// UNIT prices are shown with 2 decimals everywhere (never rounded to an integer) —
// a per-piece rate like 15.50 or 2.42 must not collapse to 16 / 2 in the
// comparison or the Technical Approval matrix.
export const formatUnitPrice = (value: number | null, currency = 'USD') =>
  formatCurrency(value, currency, 2);

/** Plain 2-decimal number (no currency prefix) — for cells whose column already
 *  states the currency (e.g. the TA form's "Unit Price (EUR)" sub-header). */
export const formatUnitNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? ''
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDelivery = (days: number | null) =>
  days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`;

// Delivery for DISPLAY. The supplier's ORIGINAL quotation wording is
// authoritative and is shown VERBATIM (e.g. "4 to 5 weeks", "08 - Weeks",
// "30-45 days") — it is never replaced by the internal normalized day-count used
// for deterministic scoring. Only when the raw wording is absent do we fall back
// to the normalized value so the field is not left empty.
export const deliveryDisplay = (
  raw: string | null | undefined,
  days: number | null,
): string => {
  const original = raw?.trim();
  if (original) return original;
  return days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`;
};

// Optional faint helper shown NEXT TO the raw wording: the normalized day-count,
// but only when it actually adds information (i.e. the raw wording isn't already
// expressed in days and a normalized value exists). Returns null when redundant
// or unavailable — it must never replace the original quotation text.
export const deliveryNormalizedHint = (
  raw: string | null | undefined,
  days: number | null,
): string | null => {
  if (days == null) return null;
  const r = (raw ?? '').trim().toLowerCase();
  if (!r) return null; // raw absent → the primary display already shows the day-count
  if (/\bday/.test(r)) return null; // raw already stated in days → hint would be redundant
  // ASCII "~" (not "≈") — the standard PDF Helvetica font has no ≈ glyph.
  return `~${days} days`;
};

/**
 * Default Technical-Approval signature blocks — the current 5-role layout, used
 * when the user hasn't customized them. Real documents vary in BOTH count and
 * role names, so this is only a starting point; the UI lets the user
 * add / rename / reorder / toggle blocks freely. Defined here (dependency-free)
 * so the config UI can import it without pulling in the PDF renderer.
 */
export const DEFAULT_SIGNATURE_ROLES = [
  'Planning Engineer',
  'Planning Team Leader',
  'PM Section Head',
  'GEN. Serv. Section Head / E&I Manager',
  'Prod./Mech. Manager',
  'VP Operations',
];

/**
 * A supplier is LOCAL when its country of origin is Saudi Arabia; anything else
 * (with a stated country) is INTERNATIONAL. Drives the TA form's VAT display.
 * Used for display only — never to compute VAT.
 */
export function isLocalCountry(country: string | null | undefined): boolean {
  return country?.trim().toLowerCase() === 'saudi arabia';
}
