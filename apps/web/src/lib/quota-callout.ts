// Copy for the blocked-upload callout (UX-DR2, UX-DR15). Pure so it is unit-tested.
import { formatQuotaDate } from './entitlements/quota-window';

export interface QuotaBlock {
  plan: string;
  quota: number;
  remaining: number;
  resetAt: string;
  /** quotation files the user had selected when blocked */
  selected: number;
}

export const planLabel = (p: string): string => p.charAt(0).toUpperCase() + p.slice(1);

export function quotaCalloutMessage(b: QuotaBlock): string {
  if (b.remaining <= 0) {
    return `You've used all ${b.quota} PDFs on your ${planLabel(b.plan)} plan. Resets on ${formatQuotaDate(b.resetAt)}. See plans.`;
  }
  const over = Math.max(b.selected - b.remaining, 1);
  return `You selected ${b.selected} PDFs but have ${b.remaining} left. Remove ${over} or see plans.`;
}

/** Parses a 429 QUOTA_EXCEEDED body; null for anything else. */
export function parseQuotaBlock(status: number, body: unknown, selected: number): QuotaBlock | null {
  const b = body as Record<string, unknown> | null;
  if (status !== 429 || !b || b.code !== 'QUOTA_EXCEEDED') return null;
  if (typeof b.plan !== 'string' || typeof b.quota !== 'number' || typeof b.remaining !== 'number' || typeof b.resetAt !== 'string') return null;
  return { plan: b.plan, quota: b.quota, remaining: b.remaining, resetAt: b.resetAt, selected };
}

export const NO_PDFS_USED = "This didn't use any of your PDFs.";

/** Statuses where the server counted nothing and the existing error is shown. */
export const withNoUsageNote = (status: number, message: string): string =>
  [422, 500, 503].includes(status) ? `${message}\n\n${NO_PDFS_USED}` : message;
