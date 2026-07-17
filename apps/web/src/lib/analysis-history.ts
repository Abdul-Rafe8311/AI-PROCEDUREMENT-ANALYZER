// Per-user analysis history (Phase 2). These helpers own the Supabase calls that
// tie saved analyses to the logged-in user. They are written to work BOTH before
// and after the ownership migration is applied:
//   • post-migration: analyses carry user_id and RLS scopes reads to the owner;
//   • pre-migration:  the user_id column doesn't exist, so we fall back to an
//     ownerless insert and an empty history — persistence keeps working, nothing
//     breaks, and ownership simply activates the moment the migration is run.

import { isSupabaseConfigured, supabase } from './supabase';

export interface HistoryItem {
  id: string;
  title: string;
  createdAt: string;
}

// A missing user_id column / uncached schema surfaces as one of these from PostgREST.
function isMissingOwnerColumn(message: string): boolean {
  return /user_id|column|schema cache|PGRST(204|202|205)/i.test(message);
}

/**
 * Insert a new analysis row owned by `userId` when the column exists; on a
 * pre-migration DB, insert it ownerless so saving still works. Returns true if a
 * row was written.
 */
export async function insertAnalysisRow(id: string, title: string, userId: string | null): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  if (userId) {
    const { error } = await supabase.from('analyses').insert({ id, title, user_id: userId });
    if (!error) return true;
    if (!isMissingOwnerColumn(error.message)) throw error; // a real error — surface it
    // else: pre-migration DB → fall through to the ownerless insert
  }
  const { error } = await supabase.from('analyses').insert({ id, title });
  if (error) throw error;
  return true;
}

/**
 * The user's saved sessions (newest first) for the history switcher. Returns []
 * on a pre-migration DB (no user_id column yet) so the UI just shows no history.
 */
export async function loadUserHistory(userId: string, limit = 20): Promise<HistoryItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('analyses')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? 'Untitled analysis'),
    createdAt: String(r.created_at ?? ''),
  }));
}
