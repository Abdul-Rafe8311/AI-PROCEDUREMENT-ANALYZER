'use client';

// Resizable, scroll-aware landing navbar (Aceternity-style): full-width and
// transparent at the top of the page, then on scroll it shrinks to a centered,
// rounded "pill" with a blurred, bordered, shadowed background — responsive, with
// a mobile hamburger menu. Theme-aware (works in light + dark) via design tokens.
// Dependency-free: the resize is driven by a scroll listener + Tailwind transitions.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV_LINKS = [
  { label: 'How it works', href: '#workflow' },
  { label: 'Features', href: '#features' },
  { label: 'Live demo', href: '#demo' },
];

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function ResizableNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // Shrink once the page is scrolled past a small threshold.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-close the mobile menu when we grow to desktop width.
  useEffect(() => {
    if (!open) return;
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  return (
    <header className="sticky inset-x-0 top-0 z-50 w-full">
      <div
        className={cn(
          'relative mx-auto flex items-center justify-between transition-all duration-300 ease-out',
          scrolled
            ? 'my-2 max-w-4xl rounded-full border border-border/70 bg-background/80 px-3 py-2 shadow-lg backdrop-blur-md sm:px-4'
            : 'my-0 max-w-6xl rounded-none border border-transparent bg-transparent px-4 py-3 shadow-none sm:px-6',
        )}
      >
        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">Procurement Copilot</span>
        </Link>

        {/* Center links (desktop) — absolutely centered so the pill stays balanced */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 text-sm font-medium text-muted-foreground lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>

        {/* Right actions (desktop) */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <ThemeToggle />
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Sign in
          </Link>
          <Link href="/signup" className={primaryBtn}>
            Get started
          </Link>
        </div>

        {/* Mobile actions */}
        <div className="flex shrink-0 items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-accent"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="mx-auto mt-2 max-w-4xl rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur-md md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 text-center text-sm font-medium text-foreground transition hover:bg-accent"
            >
              Sign in
            </Link>
            <Link href="/signup" onClick={() => setOpen(false)} className={cn(primaryBtn, 'w-full py-2.5')}>
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
