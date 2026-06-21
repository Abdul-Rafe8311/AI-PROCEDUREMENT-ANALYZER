'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from './types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (data: { user: User; accessToken: string; refreshToken: string }) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (data) =>
        set({
          user: data.user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'procurement-auth' },
  ),
);

/** Reads the access token directly from storage (for use outside React). */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('procurement-auth');
    return raw ? JSON.parse(raw)?.state?.accessToken ?? null : null;
  } catch {
    return null;
  }
}
