'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthHeading, Field, FormAlert, PasswordField, SubmitButton, authLinkClass } from '@/components/auth/auth-ui';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { assessPassword } from '@/lib/password';
import { useCaptchaField } from '@/components/auth/captcha-field';

export default function SignupPage() {
  const { signUp, ready, user } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [touched, setTouched] = useState(false);
  const captcha = useCaptchaField();

  useEffect(() => {
    if (ready && user) router.replace('/workspace');
  }, [ready, user, router]);

  const strong = assessPassword(password).ok;
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const nameErr = touched && !name.trim() ? 'Enter your full name.' : null;
  const emailErr = touched && !emailOk ? 'Enter a valid email address.' : null;
  const passErr = touched && !strong ? 'Choose a stronger password (see requirements below).' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || captcha.waiting) return;
    setTouched(true);
    if (!name.trim() || !emailOk || !strong) return;
    setError(null);
    setBusy(true);
    const { error, needsEmailConfirmation } = await signUp(name, email, password, captcha.token);
    if (error) {
      setError(error);
      setBusy(false);
      captcha.settle(error);
      return;
    }
    if (needsEmailConfirmation) {
      // Email confirmation is ON in Supabase — no session yet. (Farid wants no
      // codes on login; to make sign-up land straight on the dashboard, turn OFF
      // "Confirm email" in Supabase Auth settings.)
      setConfirmSent(true);
      setBusy(false);
      return;
    }
    router.replace('/workspace');
  }

  if (confirmSent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h1 className="mt-3 text-xl font-bold tracking-tight">Confirm your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Click it to
          activate your account, then sign in.
        </p>
        <Button asChild variant="outline" size="lg" className="mt-4 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading title="Create your account" subtitle="Start analyzing supplier quotations in minutes." />

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <Field
          id="name"
          label="Full name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          error={nameErr}
        />
        <Field
          id="email"
          label="Work email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          error={emailErr}
        />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Create a strong password"
          error={passErr}
        >
          <PasswordStrength password={password} />
        </PasswordField>
        {captcha.node}
        <SubmitButton busy={busy} disabled={captcha.waiting} busyLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className={authLinkClass}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
