'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PayStep } from '@/components/plans/pay-step';
import { UserMenu } from '@/components/auth/user-menu';

function PayContent() {
  const params = useSearchParams();
  return <PayStep planParam={params?.get('plan') ?? null} />;
}

export default function PayPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <h1 className="text-base font-semibold tracking-tight">Pay by bank transfer</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/workspace"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Suspense fallback={null}>
          <PayContent />
        </Suspense>
      </main>
    </div>
  );
}
