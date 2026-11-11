// Supabase/Storage implementation of PaymentsStore (service role only, AD-8, AD-12).
import { DbUnavailableError, serviceClient } from './db';
import type { PaymentRow, PaymentsStore } from './payments';

export const BUCKET = 'payment-proofs';
const COLS = 'id, user_id, plan, amount_usd, transaction_id, screenshot_path, status, decided_by, decided_at, reject_reason, created_at';

export function supabasePaymentsStore(client = serviceClient()): PaymentsStore {
  return {
    async upload(path, bytes, contentType) {
      const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new DbUnavailableError('proof upload failed');
    },
    async remove(path) {
      const { error } = await client.storage.from(BUCKET).remove([path]);
      if (error) throw new DbUnavailableError('proof remove failed');
    },
    async insert(row) {
      const { error } = await client.from('payment_requests').insert(row);
      if (!error) return 'ok';
      if ((error as { code?: string }).code === '23505') return 'pending_exists';
      throw new DbUnavailableError('payment insert failed');
    },
    async list(userId, offset, limit) {
      const { data, error, count } = await client
        .from('payment_requests')
        .select(COLS, { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new DbUnavailableError('payment list failed');
      return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
    },
    async pending(userId) {
      const { data, error } = await client
        .from('payment_requests')
        .select(COLS)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (error) throw new DbUnavailableError('payment pending query failed');
      return (data as PaymentRow | null) ?? null;
    },
    async get(id) {
      const { data, error } = await client.from('payment_requests').select(COLS).eq('id', id).maybeSingle();
      if (error) throw new DbUnavailableError('payment get failed');
      return (data as PaymentRow | null) ?? null;
    },
    async signedUrl(path, ttl) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, ttl);
      if (error || !data?.signedUrl) throw new DbUnavailableError('signed url failed');
      return data.signedUrl;
    },
  };
}
