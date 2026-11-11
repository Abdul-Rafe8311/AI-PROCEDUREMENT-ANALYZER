'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEntitlements } from '@/lib/use-entitlements';
import { UsersPanel } from '@/components/admin/users-panel';
import { PaymentsPanel } from '@/components/admin/payments-panel';

export default function AdminPage() {
  const { isAdmin, loading } = useEntitlements();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Standard not-found for non-admins; real authorization stays in the API guard.
  if (!isAdmin) notFound();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <h1 className="text-base font-semibold tracking-tight">Admin</h1>
          <Link
            href="/workspace"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Workspace
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-6">
        <PaymentsPanel />
        <div className="max-w-3xl">
          <UsersPanel />
        </div>
      </main>
    </div>
  );
}
