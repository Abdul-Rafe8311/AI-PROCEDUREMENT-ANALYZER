'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

// Signed-in identity + logout, shown in the workspace header. Renders nothing when
// auth isn't configured (the app's original keyless mode).
export function UserMenu() {
  const { configured, user, displayName, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!configured || !user) return null;

  async function onLogout() {
    setBusy(true);
    await signOut();
    router.replace('/login');
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden max-w-[10rem] truncate text-sm font-medium text-muted-foreground sm:inline"
        title={user.email ?? displayName}
      >
        {displayName}
      </span>
      <Link
        href="/plans"
        className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
      >
        Plans
      </Link>
      <Button variant="ghost" size="sm" onClick={onLogout} disabled={busy} className="gap-1.5">
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </div>
  );
}
