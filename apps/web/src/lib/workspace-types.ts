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

export interface LineItem {
  name: string;
  quantity: number | null;
  /** unit price in `currency` */
  unitPrice: number | null;
  /** line total in `currency` */
  totalPrice: number | null;
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
  /** extracted line items (shared catalog across suppliers) */
  lineItems: LineItem[];
  /** per-field source snippet + confidence for traceability */
  fields: Record<FieldKey, FieldProvenance>;
}

export type RiskType =
  | 'missing_delivery'
  | 'missing_warranty'
  | 'unusual_pricing'
  | 'long_lead_time'
  | 'risky_payment_terms';

export interface RiskFlag {
  supplier: string;
  type: RiskType;
  message: string;
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
  warranty: number;
  risk: number;
}

/** Default weighting (sums to 1): price-led, then delivery, warranty, risk. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  price: 0.4,
  delivery: 0.25,
  warranty: 0.2,
  risk: 0.15,
};

export interface SupplierScore {
  quotation: ExtractedQuotation;
  /** each normalized to 0..1 where higher = better */
  price: number;
  delivery: number;
  warranty: number;
  risk: number;
  overall: number;
}

export interface AnalysisResult {
  quotations: ExtractedQuotation[];
  recommendation: Recommendation;
  risks: RiskFlag[];
  /** true when results are simulated (no real extraction backend wired yet) */
  simulated: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const formatCurrency = (value: number | null, currency = 'USD') =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);

export const formatDelivery = (days: number | null) =>
  days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`;
