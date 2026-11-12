'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AuthHeading, Field, FormAlert, PasswordField, SubmitButton, authLinkClass } from '@/components/auth/auth-ui';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { assessPassword } from '@/lib/password';

// The reset link (from the Supabase email) lands here with a recovery token in the
// URL. supabase-js (detectSessionInUrl) turns it into a temporary session, after
// which updateUser({ password }) sets the new password. If the link is missing or
// expired, updatePassword fails and we point the user back to "forgot password".
export default function ResetPasswordPage() {
  const { updatePassword, ready, user } = useAuth();
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);

  // Best-effort detection of a valid recovery context: either a recovery session
  // was established, or the URL still carries the recovery token/params.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const looksLikeRecovery =
      /type=recovery/.test(hash) || /access_token=/.test(hash) || /code=/.test(search) || Boolean(user);
    if (ready) setHasRecovery(looksLikeRecovery);
  }, [ready, user]);

  const strong = assessPassword(password).ok;
  const matches = password.length > 0 && password === confirm;
  const [touched, setTouched] = useState(false);
  const passErr = touched && !strong ? 'Choose a stronger password (see requirements below).' : null;
  const confirmErr = confirm.length > 0 && !matches ? "Passwords don't match." : touched && !matches ? 'Re-enter the password.' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!strong || !matches) return;
    setError(null);
    setBusy(true);
    const { error } = await updatePassword(password);
    if (error) {
      setError(
        /session|missing|expired|invalid/i.test(error)
          ? 'This reset link has expired or was already used. Please request a new one.'
          : error,
      );
      setBusy(false);
      return;
    }
    toast.success('Password updated — you are signed in.');
    router.replace('/workspace');
  }

  if (ready && hasRecovery === false) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">Invalid or expired link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This password-reset link is no longer valid. Request a fresh one to continue.
        </p>
        <Button asChild size="lg" className="mt-4 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading title="Choose a new password" subtitle="Set a new password for your account." />

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <PasswordField
          id="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Create a strong password"
          error={passErr}
        >
          <PasswordStrength password={password} />
        </PasswordField>
        <PasswordField
          id="confirm"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Re-enter the password"
          error={confirmErr}
        />
        <SubmitButton busy={busy} busyLabel="Updating…">
          Update password
        </SubmitButton>
      </form>
    </div>
  );
}
