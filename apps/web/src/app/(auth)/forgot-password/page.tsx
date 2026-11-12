'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthHeading, Field, FormAlert, PasswordField, SubmitButton, authLinkClass } from '@/components/auth/auth-ui';
import { useAuth } from '@/lib/auth-context';
import { useCaptchaField } from '@/components/auth/captcha-field';

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(false);
  const captcha = useCaptchaField();

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const emailErr = touched && !emailOk ? 'Enter a valid email address.' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || captcha.waiting) return;
    setTouched(true);
    if (!emailOk) return;
    setError(null);
    setBusy(true);
    const { error } = await sendPasswordReset(email, captcha.token);
    setBusy(false);
    // Don't reveal whether an account exists — always show the same confirmation.
    if (error) {
      setError(error);
      captcha.settle(error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h1 className="mt-3 text-xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, we&apos;ve sent a
          password-reset link. Open it to choose a new password.
        </p>
        <Button asChild variant="outline" size="lg" className="mt-4 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter your email and we'll send a link to set a new password."
      />

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          error={emailErr}
        />
        {captcha.node}
        <SubmitButton busy={busy} disabled={captcha.waiting} busyLabel="Sending link…">
          Send reset link
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
