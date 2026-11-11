'use client';

// Reads /api/me/entitlements once per signed-in user and shares it between components
// (header meter, plans page, admin link). The server decides isAdmin and all figures; this is a
// display cache, the API guards stay the real gate. `refreshEntitlements()` refetches after an upload.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api-fetch';
import { useAuth } from './auth-context';

export interface EntitlementsData {
  plan: string;
  expiresAt: string | null;
  queued: Array<{ plan: string; startsAt: string; endsAt: string }>;
  used: number;
  quota: number;
  resetAt: string | null;
  isAdmin: boolean;
}

interface State {
  data: EntitlementsData | null;
  loading: boolean;
  error: boolean;
}

const listeners = new Set<() => void>();
let cache: { userId: string | null; state: State } = { userId: null, state: { data: null, loading: true, error: false } };
let inflight: Promise<void> | null = null;

function publish(userId: string | null, state: State) {
  cache = { userId, state };
  listeners.forEach((l) => l());
}

async function load(userId: string | null): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await apiFetch('/api/me/entitlements');
      const body = res.ok ? ((await res.json()) as EntitlementsData) : null;
      publish(userId, body ? { data: body, loading: false, error: false } : { data: null, loading: false, error: true });
    } catch {
      publish(userId, { data: null, loading: false, error: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Refetch figures after something that changes usage (e.g. an upload finished or was blocked). */
export function refreshEntitlements(): void {
  void load(cache.userId);
}

export function useEntitlements(): State & { isAdmin: boolean; refresh: () => void } {
  const { ready, configured, user } = useAuth();
  const userId = user?.id ?? null;
  const [, tick] = useState(0);

  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (configured && !userId) {
      publish(null, { data: null, loading: false, error: false });
      return;
    }
    if (cache.userId !== userId || (!cache.state.data && !cache.state.error)) {
      publish(userId, { data: null, loading: true, error: false });
      void load(userId);
    }
  }, [ready, configured, userId]);

  const refresh = useCallback(() => refreshEntitlements(), []);
  const state = ready && cache.userId === userId ? cache.state : { data: null, loading: true, error: false };
  return { ...state, isAdmin: state.data?.isAdmin === true, refresh };
}
