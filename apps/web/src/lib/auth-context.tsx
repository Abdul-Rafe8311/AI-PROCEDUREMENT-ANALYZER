'use client';

// App-wide auth state built on Supabase Auth (email + password). Wraps the app so
// any client component can read the current user, their display name, and call
// sign-in / sign-up / sign-out / password-reset. All hashing + token handling is
// Supabase's; this is just the React glue.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, supabaseHost } from './supabase';
import { isEmailAllowedToSignUp, signUpDomainRejectionMessage } from './auth-policy';
import { captchaMessageForAuthError } from './captcha';

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
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string, captchaToken?: string | null) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string, captchaToken?: string | null) => Promise<AuthResult>;
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
      async signIn(email, password, captchaToken) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
            ...(captchaToken ? { options: { captchaToken } } : {}),
          });
          if (error) return { error: reportAuthError('signIn', error, Boolean(captchaToken)) };
          return { error: null };
        } catch (err) {
          return { error: reportAuthError('signIn', err, Boolean(captchaToken)) };
        }
      },
      async signUp(name, email, password, captchaToken) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        const cleanEmail = email.trim();
        // Domain policy: open by default; flip ALLOWED_SIGNUP_DOMAIN to restrict.
        if (!isEmailAllowedToSignUp(cleanEmail)) return { error: signUpDomainRejectionMessage() };
        try {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: { full_name: name.trim() }, // stored on the user's profile (user_metadata + profiles trigger)
              emailRedirectTo: `${siteOrigin()}/workspace`,
              ...(captchaToken ? { captchaToken } : {}),
            },
          });
          if (error) return { error: reportAuthError('signUp', error, Boolean(captchaToken)) };
          // When email confirmation is ON in Supabase, there's no session yet.
          return { error: null, needsEmailConfirmation: !data.session };
        } catch (err) {
          return { error: reportAuthError('signUp', err, Boolean(captchaToken)) };
        }
      },
      async signOut() {
        if (!supabase) return;
        await supabase.auth.signOut();
      },
      async sendPasswordReset(email, captchaToken) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${siteOrigin()}/reset-password`,
            ...(captchaToken ? { captchaToken } : {}),
          });
          if (error) return { error: reportAuthError('sendPasswordReset', error, Boolean(captchaToken)) };
          return { error: null };
        } catch (err) {
          return { error: reportAuthError('sendPasswordReset', err, Boolean(captchaToken)) };
        }
      },
      async updatePassword(password) {
        if (!supabase) return { error: 'Authentication is not configured for this deployment.' };
        try {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) return { error: reportAuthError('updatePassword', error) };
          return { error: null };
        } catch (err) {
          return { error: reportAuthError('updatePassword', err) };
        }
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

// Browser fetch failures never carry an HTTP status. supabase-js wraps them as
// AuthRetryableFetchError (status 0) with the browser's raw TypeError text —
// "Load failed" (Safari/WebKit) or "Failed to fetch" (Chrome). That text is
// useless to a user, so detect it and say what it really means.
function isNetworkFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Partial<AuthError> & { name?: string; status?: number };
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return true;
  const m = String(e.message ?? '').toLowerCase();
  return (
    err instanceof TypeError ||
    m.includes('load failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed')
  );
}

// Log the full error (status, code, message, target host) so a production
// failure is diagnosable from the browser console, then return user-facing text.
function reportAuthError(op: string, err: unknown, tokenSent = false): string {
  const e = (err ?? {}) as Partial<AuthError> & { name?: string; status?: number; code?: string };
  const details = {
    op,
    name: e.name ?? (err instanceof Error ? err.constructor.name : typeof err),
    status: e.status ?? null,
    code: e.code ?? null,
    message: e.message ?? String(err),
    supabaseHost,
    origin: siteOrigin(),
  };
  console.error(`[auth] ${op} failed`, details);

  const captcha = captchaMessageForAuthError(err, tokenSent);
  if (captcha) return captcha;

  if (isNetworkFailure(err)) {
    return (
      `Could not reach the authentication server (${supabaseHost ?? 'not configured'}). ` +
      'The Supabase project may be paused, deleted, or NEXT_PUBLIC_SUPABASE_URL may be wrong in this deployment. ' +
      'Check your connection and try again; if it persists, contact the administrator.'
    );
  }
  return friendlyAuthError(e.message ?? '');
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
