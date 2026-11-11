'use client';

// Loads the signed-in user's payment history and pending request. Display only; the server decides.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api-fetch';
import { useAuth } from './auth-context';
import type { PaymentsPage } from './payments-types';

export function usePayments(page = 1, pageSize = 10) {
  const { ready, configured, user } = useAuth();
  const [data, setData] = useState<PaymentsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!ready) return;
    if (configured && !userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/payments?page=${page}&pageSize=${pageSize}`);
        if (!res.ok) throw new Error('bad status');
        const body = (await res.json()) as PaymentsPage;
        if (!cancelled) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, configured, userId, page, pageSize, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, refresh };
}
