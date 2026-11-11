// Client-safe payment shapes and rules shared by the API and the Pay UI. Pure.
import type { PaidPlanId } from './entitlements/plans';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentDto {
  id: string;
  plan: PaidPlanId;
  amountUsd: number;
  status: PaymentStatus;
  createdAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
  hasScreenshot: boolean;
}

export interface PaymentsPage {
  requests: PaymentDto[];
  page: number;
  pageSize: number;
  total: number;
  /** the user's pending request, whatever page is shown */
  pending: { id: string; plan: PaidPlanId; createdAt: string } | null;
}

export const TRANSACTION_ID_MAX = 100;

/** Printable, no control characters, 1-100 chars after trimming. Returns the cleaned value or null. */
export function cleanTransactionId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > TRANSACTION_ID_MAX) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(t) ? null : t;
}
