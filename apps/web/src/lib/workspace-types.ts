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
  /** original amount in `currency` */
  totalCost: number | null;
  currency: string;
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

/** Result of matching one supplier's quoted item against the company's PR. */
export type ItemMatchStatus = 'approved' | 'mismatch';

/**
 * How a single supplier-quoted (product) line item relates to the company's
 * Purchase Requisition. `approved` = it matched a PR item on spec ("Technically
 * Approved" against that item); `mismatch` = it matched nothing confidently
 * (wrong spec/grade, or an item the PR never requested).
 */
export interface SupplierItemMatch {
  /** the supplier's own line item, as quoted */
  supplierItem: LineItem;
  /** PR item index this was Technically Approved against — null on a mismatch */
  prIndex: number | null;
  /** closest PR item by similarity even below the match threshold — powers the
   * "what was requested vs what was quoted" view for a mismatch */
  closestPrIndex: number | null;
  status: ItemMatchStatus;
  /** 0..1 similarity that drove the decision */
  score: number;
}

/** One supplier's full technical-approval picture against the PR. */
export interface SupplierMatch {
  supplier: string;
  quotationId: string;
  /** one entry per PRODUCT line the supplier quoted (freight/charge lines excluded) */
  items: SupplierItemMatch[];
  /** PR item indices this supplier did NOT quote at all (missing from its offer) */
  missingPrIndexes: number[];
  approvedCount: number;
  mismatchCount: number;
  /** true only when every PR item is matched AND no quoted item is a mismatch */
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
export const formatCurrency = (value: number | null, currency = 'USD') => {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      currencyDisplay: 'code',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Unknown/non-ISO currency code — fall back to a plain prefixed number.
    return `${currency} ${Math.round(value).toLocaleString('en-US')}`;
  }
};

export const formatDelivery = (days: number | null) =>
  days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`;

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
  'PM Section Head Response',
  'Mech. Manager Response',
  'VP Operations Response',
];
