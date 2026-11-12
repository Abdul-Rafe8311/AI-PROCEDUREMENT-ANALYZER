// Supabase implementations of the daily-job stores (service role only, AD-12).
import { BUCKET } from './payments-db';
import { DbUnavailableError, serviceClient } from './db';
import type { ExpiryStore, RetentionStore } from './daily-job';

export function supabaseExpiryStore(client = serviceClient()): ExpiryStore {
  return {
    async expiring(now, windowEnd) {
      const { data, error } = await client
        .from('plan_periods')
        .select('id, user_id, plan, ends_at')
        .is('voided_at', null)
        .gt('ends_at', now.toISOString())
        .lte('ends_at', windowEnd.toISOString())
        .order('ends_at', { ascending: true })
        .limit(1000);
      if (error) throw new DbUnavailableError('expiring periods query failed');
      return (data ?? []).map((r) => ({ id: r.id as string, userId: r.user_id as string, plan: r.plan as string, endsAt: r.ends_at as string }));
    },
    async renewedUsers(userIds, since) {
      if (!userIds.length) return [];
      const { data, error } = await client
        .from('plan_periods')
        .select('user_id, starts_at')
        .in('user_id', userIds)
        .is('voided_at', null)
        .gte('starts_at', since.toISOString())
        .limit(5000);
      if (error) throw new DbUnavailableError('renewal query failed');
      return (data ?? []).map((r) => ({ userId: r.user_id as string, startsAt: r.starts_at as string }));
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
