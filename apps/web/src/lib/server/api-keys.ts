// API keys for the Fastn intake workflow (AD-2). Only the SHA-256 is stored; the raw
// key exists in memory once, at creation, and is never logged.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DbUnavailableError, serviceClient } from './db';

export const hashApiKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export const generateApiKey = (): string => `ak_${randomBytes(32).toString('base64url')}`;

type Client = Pick<SupabaseClient, 'from'>;

/** User id for a live (unrevoked) key hash, else null. Throws DbUnavailableError on failure. */
export async function lookupApiKeyUser(sha256: string, client: Client = serviceClient()): Promise<string | null> {
  const { data, error } = await client
    .from('api_keys')
    .select('user_id')
    .eq('key_sha256', sha256)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new DbUnavailableError('api_keys lookup failed');
  return (data?.user_id as string | undefined) ?? null;
}

/** Stores the hash of a new key for the user and returns the row id. */
export async function insertApiKey(
  args: { userId: string; sha256: string; label: string | null },
  client: Client = serviceClient(),
): Promise<string> {
  const { data, error } = await client
    .from('api_keys')
    .insert({ user_id: args.userId, key_sha256: args.sha256, label: args.label })
    .select('id')
    .single();
  if (error || !data) throw new DbUnavailableError('api_keys insert failed');
  return data.id as string;
}

/** Sets revoked_at on a live key. Returns false when no live key has that id. */
export async function revokeApiKeyById(id: string, client: Client = serviceClient()): Promise<boolean> {
  const { data, error } = await client
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');
  if (error) throw new DbUnavailableError('api_keys revoke failed');
  return (data ?? []).length > 0;
}

/** Audit rows record the key id only, never the key. */
export async function auditApiKey(
  args: { action: 'api_key_create' | 'api_key_revoke'; adminEmail: string | null; userId: string | null; keyId: string },
  client: Client = serviceClient(),
): Promise<void> {
  const { error } = await client.from('audit_log').insert({
    actor_email: args.adminEmail,
    action: args.action,
    subject_user_id: args.userId,
    subject_id: args.keyId,
    detail: {},
  });
  if (error) throw new DbUnavailableError('audit insert failed');
}

/** False when the user is deleted or currently banned/disabled in Supabase Auth. Throws DbUnavailableError on lookup failure (fail closed). */
export async function apiKeyUserActive(userId: string, client: Pick<SupabaseClient, 'auth'> = serviceClient()): Promise<boolean> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) {
    if ((error as { status?: number }).status === 404) return false;
    throw new DbUnavailableError('api key user lookup failed');
  }
  const u = data?.user as { banned_until?: string | null } | null | undefined;
  if (!u) return false;
  return !(u.banned_until && Date.parse(u.banned_until) > Date.now());
}
