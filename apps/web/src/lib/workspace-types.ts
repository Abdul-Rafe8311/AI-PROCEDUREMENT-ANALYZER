// Shared types for the anonymous Procurement Workspace.

export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'png', 'jpg', 'jpeg'] as const;
export const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
] as const;

export interface ExtractedQuotation {
  id: string;
  fileName: string;
  supplierName: string;
  totalCost: number | null;
  currency: string;
  deliveryDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
}

export type RiskType =
  | 'missing_delivery'
  | 'missing_warranty'
  | 'unusual_pricing'
  | 'long_lead_time';

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
