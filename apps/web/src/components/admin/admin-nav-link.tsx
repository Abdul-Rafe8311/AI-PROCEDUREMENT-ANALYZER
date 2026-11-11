'use client';

import Link from 'next/link';
import { Shield } from 'lucide-react';
import { useEntitlements } from '@/lib/use-entitlements';

// Renders only when the server says the signed-in user is an admin.
export function AdminNavLink() {
  const { isAdmin } = useEntitlements();
  if (!isAdmin) return null;
  return (
    <Link
      href="/admin"
      className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
    >
      <Shield className="h-4 w-4" />
      Admin
    </Link>
  );
}
