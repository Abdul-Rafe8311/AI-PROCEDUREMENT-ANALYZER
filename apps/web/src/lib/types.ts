export type Role = 'ADMIN' | 'PROCUREMENT_MANAGER';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Supplier {
  id: string;
  companyName: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  reliabilityScore: number;
  notes?: string | null;
  createdAt: string;
}

export interface ProcurementRequest {
  id: string;
  title: string;
  description?: string | null;
  requiredItems?: string | null;
  quantity?: number | null;
  requiredDeliveryDate?: string | null;
  budget?: number | null;
  currency: string;
  status: string;
  createdAt: string;
  _count?: { quotations: number };
  owner?: { firstName: string; lastName: string };
}

export interface Quotation {
  id: string;
  supplierName?: string | null;
  currency?: string | null;
  totalPrice?: number | null;
  deliveryTime?: string | null;
  deliveryDays?: number | null;
  paymentTerms?: string | null;
  status: string;
  riskLevel?: string | null;
  fileName: string;
  items?: QuotationItem[];
}

export interface QuotationItem {
  id: string;
  productName: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
}

export interface ComparisonRow {
  quotationId: string;
  supplierName: string;
  reliabilityScore: number;
  totalPrice: number | null;
  currency: string | null;
  deliveryDays: number | null;
  deliveryTime: string | null;
  paymentTerms: string | null;
  itemCount: number;
  riskLevel: string | null;
  riskScore: number | null;
  warnings: string[];
  isLowestCost: boolean;
  isFastest: boolean;
  isMostReliable: boolean;
  isRecommended: boolean;
}

export interface Comparison {
  request: {
    id: string;
    title: string;
    budget: number | null;
    currency: string;
    status: string;
  };
  rows: ComparisonRow[];
  recommendation: {
    recommendedQuotationId: string | null;
    summary: string;
    highlights: { bullets: string[] };
  };
  summary: {
    quotationCount: number;
    lowestCost: number | null;
    highestCost: number | null;
    fastestDeliveryDays: number | null;
    highRiskCount: number;
  };
}

export interface Analytics {
  kpis: {
    totalRequests: number;
    totalQuotations: number;
    totalSuppliers: number;
    awardedRequests: number;
    avgQuotationResponseHours: number;
    estimatedSavings: number;
  };
  monthlySpend: { month: string; value: number }[];
  procurementVolume: { month: string; value: number }[];
  topSuppliers: { name: string; quotes: number; value: number }[];
}

export interface ChatAnswer {
  answer: string;
  sources: { quotationId: string; supplierName: string | null; snippet: string; score: number }[];
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
