import Link from 'next/link';
import { Clock, FileCheck2, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const BENEFITS = [
  { icon: Clock, title: 'Minutes, not hours', body: 'Upload quotations and get a side-by-side comparison automatically.' },
  { icon: ShieldCheck, title: 'Risks flagged for you', body: 'Hidden terms, missing items and price outliers surface before you decide.' },
  { icon: FileCheck2, title: 'Approval-ready output', body: 'Technical approval form and report generated from the same analysis.' },
];

// Invented suppliers only — never real customer data.
const SAMPLE = [
  { name: 'Northwind Supply Co.', score: 92, best: true },
  { name: 'Alpine Trading Ltd.', score: 84, best: false },
  { name: 'Meridian Components', score: 71, best: false },
];

function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <Link
      href="/"
      className="flex min-h-[44px] items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={
          onDark
            ? 'flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-white ring-1 ring-white/25'
            : 'flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm'
        }
      >
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <span className={onDark ? 'text-base font-semibold tracking-tight text-white' : 'text-base font-semibold tracking-tight'}>
        AI Procurement Copilot
      </span>
    </Link>
  );
}

function ScoreCard() {
  return (
    <div
      aria-hidden
      className="w-full max-w-sm rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between text-xs font-medium text-indigo-100">
        <span>Quotation comparison</span>
        <span className="rounded-full bg-white/15 px-2 py-0.5">Sample data</span>
      </div>
      <ul className="mt-4 space-y-3.5">
        {SAMPLE.map((s) => (
          <li key={s.name}>
            <div className="flex items-center justify-between text-sm text-white">
              <span className="flex items-center gap-1.5 font-medium">
                {s.name}
                {s.best && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                    <Trophy className="h-3 w-3" /> Recommended
                  </span>
                )}
              </span>
              <span className="tabular-nums font-semibold">{s.score}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className={s.best ? 'h-full rounded-full bg-emerald-300' : 'h-full rounded-full bg-indigo-200/80'}
                style={{ width: `${s.score}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-400/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-500/20 blur-3xl"
      />
      <div className="relative">
        <Logo onDark />
      </div>
      <div className="relative space-y-10">
        <h2 className="max-w-md text-balance text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
          Compare supplier quotations in minutes, not hours
        </h2>
        <ul className="max-w-md space-y-5">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-indigo-100">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <ScoreCard />
      </div>
      <p className="relative text-xs text-indigo-200">Built for procurement teams.</p>
    </aside>
  );
}

// Split layout on desktop (brand panel left, form right); form only on mobile.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      <BrandPanel />
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-4 sm:px-10">
          <div className="lg:invisible">
            <Logo />
          </div>
          <ThemeToggle className="h-11 w-11" />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 pb-12 sm:px-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
