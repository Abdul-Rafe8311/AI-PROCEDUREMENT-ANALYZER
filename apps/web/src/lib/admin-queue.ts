// Copy and rules for the admin payment queue (UX-DR10, UX-DR11, UX-DR16). Pure.
import { dateLabel } from './payment-form';
import { PLAN_NAMES } from './plan-matrix';
import type { AdminPaymentDto } from './payments-types';

export const EMPTY_QUEUE = 'No payments waiting.';
export const ALREADY_DECIDED_TEXT = 'This request was already decided.';
export const REASON_HINT = 'This text is emailed to the user';
export const EMAIL_NOT_SENT = 'Email not sent';

export const who = (p: AdminPaymentDto): string => p.userEmail ?? 'Unknown user';
export const usd = (n: number): string => `$${n.toFixed(2)} USD`;
export const planName = (p: AdminPaymentDto): string => PLAN_NAMES[p.plan];

export const receiptAlt = (p: AdminPaymentDto): string => `Payment receipt submitted by ${who(p)}`;

export const duplicateWarningLead = 'This transaction ID was used in another request';

/** "Approve Pro for farid@x ($12.00 USD). Active from today until 11 Dec 2026." */
export function approveSummary(p: AdminPaymentDto): string {
  const until = p.resulting ? ` Active from today until ${dateLabel(p.resulting.endsAt)}.` : '';
  const timing =
    p.resulting && new Date(p.resulting.startsAt).getTime() - Date.now() > 24 * 60 * 60 * 1000
      ? ` It starts on ${dateLabel(p.resulting.startsAt)}, after the user's current plan.`
      : until;
  return `Approve ${planName(p)} for ${who(p)} (${usd(p.amountUsd)}).${timing}`;
}

export const rejectDisabled = (reason: string): boolean => reason.trim().length === 0;

export type DecisionUi =
  | { kind: 'done'; message: string; warn: boolean }
  | { kind: 'stale'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

/** Maps the decide API response to what the queue should show. Branches on `code`. */
export function interpretDecision(status: number, body: unknown, decision: 'approve' | 'reject'): DecisionUi {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: string; emailSent?: boolean; fields?: Record<string, string> };
  if (status === 200) {
    const base = decision === 'approve' ? 'Approved.' : 'Rejected.';
    return b.emailSent === false
      ? { kind: 'done', warn: true, message: `${base} Decision saved. The email could not be sent.` }
      : { kind: 'done', warn: false, message: `${base} The user has been emailed.` };
  }
  if (status === 409 && b.code === 'ALREADY_DECIDED') return { kind: 'stale', message: ALREADY_DECIDED_TEXT };
  if (status === 400 && b.code === 'VALIDATION') {
    return { kind: 'invalid', message: b.fields?.reason ?? 'Check the details and try again.' };
  }
  return { kind: 'error', message: 'Could not save the decision. Please try again.' };
}

export const decidedLine = (p: AdminPaymentDto): string =>
  `${p.status === 'approved' ? 'Approved' : 'Rejected'} by ${p.decidedBy ?? 'an admin'}${p.decidedAt ? `, ${dateLabel(p.decidedAt)}` : ''}`;

export function submittedLabel(iso: string): string {
  const d = new Date(iso);
  return `${dateLabel(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
