'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { assessPassword } from '@/lib/password';

export default function SignupPage() {
  const { signUp, ready, user } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace('/workspace');
  }, [ready, user, router]);

  const strong = assessPassword(password).ok;
  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && strong && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    const { error, needsEmailConfirmation } = await signUp(name, email, password);
    if (error) {
      setError(error);
      setBusy(false);
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
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h1 className="mt-3 text-xl font-bold tracking-tight">Confirm your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Click it to
          activate your account, then sign in.
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start analyzing supplier quotations in minutes.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Farid Ahmed"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
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
        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create account'}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
