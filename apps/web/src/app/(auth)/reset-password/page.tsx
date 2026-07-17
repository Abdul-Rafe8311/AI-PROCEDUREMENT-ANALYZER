'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const canSubmit = strong && matches && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
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
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">Invalid or expired link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This password-reset link is no longer valid. Request a fresh one to continue.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Set a new password for your account.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a strong password"
          />
          <PasswordStrength password={password} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter the password"
          />
          {confirm.length > 0 && !matches && <p className="text-xs text-destructive">Passwords don&apos;t match.</p>}
        </div>
        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
        </Button>
      </form>
    </div>
  );
}
