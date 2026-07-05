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

export type RiskType =
  | 'missing_delivery'
  | 'missing_warranty'
  | 'unusual_pricing'
  | 'unusually_low_price'
  | 'long_lead_time'
  | 'risky_payment_terms'
  | 'expired_validity'
  | 'short_validity'
  | 'incomplete_quotation';

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
 *  - `ranked`        — normalized against the other suppliers (the normal case)
 *  - `benchmark`     — no peer comparison possible (single supplier or all tied),
 *                      so scored against an absolute benchmark instead
 *  - `missing`       — the value was not found in the document → scores 0
 *  - `no-comparison` — cannot be judged in isolation (e.g. price with a single
 *                      supplier); excluded from the weighted total, never full marks
 */
export type MetricStatus = 'ranked' | 'benchmark' | 'missing' | 'no-comparison';

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
