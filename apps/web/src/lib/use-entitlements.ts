'use client';

// Reads /api/me/entitlements. The server decides isAdmin; this is a UX hint only,
// the API guard is the real gate.
import { useEffect, useState } from 'react';
import { apiFetch } from './api-fetch';
import { useAuth } from './auth-context';

export function useEntitlements(): { isAdmin: boolean; loading: boolean } {
  const { ready, configured, user } = useAuth();
  const [state, setState] = useState({ isAdmin: false, loading: true });
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!ready) return;
    if (configured && !userId) {
      setState({ isAdmin: false, loading: false });
      return;
    }
    setState({ isAdmin: false, loading: true });
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/me/entitlements');
        const body = res.ok ? await res.json() : null;
        if (!cancelled) setState({ isAdmin: body?.isAdmin === true, loading: false });
      } catch {
        if (!cancelled) setState({ isAdmin: false, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, configured, userId]);

  return state;
}
