// Pure rules and copy for the proof form, history and banners (UX-DR7, UX-DR8, UX-DR9, UX-DR16).
import { MAX_PROOF_BYTES, type PaymentStatus } from './payments-types';

export const PROOF_ACCEPT = 'image/png,image/jpeg,application/pdf';

export const NETWORK_FAILURE = "Upload didn't finish. Your details are kept. Try again.";
export const PENDING_HINT = 'You can submit a new request once this one is decided.';

const EXT_OK = /\.(png|jpe?g|pdf)$/i;

export function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : formatMb(bytes);
}

/** Client-side pre-check; the server re-validates by magic bytes. Null means acceptable. */
export function checkProofFile(f: { name: string; size: number; type: string }): string | null {
  const typeOk = (PROOF_ACCEPT.split(',') as string[]).includes(f.type) || EXT_OK.test(f.name);
  if (!typeOk) return 'Only PNG, JPG or PDF files are accepted.';
  if (f.size > MAX_PROOF_BYTES) {
    return `That file is ${formatMb(f.size)}. The limit is 5 MB. Try a smaller screenshot or a PDF.`;
  }
  if (f.size === 0) return 'That file is empty. Choose your receipt again.';
  return null;
}

export interface Badge {
  label: string;
  icon: 'clock' | 'check' | 'x';
  className: string;
}

export function statusBadge(s: PaymentStatus): Badge {
  switch (s) {
    case 'pending':
      return { label: 'Pending review', icon: 'clock', className: 'bg-warning/10 text-warning' };
    case 'approved':
      return { label: 'Approved', icon: 'check', className: 'bg-success/10 text-success' };
    default:
      return { label: 'Rejected', icon: 'x', className: 'bg-danger/10 text-danger' };
  }
}

export const FIELD_ORDER = ['plan', 'transactionId', 'file'] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type SubmitOutcome =
  | { kind: 'ok' }
  | { kind: 'fields'; fields: Partial<Record<FieldName, string>>; first: FieldName }
  | { kind: 'pending' }
  | { kind: 'network' }
  | { kind: 'error'; message: string };

/** Maps an API response to what the form should do. Branches on `code`, never on message text. */
export function interpretSubmit(status: number, body: unknown): SubmitOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: string; fields?: Record<string, string> };
  if (status === 201) return { kind: 'ok' };
  if (status === 409 && b.code === 'PENDING_REQUEST_EXISTS') return { kind: 'pending' };
  if (status === 400 && b.code === 'VALIDATION' && b.fields) {
    const fields: Partial<Record<FieldName, string>> = {};
    for (const k of FIELD_ORDER) if (typeof b.fields[k] === 'string') fields[k] = b.fields[k];
    const first = FIELD_ORDER.find((k) => fields[k]);
    if (first) return { kind: 'fields', fields, first };
  }
  if (b.code === 'PAYMENTS_UNAVAILABLE') return { kind: 'error', message: "Payments aren't available yet. Please try again later." };
  return { kind: 'error', message: 'We could not submit your payment proof. Please try again.' };
}

export const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const underReviewText = (iso: string): string =>
  `Payment under review. Submitted ${timeLabel(iso)}. We'll email you when it's decided.`;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
