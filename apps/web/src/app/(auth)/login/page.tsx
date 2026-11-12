'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AuthHeading, Field, FormAlert, PasswordField, SubmitButton, authLinkClass } from '@/components/auth/auth-ui';
import { useAuth } from '@/lib/auth-context';
import { useCaptchaField } from '@/components/auth/captcha-field';

function LoginForm() {
  const { signIn, ready, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params?.get('redirect') || '/workspace';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const captcha = useCaptchaField();

  // Already signed in → skip the form.
  useEffect(() => {
    if (ready && user) router.replace(redirect);
  }, [ready, user, redirect, router]);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const emailErr = touched && !emailOk ? 'Enter a valid email address.' : null;
  const passErr = touched && !password ? 'Enter your password.' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || captcha.waiting) return;
    setTouched(true);
    if (!emailOk || !password) return;
    setError(null);
    setBusy(true);
    const { error } = await signIn(email, password, captcha.token);
    if (error) {
      setError(error);
      setBusy(false);
      captcha.settle(error); // single-use token; email stays
      return;
    }
    router.replace(redirect);
  }

  return (
    <div>
      <AuthHeading title="Welcome back" subtitle="Sign in to your procurement workspace." />

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
        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          error={passErr}
          labelAction={
            <Link href="/forgot-password" className={authLinkClass + ' text-xs'}>
              Forgot password?
            </Link>
          }
        />
        {captcha.node}
        <SubmitButton busy={busy} disabled={captcha.waiting} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className={authLinkClass}>
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
