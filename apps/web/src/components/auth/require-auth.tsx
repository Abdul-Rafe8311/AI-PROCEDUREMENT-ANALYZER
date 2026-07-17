'use client';

// Protects the workspace: an unauthenticated visitor never sees its contents — they
// are redirected to /login (with a redirect back once signed in). Data is ALSO
// protected at the database by Row-Level Security; this gate is the UX layer.
//
// When Supabase isn't configured (e.g. a local dev checkout with no keys), we let
// visitors through so the app keeps working in its original in-session-only mode.

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, configured, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const blocked = configured && ready && !user;

  useEffect(() => {
    if (blocked) {
      const next = encodeURIComponent(pathname || '/workspace');
      router.replace(`/login?redirect=${next}`);
    }
  }, [blocked, pathname, router]);

  // Initial session check, or configured-but-signed-out (mid-redirect): show a
  // neutral loading gate rather than flashing the protected content.
  if (configured && (!ready || !user)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {ready ? 'Redirecting to sign in…' : 'Loading…'}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
