// Admin payment review: list and decide (AD-6, AD-7, AD-10). Logic over an injected store.
import { NextResponse } from 'next/server';
import { planApproval } from '../entitlements/apply-payment';
import type { PlanPeriod } from '../entitlements/effective-plan';
import { dateLabel } from '../payment-form';
import type { AdminPaymentDto, AdminPaymentsHistory, AdminPaymentsPending } from '../payments-types';
import { getConfig } from './config';
import { sendEmail, type SendResult } from './email';
import type { Principal } from './guard';
import { clampPage, type PaymentRow } from './payments';
import { SITE_URL } from '../site';

export interface DecideResult {
  status: 'approved' | 'rejected' | 'ALREADY_DECIDED';
  plan?: string;
  starts_at?: string;
  ends_at?: string;
}

export class DecideInputError extends Error {
  constructor(public readonly reason: 'invalid_decision' | 'request_not_found' | 'reason_required') {
    super(reason);
    this.name = 'DecideInputError';
  }
}

export interface EmailLogRow {
  subject_id: string | null;
  template: string;
  status: string;
}

/** Failed means: a decision email exists for the request, none was sent, and at least one failed. */
export function emailFailedIds(rows: EmailLogRow[]): Set<string> {
  const sent = new Set<string>();
  const failed = new Set<string>();
  for (const r of rows) {
    if (!r.subject_id || (r.template !== 'payment_approved' && r.template !== 'payment_rejected')) continue;
    if (r.status === 'sent') sent.add(r.subject_id);
    else if (r.status === 'failed') failed.add(r.subject_id);
  }
  return new Set([...failed].filter((id) => !sent.has(id)));
}

export interface AdminPaymentsStore {
  listPending(limit: number): Promise<PaymentRow[]>;
  listDecided(offset: number, limit: number): Promise<{ rows: PaymentRow[]; total: number }>;
  get(id: string): Promise<PaymentRow | null>;
  userEmails(ids: string[]): Promise<Map<string, string | null>>;
  /** every request (any status) using one of these transaction IDs */
  byTransactionIds(txIds: string[]): Promise<Array<{ id: string; transaction_id: string }>>;
  periods(userId: string, now: Date): Promise<PlanPeriod[]>;
  emailLog(subjectIds: string[]): Promise<EmailLogRow[]>;
  decide(args: { requestId: string; adminEmail: string; decision: 'approve' | 'reject'; reason: string | null }): Promise<DecideResult>;
}

