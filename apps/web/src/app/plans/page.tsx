'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PlansView } from '@/components/plans/plans-view';
import { UsageMeter, UsageMeterStrip } from '@/components/workspace/usage-meter';
import { UserMenu } from '@/components/auth/user-menu';

export default function PlansPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <h1 className="text-base font-semibold tracking-tight">Plans</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/workspace"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </Link>
            <UsageMeter />
            <UserMenu />
          </div>
        </div>
        <UsageMeterStrip />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <PlansView />
      </main>
    </div>
  );
}
