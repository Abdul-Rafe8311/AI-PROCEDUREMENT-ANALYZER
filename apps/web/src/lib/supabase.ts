// Supabase client. The workspace works fully without it (in-session only); when
// these env vars are present, auth + uploads + per-user history persist.
//
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Hostname of the configured project (e.g. "abcdefgh.supabase.co"), surfaced in
// error messages/logs so a bad or dead URL in a deployment is obvious.
export const supabaseHost: string | null = (() => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
})();

// Fail loudly (console, not crash) when the URL is malformed — the client would
// otherwise silently produce "Load failed" / "Failed to fetch" on every request.
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
  console.warn(`[supabase] NEXT_PUBLIC_SUPABASE_URL looks unusual: ${url}`);
}

export const STORAGE_BUCKET = 'quotations';

// Email+password auth (Supabase Auth). We persist the session in the browser so a
// logged-in user stays logged in across reloads, auto-refresh keeps the access
// token fresh, and detectSessionInUrl lets the password-reset link establish a
// recovery session when the user lands back on /reset-password. The anon key +
// the user's JWT are what let Row-Level Security scope every read/write to the
// owner. Passwords are hashed + stored by Supabase — never by us.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