const headers = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers });
const unavailable = () => json(503, { error: 'Service unavailable.', code: 'SERVICE_UNAVAILABLE' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_LIMIT = 100;
const HISTORY_PAGE = 20;

function dto(
  r: PaymentRow,
  emails: Map<string, string | null>,
  dupes: Array<{ id: string; transaction_id: string }>,
  resulting: AdminPaymentDto['resulting'],
  failed: Set<string>,
): AdminPaymentDto {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: emails.get(r.user_id) ?? null,
    plan: r.plan,
    amountUsd: r.amount_usd,
    transactionId: r.transaction_id,
    createdAt: new Date(r.created_at).toISOString(),
    hasScreenshot: Boolean(r.screenshot_path),
    status: r.status,
    duplicateOf: dupes.filter((d) => d.transaction_id === r.transaction_id && d.id !== r.id).map((d) => d.id),
    resulting,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    rejectReason: r.reject_reason,
    emailFailed: failed.has(r.id),
  };
}

export async function listAdminPayments(
  req: Request,
  store: AdminPaymentsStore,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('view') === 'history') {
      const { page } = clampPage(url);
      const { rows, total } = await store.listDecided((page - 1) * HISTORY_PAGE, HISTORY_PAGE);
      const [emails, dupes, log] = await Promise.all([
        store.userEmails([...new Set(rows.map((r) => r.user_id))]),
        store.byTransactionIds([...new Set(rows.map((r) => r.transaction_id))]),
        store.emailLog(rows.map((r) => r.id)),
      ]);
      const failed = emailFailedIds(log);
      const body: AdminPaymentsHistory = {
        view: 'history',
        requests: rows.map((r) => dto(r, emails, dupes, null, failed)),
        page,
        pageSize: HISTORY_PAGE,
        total,
      };
      return NextResponse.json(body, { headers });
    }

    const rows = await store.listPending(PENDING_LIMIT); // oldest first
    const [emails, dupes] = await Promise.all([
      store.userEmails([...new Set(rows.map((r) => r.user_id))]),
      store.byTransactionIds([...new Set(rows.map((r) => r.transaction_id))]),
    ]);
    const at = now();
    const requests = await Promise.all(
      rows.map(async (r) => {
        const periods = await store.periods(r.user_id, at);
        const a = planApproval(periods, r.plan, at);
        return dto(r, emails, dupes, { startsAt: a.inserts[0].startsAt, endsAt: a.inserts[0].endsAt, upgrade: a.upgrade }, new Set());
      }),
    );
    const body: AdminPaymentsPending = { view: 'pending', requests };
    return NextResponse.json(body, { headers });
  } catch (err) {
    console.error('[admin/payments] list failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
}

export interface DecideDeps {
  store: AdminPaymentsStore;
  send?: typeof sendEmail;
  supportEmail?: string | null;
  siteUrl?: string;
}

export async function decidePayment(
  req: Request,
  requestId: string,
  principal: Principal,
  deps: DecideDeps,
): Promise<Response> {
  if (!UUID.test(requestId)) return json(404, { error: 'Request not found.', code: 'NOT_FOUND' });
  let body: { decision?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { decision: 'Send a JSON body.' } });
  }
  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { decision: 'Decision must be approve or reject.' } });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (decision === 'reject' && !reason) {
    return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { reason: 'A reason is required to reject. It is emailed to the user.' } });
  }
  if (reason.length > 1000) {
    return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { reason: 'Keep the reason under 1000 characters.' } });
  }
  const adminEmail = principal.email;
  if (!adminEmail) return json(403, { error: 'Admin access required.', code: 'FORBIDDEN' });

  let result: DecideResult;
  let row: PaymentRow | null;
  try {
    row = await deps.store.get(requestId);
    if (!row) return json(404, { error: 'Request not found.', code: 'NOT_FOUND' });
    result = await deps.store.decide({ requestId, adminEmail, decision, reason: decision === 'reject' ? reason : null });
  } catch (err) {
    if (err instanceof DecideInputError) {
      if (err.reason === 'request_not_found') return json(404, { error: 'Request not found.', code: 'NOT_FOUND' });
      return json(400, { error: 'Invalid input.', code: 'VALIDATION', fields: { reason: 'A reason is required to reject.' } });
    }
    console.error('[admin/payments] decide failed:', err instanceof Error ? err.name : 'error');
    return unavailable();
  }
  if (result.status === 'ALREADY_DECIDED') {
    return json(409, { error: 'This request was already decided.', code: 'ALREADY_DECIDED' });
  }

  // Post-commit, best effort (AD-10): nothing below can change the decision.
  let emailSent = false;
  try {
    const email = (await deps.store.userEmails([row.user_id])).get(row.user_id) ?? null;
    if (email) {
      const send = deps.send ?? sendEmail;
      const site = deps.siteUrl ?? SITE_URL;
      let r: SendResult;
      if (result.status === 'approved') {
        r = await send('payment_approved', email, { plan: row.plan, expiresOn: dateLabel(result.ends_at as string) }, { subjectId: row.id });
      } else {
        r = await send(
          'payment_rejected',
          email,
          { plan: row.plan, reason, supportEmail: deps.supportEmail ?? safeSupport(), plansUrl: `${site}/plans` },
          { subjectId: row.id },
        );
      }
      emailSent = r.ok;
    }
  } catch {
    console.error('[admin/payments] decision email step failed');
  }
  return json(200, {
    status: result.status,
    plan: result.plan ?? row.plan,
    startsAt: result.starts_at ?? null,
    endsAt: result.ends_at ?? null,
    emailSent,
  });
}

function safeSupport(): string | null {
  try {
    return getConfig().supportEmail;
  } catch {
    return null;
  }
}
