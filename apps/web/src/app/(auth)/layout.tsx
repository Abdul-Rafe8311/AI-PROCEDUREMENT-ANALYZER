import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Shared chrome for the sign-in / sign-up / password-reset screens: brand header
// and a centered card column. Individual pages render their own title + form.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">AI Procurement Copilot</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
