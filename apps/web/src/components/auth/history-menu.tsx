'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HistoryItem } from '@/lib/analysis-history';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Dropdown that lists the signed-in user's saved analyses (newest first) so they
// can reopen any previous session. Hidden when there's no saved history yet.
export function HistoryMenu({
  items,
  currentId,
  onOpen,
}: {
  items: HistoryItem[];
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpen((o) => !o)}>
        <History className="h-4 w-4" />
        <span className="hidden sm:inline">History</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your analyses
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  onOpen(it.id);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-accent"
              >
                <span className="mt-0.5 h-4 w-4 shrink-0">
                  {it.id === currentId && <Check className="h-4 w-4 text-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{it.title || 'Untitled analysis'}</span>
                  <span className="block text-xs text-muted-foreground">{formatDate(it.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
