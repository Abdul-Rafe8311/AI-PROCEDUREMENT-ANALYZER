'use client';

// App-wide auth state built on Supabase Auth (email + password). Wraps the app so
// any client component can read the current user, their display name, and call
// sign-in / sign-up / sign-out / password-reset. All hashing + token handling is
// Supabase's; this is just the React glue.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';
import { isEmailAllowedToSignUp, signUpDomainRejectionMessage } from './auth-policy';

export interface AuthResult {
  error: string | null;
  /** signUp only: true when Supabase created the account but requires email
   *  confirmation before a session exists (no auto-login). */
  needsEmailConfirmation?: boolean;
}

interface AuthContextValue {
  ready: boolean; // finished the initial session check
  configured: boolean; // Supabase env present
  user: User | null;
  session: Session | null;
  displayName: string;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function nameFromUser(u: User | null): string {
  if (!u) return '';
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  if (full) return full;
  return u.email ? u.email.split('@')[0] : 'Account';
}

const siteOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setReady(true);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      ready,
      configured: isSupabaseConfigured,
      user,
      session,
      displayName: nameFromUser(user),
      async signIn(email, password) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return { error: friendlyAuthError(error.message) };
        return { error: null };
      },
      async signUp(name, email, password) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        const cleanEmail = email.trim();
        // Domain policy: open by default; flip ALLOWED_SIGNUP_DOMAIN to restrict.
        if (!isEmailAllowedToSignUp(cleanEmail)) return { error: signUpDomainRejectionMessage() };
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: name.trim() }, // stored on the user's profile (user_metadata + profiles trigger)
            emailRedirectTo: `${siteOrigin()}/workspace`,
          },
        });
        if (error) return { error: friendlyAuthError(error.message) };
        // When email confirmation is ON in Supabase, there's no session yet.
        return { error: null, needsEmailConfirmation: !data.session };
      },
      async signOut() {
        if (!supabase) return;
        await supabase.auth.signOut();
      },
      async sendPasswordReset(email) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${siteOrigin()}/reset-password`,
        });
        if (error) return { error: friendlyAuthError(error.message) };
        return { error: null };
      },
      async updatePassword(password) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return { error: friendlyAuthError(error.message) };
        return { error: null };
      },
    };
  }, [ready, user, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// Map Supabase's raw messages to clear, user-facing text (no leaking internals).
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('email not confirmed')) return 'Please confirm your email address first, then sign in.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('password should be at least')) return message; // already specific
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts — please wait a minute and try again.';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Please enter a valid email address.';
  return message || 'Something went wrong. Please try again.';
}
