// Client helper: every call to our own /api/* goes through here so the request
// carries the signed-in user's Supabase access token (AD-1). The server verifies
// it; nothing here is trusted. With no session, or for a cross-origin URL, the
// request is sent unchanged so the token never leaves our origin.
import { supabase } from './supabase';

export interface ApiFetchDeps {
  getToken: () => Promise<string | undefined>;
  fetchImpl: typeof fetch;
  /** Current page origin; undefined means only relative URLs get the token. */
  origin?: () => string | undefined;
}

function isSameOrigin(input: RequestInfo | URL, origin: string | undefined): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^\/(?!\/)/.test(raw)) return true;
  if (!origin) return false;
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}

export function createApiFetch(deps: ApiFetchDeps) {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (!isSameOrigin(input, deps.origin?.())) return deps.fetchImpl(input, init);
    let token: string | undefined;
    try {
      token = await deps.getToken();
    } catch {
      token = undefined;
    }
    if (!token) return deps.fetchImpl(input, init);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return deps.fetchImpl(input, { ...init, headers });
  };
}

export const apiFetch = createApiFetch({
  getToken: async () => {
    if (!supabase) return undefined;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  },
  fetchImpl: (input, init) => fetch(input, init),
  origin: () => (typeof window !== 'undefined' ? window.location.origin : undefined),
});
