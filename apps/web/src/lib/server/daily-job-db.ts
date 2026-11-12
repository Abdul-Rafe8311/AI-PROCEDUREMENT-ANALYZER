// Supabase implementations of the daily-job stores (service role only, AD-12).
import { BUCKET } from './payments-db';
import { DbUnavailableError, serviceClient } from './db';
import type { ExpiryStore, RetentionStore } from './daily-job';

const EXPIRY_PAGE = 1000;
const IN_CHUNK = 100;

export function supabaseExpiryStore(client = serviceClient()): ExpiryStore {
  return {
    async expiring(now, windowEnd) {
      // Page through everything in the window (PostgREST caps a response at 1000 rows).
      const out: Array<{ id: string; userId: string; plan: string; endsAt: string }> = [];
      for (let from = 0; ; from += EXPIRY_PAGE) {
        const { data, error } = await client
          .from('plan_periods')
          .select('id, user_id, plan, ends_at')
          .is('voided_at', null)
          .gt('ends_at', now.toISOString())
          .lte('ends_at', windowEnd.toISOString())
          .order('ends_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + EXPIRY_PAGE - 1);
        if (error) throw new DbUnavailableError('expiring periods query failed');
        const rows = data ?? [];
        for (const r of rows) out.push({ id: r.id as string, userId: r.user_id as string, plan: r.plan as string, endsAt: r.ends_at as string });
        if (rows.length < EXPIRY_PAGE) return out;
      }
    },
    async renewedUsers(userIds, since) {
      if (!userIds.length) return [];
      // Chunked so a large `in (...)` list never exceeds the request-URL limit.
      const out: Array<{ userId: string; startsAt: string }> = [];
      for (let i = 0; i < userIds.length; i += IN_CHUNK) {
        const { data, error } = await client
          .from('plan_periods')
          .select('user_id, starts_at')
          .in('user_id', userIds.slice(i, i + IN_CHUNK))
          .is('voided_at', null)
          .gte('starts_at', since.toISOString())
          .limit(5000);
        if (error) throw new DbUnavailableError('renewal query failed');
        for (const r of data ?? []) out.push({ userId: r.user_id as string, startsAt: r.starts_at as string });
      }
      return out;
    },
    async emailFor(userId) {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error) throw new DbUnavailableError('user lookup failed');
      return data.user?.email ?? null;
    },
  };
}

export function supabaseRetentionStore(client = serviceClient()): RetentionStore {
  return {
    async stale(cutoff, limit) {
      const { data, error } = await client
        .from('payment_requests')
        .select('id, screenshot_path')
        .not('screenshot_path', 'is', null)
        // An undecided request still needs its receipt for the admin to verify.
        .neq('status', 'pending')
        .lt('created_at', cutoff.toISOString())
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new DbUnavailableError('stale screenshots query failed');
      return (data ?? []).map((r) => ({ id: r.id as string, path: r.screenshot_path as string }));
    },
    async removeObject(path) {
      const { error } = await client.storage.from(BUCKET).remove([path]);
      if (error) throw new DbUnavailableError('screenshot remove failed');
    },
    async clearPath(id) {
      const { error } = await client.from('payment_requests').update({ screenshot_path: null }).eq('id', id);
      if (error) throw new DbUnavailableError('screenshot path clear failed');
    },
  };
}
