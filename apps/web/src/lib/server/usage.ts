// Service-role wrappers for the pdf_usage quota functions (AD-5, AD-12). The route owns the flow:
// reserve -> extract -> confirm or release per file.
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DbUnavailableError, serviceClient } from './db';

export const sha256Hex = (data: Buffer | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export type ReserveResult =
  | { status: 'OK'; quota: number; used: number; remaining: number; reserved: string[]; free: string[] }
  | { status: 'QUOTA_EXCEEDED'; quota: number; used: number; remaining: number }
  | { status: 'STALE' };

type Rpc = Pick<SupabaseClient, 'rpc'>;
type Rows = Pick<SupabaseClient, 'from'>;

export async function reservePdfQuota(
  args: { userId: string; hashes: string[]; windowStart: Date; quota: number; expectedPeriodId: string | null },
  client: Rpc = serviceClient(),
): Promise<ReserveResult> {
  const { data, error } = await client.rpc('reserve_pdf_quota', {
    p_user_id: args.userId,
    p_hashes: args.hashes,
    p_window_start: args.windowStart.toISOString(),
    p_quota: args.quota,
    p_expected_period_id: args.expectedPeriodId,
  });
  const d = data as Record<string, unknown> | null;
  if (error || !d || typeof d.status !== 'string') throw new DbUnavailableError('reserve_pdf_quota failed');
  if (d.status === 'STALE') return { status: 'STALE' };
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  if (d.status === 'QUOTA_EXCEEDED') {
    return { status: 'QUOTA_EXCEEDED', quota: num('quota'), used: num('used'), remaining: num('remaining') };
  }
  if (d.status === 'OK') {
    const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
    return { status: 'OK', quota: num('quota'), used: num('used'), remaining: num('remaining'), reserved: arr('reserved'), free: arr('free') };
  }
  throw new DbUnavailableError('reserve_pdf_quota returned an unknown status');
}

export async function confirmPdfUsage(
  args: { userId: string; hash: string; windowStart: Date },
  client: Rpc = serviceClient(),
): Promise<void> {
  const { error } = await client.rpc('confirm_pdf_usage', {
    p_user_id: args.userId,
    p_hash: args.hash,
    p_window_start: args.windowStart.toISOString(),
  });
  if (error) throw new DbUnavailableError('confirm_pdf_usage failed');
}

export async function releasePdfUsage(args: { userId: string; hash: string }, client: Rpc = serviceClient()): Promise<void> {
  const { error } = await client.rpc('release_pdf_usage', { p_user_id: args.userId, p_hash: args.hash });
  if (error) throw new DbUnavailableError('release_pdf_usage failed');
}

/** Used count for the window: confirmed rows since windowStart plus reservations younger than 10 minutes. Same rule as reserve_pdf_quota. */
export async function countUsed(
  args: { userId: string; windowStart: Date; now: Date },
  client: Rows = serviceClient(),
): Promise<number> {
  const fresh = new Date(args.now.getTime() - 10 * 60 * 1000).toISOString();
  const since = args.windowStart.toISOString();
  const [confirmed, reserved] = await Promise.all([
    client.from('pdf_usage').select('id', { count: 'exact', head: true }).eq('user_id', args.userId).eq('status', 'confirmed').gte('created_at', since),
    client.from('pdf_usage').select('id', { count: 'exact', head: true }).eq('user_id', args.userId).eq('status', 'reserved').gte('created_at', fresh),
  ]);
  if (confirmed.error || reserved.error) throw new DbUnavailableError('pdf_usage count failed');
  return (confirmed.count ?? 0) + (reserved.count ?? 0);
}
