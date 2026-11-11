// Supabase implementation of AdminPaymentsStore (service role only).
import { DbUnavailableError, loadPeriods, serviceClient } from './db';
import { DecideInputError, type AdminPaymentsStore, type DecideResult, type EmailLogRow } from './payments-admin';
import type { PaymentRow } from './payments';

const COLS = 'id, user_id, plan, amount_usd, transaction_id, screenshot_path, status, decided_by, decided_at, reject_reason, created_at';

export function supabaseAdminPaymentsStore(client = serviceClient()): AdminPaymentsStore {
  return {
    async listPending(limit) {
      const { data, error } = await client
        .from('payment_requests').select(COLS).eq('status', 'pending').order('created_at', { ascending: true }).limit(limit);
      if (error) throw new DbUnavailableError('pending list failed');
      return (data ?? []) as PaymentRow[];
    },
    async listDecided(offset, limit) {
      const { data, error, count } = await client
        .from('payment_requests').select(COLS, { count: 'exact' }).neq('status', 'pending')
        .order('decided_at', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
      if (error) throw new DbUnavailableError('history list failed');
      return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
    },
    async get(id) {
      const { data, error } = await client.from('payment_requests').select(COLS).eq('id', id).maybeSingle();
      if (error) throw new DbUnavailableError('payment get failed');
      return (data as PaymentRow | null) ?? null;
    },
    async userEmails(ids) {
      const out = new Map<string, string | null>();
      await Promise.all(
        ids.map(async (id) => {
          const { data, error } = await client.auth.admin.getUserById(id);
          out.set(id, error ? null : (data?.user?.email ?? null));
        }),
      );
      return out;
    },
    async byTransactionIds(txIds) {
      if (!txIds.length) return [];
      const { data, error } = await client.from('payment_requests').select('id, transaction_id').in('transaction_id', txIds).limit(2000);
      if (error) throw new DbUnavailableError('duplicate lookup failed');
      return (data ?? []) as Array<{ id: string; transaction_id: string }>;
    },
    periods: (userId, now) => loadPeriods(userId, now, client),
    async emailLog(subjectIds) {
      if (!subjectIds.length) return [];
      const { data, error } = await client
        .from('email_log').select('subject_id, template, status').in('subject_id', subjectIds)
        .in('template', ['payment_approved', 'payment_rejected']).limit(5000);
      if (error) throw new DbUnavailableError('email_log query failed');
      return (data ?? []) as EmailLogRow[];
    },
    async decide({ requestId, adminEmail, decision, reason }) {
      const { data, error } = await client.rpc('decide_payment_request', {
        p_request_id: requestId, p_admin_email: adminEmail, p_decision: decision, p_reason: reason,
      });
      if (error) {
        const msg = String((error as { message?: string }).message ?? '');
        for (const r of ['invalid_decision', 'request_not_found', 'reason_required'] as const) {
          if (msg.includes(r)) throw new DecideInputError(r);
        }
        throw new DbUnavailableError('decide_payment_request failed');
      }
      return data as DecideResult;
    },
  };
}
